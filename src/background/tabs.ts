import type { TabInfo } from '../shared/types';

export async function listTabs(): Promise<TabInfo[]> {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((t) => t.id !== undefined)
    .map((t) => ({
      id: t.id,
      windowId: t.windowId,
      index: t.index,
      url: t.url,
      title: t.title,
      active: t.active,
      pinned: t.pinned,
      audible: t.audible,
      favIconUrl: t.favIconUrl
    }));
}

export async function findTabByHost(host: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => {
    if (!t.url) return false;
    try {
      return new URL(t.url).hostname.replace(/^www\./, '') === host.replace(/^www\./, '');
    } catch {
      return false;
    }
  });
}

export async function getActiveTabId(fallbackRoot?: string): Promise<number | undefined> {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active && active.id !== undefined) return active.id;
  if (fallbackRoot) {
    const tabs = await chrome.tabs.query({});
    const found = tabs.find((t) => t.url?.startsWith(fallbackRoot));
    if (found?.id !== undefined) return found.id;
  }
  return undefined;
}

export async function waitForTabLoad(tabId: number, timeoutMs = 20000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) return false;
    if (tab.status === 'complete') return true;
    if (tab.status === 'loading') {
      await sleep(400);
      continue;
    }
    // "complete" already handled; other states poll
    await sleep(300);
  }
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  return tab?.status === 'complete';
}

export async function activateTab(tabId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
}

export async function openTab(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error('tab id unavailable');
  return tab.id;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function pickTabArgs(args: Record<string, unknown>): { tabId?: number; url?: string } {
  return {
    tabId: typeof args.tabId === 'number' ? args.tabId : undefined,
    url: typeof args.url === 'string' ? args.url : undefined
  };
}

/**
 * Resolve a requested tab for a tool call.
 * Precedence: explicit tabId > tab found by url host > provided fallback (task-start tab) > active tab.
 */
export async function resolveTab(
  args: { tabId?: number; url?: string },
  fallbackTabId?: number
): Promise<{ tabId?: number; note?: string }> {
  if (typeof args.tabId === 'number') return { tabId: args.tabId };
  if (typeof args.url === 'string') {
    let host = '';
    try {
      host = new URL(args.url).hostname;
    } catch {
      host = args.url;
    }
    const found = await findTabByHost(host);
    if (found?.id !== undefined) return { tabId: found.id, note: 'existing tab' };
    const id = await openTab(args.url);
    await waitForTabLoad(id);
    return { tabId: id, note: 'new tab' };
  }
  if (typeof fallbackTabId === 'number') {
    const tab = await chrome.tabs.get(fallbackTabId).catch(() => undefined);
    if (tab) return { tabId: fallbackTabId, note: 'task-start tab' };
  }
  const activeId = await getActiveTabId();
  return activeId === undefined ? { tabId: undefined, note: 'no active tab' } : { tabId: activeId, note: 'active tab' };
}

type World = 'ISOLATED' | 'MAIN';

/** Inject a self-contained function into a page and await its result. */
export async function inject<T>(
  tabId: number,
  func: (...a: never[]) => unknown,
  args?: unknown[],
  world: World = 'ISOLATED',
  timeoutMs = 30000
): Promise<T> {
  const result = await Promise.race([
    chrome.scripting.executeScript({
      target: { tabId },
      func: func as (...a: unknown[]) => unknown,
      args: args ?? [],
      world
    }),
    sleep(timeoutMs).then(() => {
      throw new Error('script injection timed out');
    })
  ]);
  const first = result[0];
  if (!first) throw new Error('no frame executed');
  if (first.result === undefined) throw new Error('script returned no result');
  return first.result as T;
}