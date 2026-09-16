import { store } from './store';
import { ensureConnected, submitToBrain } from './brain/brain';
import { buildSystemPrompt } from './brain/prompt';
import { REGISTRY, toolHelp, type ToolCtx } from './tools';
import { isDoneCall, parseToolCalls, renderResultsBlock } from '../shared/toolcall';
import type { ApprovalReq, ToolCall, ToolResult } from '../shared/types';
import { pickTabArgs } from './tabs';

let replyResolve: ((t: string) => void) | null = null;
let approvalResolve: ((b: boolean | null) => void) | null = null;
let questionResolve: ((s: string | null) => void) | null = null;
const replyQueue: string[] = [];
let stopCurrent = false;
let runActive = false;
let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
let taskStartTabId: number | undefined;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function compactArgs(args: Record<string, unknown>): string {
  return truncate(JSON.stringify(args), 200);
}

// ---------- external hooks (called by router) ----------

export function handleBrainMessage(text: string): void {
  if (replyResolve) {
    replyResolve(text);
    replyResolve = null;
  } else {
    replyQueue.push(text);
  }
}

export function handleApprovalResponse(id: string, approved: boolean): void {
  const pending = store.state.pendingApproval;
  if (pending && pending.id === id && approvalResolve) {
    approvalResolve(approved);
    approvalResolve = null;
    store.state.pendingApproval = undefined;
    store.broadcast();
  }
}

export function handleAskResponse(id: string, text: string): void {
  const pending = store.state.pendingQuestion;
  if (pending && pending.id === id && questionResolve) {
    questionResolve(text.trim() || null);
    questionResolve = null;
    store.state.pendingQuestion = undefined;
    store.broadcast();
  }
}

export function stopTask(): void {
  stopCurrent = true;
  if (replyResolve) {
    replyResolve('');
    replyResolve = null;
  }
  if (questionResolve) {
    questionResolve(null);
    questionResolve = null;
  }
  if (approvalResolve) {
    approvalResolve(null);
    approvalResolve = null;
  }
  store.state.pendingQuestion = undefined;
  store.state.pendingApproval = undefined;
  store.broadcast();
}

export function isRunning(): boolean {
  return runActive;
}

// ---------- keepalive so the service worker survives long waits ----------

function startKeepAlive(): void {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    void chrome.storage.session.get('ka').then(() => chrome.storage.session.set({ ka: Date.now() }));
  }, 15000);
}

function stopKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = undefined;
  }
}

// ---------- waiters ----------

function waitReply(timeoutMs = 150000): Promise<string> {
  return new Promise((resolve) => {
    if (replyQueue.length) {
      resolve(replyQueue.shift() as string);
      return;
    }
    startKeepAlive();
    replyResolve = resolve;
    setTimeout(() => {
      if (replyResolve === resolve) {
        replyResolve = null;
        resolve('');
      }
    }, timeoutMs);
  });
}

function waitApproval(_id: string, timeoutMs = 600000): Promise<boolean | null> {
  return new Promise((resolve) => {
    approvalResolve = resolve;
    setTimeout(() => {
      if (approvalResolve === resolve) {
        approvalResolve = null;
        resolve(null);
      }
    }, timeoutMs);
  });
}

function waitQuestion(_id: string, timeoutMs = 600000): Promise<string | null> {
  return new Promise((resolve) => {
    questionResolve = resolve;
    setTimeout(() => {
      if (questionResolve === resolve) {
        questionResolve = null;
        resolve(null);
      }
    }, timeoutMs);
  });
}

// ---------- tool execution ----------

async function resolveTabId(args: { tabId?: number; url?: string }): Promise<number | undefined> {
  const picked = pickTabArgs(args as Record<string, unknown>);
  if (typeof picked.tabId === 'number') return picked.tabId;
  if (typeof picked.url === 'string') {
    // find an open tab on that host, else return undefined (browser tools open one)
    const tabs = await chrome.tabs.query({});
    const host = (() => {
      try {
        return new URL(picked.url as string).hostname;
      } catch {
        return picked.url;
      }
    })();
    const match = tabs.find((t) => {
      if (!t.url) return false;
      try {
        return new URL(t.url).hostname === host;
      } catch {
        return false;
      }
    });
    if (match?.id !== undefined) return match.id;
    return undefined;
  }
  if (typeof taskStartTabId === 'number') {
    const tab = await chrome.tabs.get(taskStartTabId).catch(() => undefined);
    if (tab) return taskStartTabId;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined) return active.id;
  return undefined;
}

const ctx: ToolCtx = { getTabId: resolveTabId };

function idFromArgs(args: Record<string, unknown>): number | undefined {
  return typeof args.tabId === 'number' ? args.tabId : undefined;
}

async function askUser(text: string): Promise<ToolResult> {
  const id = uid();
  store.state.pendingQuestion = { id, text };
  store.broadcast();
  const answer = await waitQuestion(id);
  store.state.pendingQuestion = undefined;
  store.broadcast();
  if (answer === null) return { ok: false, error: 'question cancelled' };
  return { ok: true, value: { answer } };
}

async function gateApproval(tool: string, args: Record<string, unknown>): Promise<boolean | null> {
  const req: ApprovalReq = { id: uid(), tool, args, tabId: idFromArgs(args) };
  store.state.pendingApproval = req;
  store.broadcast();
  return waitApproval(req.id);
}

async function runCall(call: ToolCall): Promise<ToolResult> {
  if (call.tool === 'ask_user') {
    const q = String(call.args.question ?? call.args.text ?? '');
    store.log('ask', q);
    return askUser(q || 'What would you like me to do?');
  }
  const tool = REGISTRY[call.tool];
  if (!tool) return { ok: false, error: `unknown tool: ${call.tool}` };

  if (tool.mode === 'destructive' && !store.state.allowDestructive) {
    return { ok: false, error: 'destructive tool disabled — enable "allow destructive" in Settings first' };
  }
  const needsApproval =
    tool.mode === 'destructive' || (tool.mode === 'write' && !store.state.autoApproveWrites);
  if (needsApproval) {
    const ok = await gateApproval(tool.name, call.args);
    if (ok === null) return { ok: false, error: 'approval timed out' };
    if (!ok) return { ok: false, error: `denied by user: ${tool.name}` };
  }
  store.log('call', `${tool.name} ${compactArgs(call.args)}`);
  try {
    const result = await tool.run(ctx, call.args);
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------- the loop ----------

export async function startTask(text: string): Promise<void> {
  if (runActive) {
    store.log('error', 'An agent run is already active — stop it first, then start a new task.');
    return;
  }
  const task = (text || '').trim();
  if (!task) {
    store.log('error', 'No task text');
    return;
  }
  runActive = true;
  stopCurrent = false;
  try {
    // remember the user's working tab before the brain tab is activated
    const [activeBefore] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    taskStartTabId = activeBefore?.id;
    ctx.defaultTabId = taskStartTabId;
    store.patch({ status: 'running', running: true, currentTask: task });
    store.log('info', `Task: ${truncate(task, 200)}`);
    await ensureConnected();
    store.setStatus('running');
    await submitToBrain(`${buildSystemPrompt(toolHelp())}\n\n### Task\n${task}`);
    let nudges = 0;
    for (let turn = 1; turn <= store.state.maxTurns && !stopCurrent; turn++) {
      store.patch({ turn });
      const reply = await waitReply();
      if (stopCurrent) break;
      store.log('brain', truncate(reply, 400));
      if (!reply.trim()) {
        store.log('error', 'No reply from the brain — stopping.');
        break;
      }
      const calls = parseToolCalls(reply);
      if (calls.length) {
        nudges = 0;
        const results: { call: ToolCall; result: ToolResult }[] = [];
        for (const call of calls) {
          if (isDoneCall(call)) {
            const summary = String(call.args.summary ?? 'task complete');
            store.log('ok', `Done: ${summary}`);
            return;
          }
          const result = await runCall(call);
          results.push({ call, result });
          if (stopCurrent) break;
        }
        if (stopCurrent) break;
        await submitToBrain(renderResultsBlock(results));
      } else {
        nudges++;
        if (nudges >= 3) {
          store.log('error', 'Brain stopped producing tool calls — stopping.');
          break;
        }
        await submitToBrain(
          '(continue) No tool call was produced. Emit exactly one agent tool call for the next step, or emit the done call if the task is complete.'
        );
      }
    }
  } catch (e) {
    store.log('error', String(e));
  } finally {
    stopKeepAlive();
    runActive = false;
    store.patch({ running: false, status: 'ready', turn: 0 });
  }
}