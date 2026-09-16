import { store } from './store';
import { registerRouter } from './router';

let booted = false;

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  await store.init();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  registerRouter();
  store.broadcast();
  console.log('[AI Browser Agent] background ready');
}

chrome.runtime.onInstalled.addListener(() => void boot());
chrome.runtime.onStartup.addListener(() => void boot());
chrome.tabs.onRemoved.addListener((tabId) => {
  if (store.state.brainTabId === tabId) {
    store.patch({ brainTabId: undefined, connected: false, status: 'idle' });
  }
});
if (chrome.runtime.id) void boot();