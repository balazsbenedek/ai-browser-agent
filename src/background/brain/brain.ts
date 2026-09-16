import { describeHost, pickConfig } from './config';
import { pickPreset } from './adapters';
import { wrapForBrain } from '../../shared/toolcall';

// Connection/messaging with the "brain" AI page.
import { sendToTab } from '../../shared/messages';
import type { BrainAdapterConfig } from '../../shared/types';
import { activateTab, findTabByHost, openTab, sleep, waitForTabLoad } from '../tabs';
import { store } from '../store';

let seqCounter = 0;

export function nextSeq(): number {
  return ++seqCounter;
}

export async function ensureConnected(): Promise<void> {
  const url = (store.state.brainUrl || '').trim();
  if (!url) throw new Error('No AI brain URL configured. Open the panel → Agent tab and set it first.');
  let urlParsed: URL;
  try {
    urlParsed = new URL(url);
  } catch {
    throw new Error(`Invalid brain URL: ${url}`);
  }
  const host = describeHost(url);

  let tabId = store.state.brainTabId;
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const ok = tab.url ? tab.url.includes(host) : false;
      if (!ok) tabId = undefined;
    } catch {
      tabId = undefined;
    }
  }
  if (!tabId) {
    const existing = await findTabByHost(host);
    if (existing?.id !== undefined) {
      tabId = existing.id;
      await activateTab(tabId);
    } else {
      tabId = await openTab(url);
    }
    await waitForTabLoad(tabId, 30000);
  }

  const picked = pickConfig(url, host);
  const config: BrainAdapterConfig = picked.config;
  const targetTabId = tabId as number;

  async function probe(): Promise<boolean> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const resp = (await sendToTab(targetTabId, { kind: 'BRAIN_ENSURE' })) as { ok?: boolean } | undefined;
        if (resp?.ok) return true;
      } catch {
        /* retry */
      }
      await sleep(800);
    }
    return false;
  }

  let ensured = await probe();
  if (!ensured) {
    // The extension may have been reloaded since this tab was opened — that
    // destroys the page's content script. Reloading the page re-injects it.
    await chrome.tabs.reload(targetTabId).catch(() => undefined);
    await waitForTabLoad(targetTabId, 30000);
    ensured = await probe();
  }
  if (!ensured) {
    const tab = await chrome.tabs.get(targetTabId).catch(() => undefined);
    throw new Error(
      `Could not reach the brain page (tab ${targetTabId}${tab?.url ? ` at ${tab.url}` : ''}). ` +
        'The extension is running but no content script is answering on that tab — it usually means ' +
        'the tab lost the script when the extension was reloaded. Press F5 on the AI tab (and make ' +
        'sure you are logged in, on the real chat page), then Connect again.'
    );
  }
  await sendToTab(targetTabId, { kind: 'BRAIN_SETUP', config });
  store.patch({ brainTabId: targetTabId, connected: true, adapter: config, status: 'ready' });
  store.log('ok', `Brain connected: ${urlParsed.origin} (adapter: ${pickPreset(url).id})`);
}

export function brainTabId(): number | undefined {
  return store.state.brainTabId;
}

export async function submitToBrain(text: string): Promise<number> {
  const tabId = brainTabId();
  if (!tabId) throw new Error('Brain not connected');
  const seq = nextSeq();
  const resp = (await sendToTab(tabId, { kind: 'BRAIN_SUBMIT', text: wrapForBrain(text.trim(), seq), seq })) as
    | { ok?: boolean; error?: string }
    | undefined;
  if (resp && resp.ok === false) {
    throw new Error(`Brain submit failed: ${resp.error ?? 'unknown error'}`);
  }
  return seq;
}