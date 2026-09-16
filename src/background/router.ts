import { store } from './store';
import {
  handleApprovalResponse,
  handleAskResponse,
  handleBrainMessage,
  startTask,
  stopTask
} from './loop';
import { ensureConnected } from './brain/brain';
import { activateTab, listTabs, openTab } from './tabs';
import { quickListPosts, quickOpenEditor } from './wp/engine';
import type { WPSite } from '../shared/types';

const OK = (value: unknown = null): { ok: true; value: unknown } => ({ ok: true, value });

function err(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}

async function handleCmd(action: string, payload: Record<string, unknown> | undefined): Promise<unknown> {
  switch (action) {
    case 'connect': {
      try {
        await ensureConnected();
        return OK();
      } catch (e) {
        return err(String(e));
      }
    }
    case 'list-tabs':
      return OK(await listTabs());
    case 'activate-tab': {
      const id = Number(payload?.tabId);
      if (!id) return err('tabId required');
      await activateTab(id);
      return OK();
    }
    case 'close-tab': {
      const id = Number(payload?.tabId);
      if (!id) return err('tabId required');
      await chrome.tabs.remove(id);
      return OK();
    }
    case 'open-brain': {
      const url = store.state.brainUrl || 'https://chatgpt.com';
      const id = await openTab(url);
      return OK({ tabId: id, url });
    }
    case 'set-brain-url': {
      const url = String(payload?.url ?? '').trim();
      if (!url) return err('url required');
      store.patch({ brainUrl: url, connected: false });
      return OK();
    }
    case 'clear-logs':
      store.clearLogs();
      return OK();
    case 'save-settings': {
      const p = payload ?? {};
      if (typeof p.autoApproveWrites === 'boolean') store.patch({ autoApproveWrites: p.autoApproveWrites });
      if (typeof p.allowDestructive === 'boolean') store.patch({ allowDestructive: p.allowDestructive });
      if (typeof p.maxTurns === 'number') store.patch({ maxTurns: p.maxTurns });
      if (p.adapter && typeof p.adapter === 'object') {
        const a = p.adapter as Partial<import('../shared/types').BrainAdapterConfig>;
        store.state.adapter = { ...store.state.adapter, ...a };
        // persist as a per-host override when we know the brain host
        const host = typeof p.host === 'string' && p.host ? p.host : undefined;
        if (host) store.settings.brainConfigs[host] = store.state.adapter;
        void store.persist();
        store.broadcast();
      }
      return OK();
    }
    case 'save-host-config': {
      const host = String(payload?.host ?? '');
      if (!host || store.state.brainTabId === undefined) return err('host required');
      const existingTabs = await listTabs();
      const target = existingTabs.find((t) => t.id === store.state.brainTabId);
      if (!target) return err('brain tab closed');
      // config lives against the brain host
      const cfg = { ...store.settings.brainConfigs[host] };
      for (const key of ['input', 'send', 'messages', 'container', 'stabilityMs', 'timeoutMs'] as const) {
        const v = payload?.[key];
        if (v !== undefined) (cfg as unknown as Record<string, unknown>)[key] = v;
      }
      store.settings.brainConfigs[host] = cfg;
      void store.persist();
      store.broadcast();
      return OK();
    }
    case 'add-wp-site': {
      const name = String(payload?.name ?? '').trim();
      const url = String(payload?.url ?? '').trim();
      if (!name || !url) return err('name and url required');
      try {
        new URL(url);
      } catch {
        return err('invalid url');
      }
      const site: WPSite = { id: `${Date.now()}`, name, url };
      store.state.wpSites = [...store.state.wpSites, site];
      void store.persist();
      store.broadcast();
      return OK({ site });
    }
    case 'remove-wp-site': {
      const id = String(payload?.id ?? '');
      store.state.wpSites = store.state.wpSites.filter((s) => s.id !== id);
      void store.persist();
      store.broadcast();
      return OK();
    }
    case 'wp:list': {
      const r = await quickListPosts();
      return r.ok ? OK({ posts: r.posts, tabId: r.tabId }) : err(r.error ?? 'wp:list failed');
    }
    case 'wp:open': {
      try {
        const existing =
          payload?.tabId && payload.origin
            ? { tabId: Number(payload.tabId), origin: String(payload.origin) }
            : undefined;
        const id = typeof payload?.postId === 'number' ? payload.postId : undefined;
        const r = await quickOpenEditor(existing, id);
        return OK(r);
      } catch (e) {
        return err(String(e));
      }
    }
    default:
      return err(`unknown action: ${action}`);
  }
}

function handleMessage(msg: unknown, _sender: chrome.runtime.MessageSender): unknown {
  if (!msg || typeof msg !== 'object') return undefined;
  const m = msg as Record<string, unknown>;
  switch (m.kind) {
    case 'BRAIN_READY':
      // adapter announced itself on a page; nothing to act on right now
      return undefined;
    case 'BRAIN_MESSAGE':
      handleBrainMessage(String(m.text ?? ''));
      return undefined;
    case 'SPAWN_TASK':
      void startTask(String(m.text ?? ''));
      return undefined;
    case 'STOP':
      stopTask();
      return undefined;
    case 'PANEL_READY':
      store.broadcast();
      return undefined;
    case 'APPROVAL_RESPONSE':
      handleApprovalResponse(String(m.id ?? ''), Boolean(m.approved));
      return undefined;
    case 'ASK_RESPONSE':
      handleAskResponse(String(m.id ?? ''), String(m.text ?? ''));
      return undefined;
    case 'CMD':
      return handleCmd(String(m.action ?? ''), (m.payload ?? undefined) as Record<string, unknown> | undefined);
    default:
      return undefined;
  }
}

export function registerRouter(): void {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => {
      const handled = handleMessage(msg, sender) as Promise<unknown> | undefined;
      if (handled && typeof (handled as Promise<unknown>).then === 'function') {
        void Promise.resolve(handled).then(sendResponse);
        return true;
      }
      return undefined;
    }
  );
}