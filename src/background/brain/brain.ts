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
  let ensured = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const resp = (await sendToTab(tabId, { kind: 'BRAIN_ENSURE' })) as { ok?: boolean } | undefined;
      if (resp?.ok) {
        ensured = true;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(800);
  }
  if (!ensured) {
    throw new Error(
      'Could not reach the brain page. Reload the AI tab once. It must be a normal HTTPS page (not chrome://, not a PDF).'
    );
  }
  await sendToTab(tabId, { kind: 'BRAIN_SETUP', config });
  store.patch({ brainTabId: tabId, connected: true, adapter: config, status: 'ready' });
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