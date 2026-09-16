import type { ToolResult } from '../../shared/types';
import {
  instrumentClick,
  instrumentFind,
  instrumentReadHtml,
  instrumentReadPage,
  instrumentRunJs,
  instrumentScroll,
  instrumentType
} from '../../content/instrument';
import { captureScreenshot, pressKey } from '../cdp';
import {
  activateTab,
  inject,
  listTabs,
  openTab,
  pickTabArgs,
  resolveTab,
  waitForTabLoad
} from '../tabs';

export type ToolMode = 'read' | 'write' | 'destructive';

export interface ToolCtx {
  getTabId: (args: { tabId?: number; url?: string }) => Promise<number | undefined>;
  /** Tab active when the task started (the user's working tab), used as a safer default than the active (brain) tab. */
  defaultTabId?: number;
}

export interface Tool {
  name: string;
  mode: ToolMode;
  brief: string;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<ToolResult>;
}

const fail = (error: string): ToolResult => ({ ok: false, error });

interface Instr {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export const browserTools: Tool[] = [
  {
    name: 'list_tabs',
    mode: 'read',
    brief: 'List every open tab across all windows: {id,title,url,active}. Use this before any other tab-targeted call.',
    run: async () => {
      const tabs = await listTabs();
      return { ok: true, value: tabs };
    }
  },
  {
    name: 'get_tab',
    mode: 'read',
    brief: 'Get details for one tab. args: {tabId}.',
    run: async (_ctx, args) => {
      const tabId = Number(args.tabId);
      if (!tabId) return fail('tabId required');
      const tab = await chrome.tabs.get(tabId).catch(() => undefined);
      if (!tab) return fail(`no tab ${tabId}`);
      return {
        ok: true,
        value: {
          id: tab.id,
          title: tab.title,
          url: tab.url,
          active: tab.active,
          pinned: tab.pinned
        }
      };
    }
  },
  {
    name: 'activate_tab',
    mode: 'read',
    brief: 'Bring a tab to the front. args: {tabId} (or {url} to find-or-open). Essential before screenshotting off-screen tabs.',
    run: async (ctx, args) => {
      const { tabId, note } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      await activateTab(tabId);
      return { ok: true, value: { tabId, note: note ?? 'activated' } };
    }
  },
  {
    name: 'open_tab',
    mode: 'read',
    brief: 'Open a new tab at {url}. Returns its id.',
    run: async (_ctx, args) => {
      const url = String(args.url ?? '');
      if (!url) return fail('url required');
      const id = await openTab(url);
      return { ok: true, value: { tabId: id, url } };
    }
  },
  {
    name: 'close_tab',
    mode: 'destructive',
    brief: 'Close a tab {tabId}.',
    run: async (_ctx, args) => {
      const tabId = Number(args.tabId);
      if (!tabId) return fail('tabId required');
      await chrome.tabs.remove(tabId).catch(() => undefined);
      return { ok: true, value: { closed: tabId } };
    }
  },
  {
    name: 'navigate',
    mode: 'write',
    brief: 'Navigate {tabId} (or {url} to find-or-open) to {url}.',
    run: async (ctx, args) => {
      const target = String(args.url ?? '');
      if (!target) return fail('url required');
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      await chrome.tabs.update(tabId, { url: target, active: true });
      await waitForTabLoad(tabId);
      return { ok: true, value: { tabId, url: target } };
    }
  },
  {
    name: 'reload',
    mode: 'write',
    brief: 'Reload {tabId}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId);
      return { ok: true, value: { reloaded: tabId } };
    }
  },
  {
    name: 'back',
    mode: 'write',
    brief: 'Go back in {tabId} history.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const before = chrome.tabs.get(tabId).then((t) => t.url);
      await chrome.tabs.goBack(tabId).catch(() => undefined);
      await waitForTabLoad(tabId, 8000).catch(() => undefined);
      const after = chrome.tabs.get(tabId).then((t) => t.url);
      return { ok: true, value: { before: await before, after: await after } };
    }
  },
  {
    name: 'screenshot',
    mode: 'read',
    brief: 'Capture {tabId} (defaults active). {fullPage?:boolean, format?:"jpeg"|"png", quality?:number}. Returns a data: JPEG you can view.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const data = await captureScreenshot(tabId, {
        fullPage: Boolean(args.fullPage),
        format: args.format === 'png' ? 'png' : 'jpeg',
        quality: args.format === 'png' ? undefined : Number(args.quality ?? 70)
      });
      return { ok: true, value: { tabId, image: data } };
    }
  },
  {
    name: 'read_page',
    mode: 'read',
    brief: 'Read visible text of {tabId} (defaults active). Returns title, url, headings, links-count and text.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const value = await inject(tabId, instrumentReadPage, []);
      return { ok: true, value };
    }
  },
  {
    name: 'read_html',
    mode: 'read',
    brief: 'Read {selector} HTML (or whole page). args: {tabId, selector?, asText?}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const value = await inject(tabId, instrumentReadHtml, [
        { selector: args.selector ? String(args.selector) : undefined, asText: Boolean(args.asText) }
      ]);
      return { ok: true, value };
    }
  },
  {
    name: 'find',
    mode: 'read',
    brief: 'Locate elements by visible {text} on {tabId}. Returns matches with tag/href/position. {max?:number}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const value = await inject(tabId, instrumentFind, [
        { text: args.text ? String(args.text) : '', max: Number(args.max ?? 10) }
      ]);
      return { ok: true, value };
    }
  },
  {
    name: 'click',
    mode: 'write',
    brief: 'Click on {tabId}. By {selector} OR by exact visible {text}. {index?:number, double?:boolean}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const value = await inject<Instr>(tabId, instrumentClick, [
        {
          selector: args.selector ? String(args.selector) : undefined,
          text: args.text ? String(args.text) : undefined,
          index: Number(args.index ?? 0),
          double: Boolean(args.double)
        }
      ]);
      return value.ok === false ? fail(String(value.error)) : { ok: true, value };
    }
  },
  {
    name: 'type',
    mode: 'write',
    brief: 'Type {text} into {selector} on {tabId}. {pressEnter?:boolean}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const selector = String(args.selector ?? '');
      const text = String(args.text ?? '');
      if (!selector) return fail('selector required');
      const value = await inject<Instr>(tabId, instrumentType, [
        { selector, text, pressEnter: Boolean(args.pressEnter) }
      ]);
      return value.ok === false ? fail(String(value.error)) : { ok: true, value };
    }
  },
  {
    name: 'press_key',
    mode: 'write',
    brief: 'Send a native key on {tabId}. key in Enter,Escape,Tab,Arrow* handled natively {text?:string}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const key = String(args.key ?? '');
      if (!key) return fail('key required');
      const text = args.text ? String(args.text) : key === 'Enter' ? '\r' : '';
      await pressKey(tabId, key, text);
      return { ok: true, value: { key, tabId } };
    }
  },
  {
    name: 'scroll',
    mode: 'read',
    brief: 'Scroll {tabId}. {to:"top"|"bottom"|"page", dy?:number, selector?:string}.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const to = args.to as 'top' | 'bottom' | 'page' | undefined;
      const value = await inject(tabId, instrumentScroll, [
        {
          to,
          dy: args.dy !== undefined ? Number(args.dy) : undefined,
          dx: args.dx !== undefined ? Number(args.dx) : undefined,
          selector: args.selector ? String(args.selector) : undefined
        }
      ]);
      return { ok: true, value };
    }
  },
  {
    name: 'run_js',
    mode: 'write',
    brief: 'Evaluate arbitary javascript {code} in {tabId}. Use for advanced DOM when other tools can\'t.',
    run: async (ctx, args) => {
      const { tabId } = await resolveTab(pickTabArgs(args), ctx.defaultTabId);
      if (tabId === undefined) return fail('no usable tab');
      const code = String(args.code ?? '');
      if (!code) return fail('code required');
      const value = await inject<Instr>(tabId, instrumentRunJs, [{ code }]);
      return value.ok === false ? fail(String(value.error)) : { ok: true, value };
    }
  },
  {
    name: 'wait',
    mode: 'read',
    brief: 'Wait {ms} milliseconds before the next step.',
    run: async (_ctx, args) => {
      const ms = Number(args.ms ?? 1000);
      await new Promise((r) => setTimeout(r, Math.min(ms, 60000)));
      return { ok: true, value: { waitedMs: ms } };
    }
  }
];