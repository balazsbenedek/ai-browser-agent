// Brain Adapter content script (isolated world).
//
// Injected into every page at document_idle. It stays dormant until the
// background sends BRAIN_SETUP with a CSS-selector config for the current chat
// UI, then it can:
//   - type a prompt into the chat input and press send (BRAIN_SUBMIT)
//   - watch for the AI's reply and report it back (BRAIN_MESSAGE)
//
// Works with "any" AI chat page: ChatGPT, Claude, Gemini, Open WebUI, your own
// local LLM UI, etc. — as long as the input/send/message selectors are known.
// import type only (erased at build, keeps this a single chunk)
import type { BrainAdapterConfig } from '../shared/types';

interface Cfg extends BrainAdapterConfig {}

let cfg: Cfg | null = null;

function post(msg: Record<string, unknown>): void {
  try {
    void chrome.runtime.sendMessage(msg);
  } catch {
    /* page shutting down */
  }
}

function sendReady(): void {
  post({ kind: 'BRAIN_READY', url: location.href, ts: Date.now() });
}

// ---------- input helpers ----------

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function insertIntoEditable(el: HTMLElement, value: string): void {
  el.textContent = value;
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
  );
}

function typeInto(el: Element, value: string): void {
  const input = el as HTMLElement;
  if (input.isContentEditable || input.getAttribute('contenteditable') !== null) {
    input.focus();
    insertIntoEditable(input, value);
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, value);
  } else {
    const inner = input.querySelector('textarea, input, [contenteditable="true"]');
    if (inner) typeInto(inner, value);
    else {
      input.focus();
      insertIntoEditable(input, value);
    }
  }
}

function clickSend(sel?: string): boolean {
  if (sel) {
    const btn = document.querySelector<HTMLElement>(sel);
    if (btn) {
      btn.click();
      return true;
    }
  }
  // heuristics: any enabled button whose aria-label/text mentions send
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"]')
  );
  const sendish =
    candidates.find((b) => {
      const label =
        (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
      if (b instanceof HTMLButtonElement && b.disabled) return false;
      return label.includes('send');
    }) ||
    candidates.find((b) => {
      if (b instanceof HTMLButtonElement && b.disabled) return false;
      return b.innerText.trim().toLowerCase().includes('send');
    });
  if (sendish) {
    sendish.click();
    return true;
  }
  return false;
}

function pressEnter(el: Element): void {
  const keyOpts: KeyboardEventInit = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  };
  el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
  el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
}

// ---------- response watching ----------

interface Reply {
  text: string;
  stable: boolean;
}

function lastAssistant(msgSel: string | undefined): Reply {
  if (msgSel) {
    const nodes = document.querySelectorAll(msgSel);
    if (nodes.length) {
      const last = nodes[nodes.length - 1] as HTMLElement;
      const text = (last.innerText || last.textContent || '').trim();
      return { text, stable: text.length > 0 };
    }
    return { text: '', stable: false };
  }
  const body = document.body.innerText || '';
  return { text: body.slice(-8000), stable: !isLoading() };
}

function isLoading(): boolean {
  if (!cfg?.loading?.length) return false;
  return cfg.loading.some((s) => document.querySelector(s) !== null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForReply(seq: number, timeoutMs: number, stabilityMs: number): Promise<string> {
  const start = Date.now();
  let prev = '';
  let stableSince = 0;
  let last = '';
  const mark = `[agent-turn:${seq}]`;

  while (Date.now() - start < timeoutMs) {
    let snap = '';
    const { text, stable } = lastAssistant(cfg?.messages);
    if (cfg?.messages) {
      snap = text;
    } else {
      // container mode: text strictly after our marker
      const body = document.body.innerText || '';
      const idx = body.lastIndexOf(mark);
      snap = idx >= 0 ? body.slice(idx + mark.length).trim() : '';
    }
    // remove our own trailing marker if the UI echoes it
    const trailIdx = snap.lastIndexOf(mark);
    if (trailIdx >= 0) snap = snap.slice(0, trailIdx).trim();

    const changed = snap !== prev && snap.length > 0;
    if (snap && snap.length > 0) last = snap;
    if (changed || !stable) {
      stableSince = Date.now();
      prev = snap;
    }
    if (snap.length > 0 && Date.now() - stableSince > stabilityMs) {
      return last;
    }
    await sleep(250);
  }
  return last;
}

async function submit(text: string, seq: number): Promise<unknown> {
  if (!cfg) return { ok: false, error: 'not configured' };
  const input = document.querySelector<HTMLElement>(cfg.input);
  if (!input) {
    const found = Array.from(document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]'))
      .slice(0, 5)
      .map((el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = (el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).join('.')}` : '') || '';
        const name = el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : '';
        return `${el.tagName.toLowerCase()}${id}${cls}${name}`.slice(0, 120);
      });
    return {
      ok: false,
      error: `input not found: ${cfg.input} (page: ${location.href})` +
        (found.length ? `; found on page: ${found.join(', ')}` : '')
    };
  }
  try {
    typeInto(input, text);
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  await sleep(120);
  const sent = clickSend(cfg.send);
  if (!sent) pressEnter(input);
  // start the responder watcher (fire-and-forget)
  const stabilityMs = cfg.stabilityMs ?? 1400;
  const timeoutMs = cfg.timeoutMs ?? 120000;
  void (async () => {
    const reply = await waitForReply(seq, timeoutMs, stabilityMs);
    if (reply) post({ kind: 'BRAIN_MESSAGE', text: reply, ts: Date.now() });
  })();
  return { ok: true, method: sent ? 'send-button' : 'enter' };
}

// ---------- message ingress ----------

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const m = msg as { kind?: string } & Record<string, unknown>;
  if (!m || typeof m !== 'object' || !m.kind) return false;
  if (m.kind === 'BRAIN_ENSURE') {
    sendResponse({ ok: true, url: location.href });
    return false;
  }
  if (m.kind === 'BRAIN_SETUP') {
    cfg = (m.config ?? null) as Cfg | null;
    sendResponse({ ok: true });
    return false;
  }
  if (m.kind === 'BRAIN_SUBMIT') {
    const text = String(m.text ?? '');
    const seq = Number(m.seq ?? 0);
    void submit(text, seq).then(sendResponse);
    return true; // async response
  }
  return false;
});

// announce ourselves shortly after load; the background may also BRAIN_ENSURE us
window.setTimeout(sendReady, 800);