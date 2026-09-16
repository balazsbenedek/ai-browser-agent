// Thin wrapper around chrome.debugger (CDP) for the few things scripting can't
// do cheaply: real screenshots of any tab and native key presses.

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

async function attach(tabId: number, protocol = '1.3'): Promise<Send> {
  await chrome.debugger.attach({ tabId }, protocol);
  return (method, params = {}) =>
    chrome.debugger.sendCommand({ tabId }, method, params) as Promise<unknown>;
}

export async function withDebugger<T>(
  tabId: number,
  fn: (send: Send) => Promise<T>
): Promise<T> {
  await attach(tabId);
  try {
    return await fn((m, p) => chrome.debugger.sendCommand({ tabId }, m, p));
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => undefined);
  }
}

export interface ScreenshotOpts {
  format?: 'jpeg' | 'png';
  quality?: number;
  fullPage?: boolean;
}

/** Returns a data: URL string of the tab's capture. */
export async function captureScreenshot(tabId: number, opts: ScreenshotOpts = {}): Promise<string> {
  const format = opts.format ?? 'jpeg';
  const { data } = (await withDebugger(tabId, async (send) => {
    await send('Page.enable');
    return send('Page.captureScreenshot', {
      format,
      quality: opts.quality ?? (format === 'jpeg' ? 70 : undefined),
      captureBeyondViewport: opts.fullPage ?? false,
      fromSurface: true
    });
  })) as { data: string };
  return `data:image/${format};base64,${data}`;
}

const KEY_MAP: Record<string, { key: string; code: string; vk?: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 }
};

/** Native keyboard press via CDP Input domain. */
export async function pressKey(tabId: number, key: string, text = ''): Promise<void> {
  const known = KEY_MAP[key] ?? { key, code: key, vk: undefined };
  await withDebugger(tabId, async (send) => {
    const base = { type: 'rawKeyDown', key: known.key, code: known.code } as Record<string, unknown>;
    if (known.vk !== undefined) base.windowsVirtualKeyCode = known.vk;
    base.text = text;
    await send('Input.dispatchKeyEvent', base);
    const up = { type: 'keyUp', key: known.key, code: known.code } as Record<string, unknown>;
    if (known.vk !== undefined) up.windowsVirtualKeyCode = known.vk;
    await send('Input.dispatchKeyEvent', up);
  });
}