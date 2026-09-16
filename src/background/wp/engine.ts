import {
  instrumentWpEditorUi,
  instrumentWpRest,
  instrumentWpSession,
  instrumentWpUpload
} from '../../content/instrument';
import { inject, listTabs } from '../tabs';
import { store } from '../store';

export interface WpSession {
  ok: boolean;
  url: string;
  origin: string;
  restRoot: string;
  nonce: string;
  isAdmin: boolean;
  adminBar: boolean;
  user?: string;
  loggedIn: boolean;
}

export interface RestReply {
  ok: boolean;
  status?: number;
  value?: unknown;
  notLoggedIn?: boolean;
  error?: string;
  restRoot?: string;
}

export async function sessionAt(tabId: number): Promise<WpSession> {
  return inject<WpSession>(tabId, instrumentWpSession, [], 'MAIN');
}

export async function rest(
  tabId: number,
  method: string,
  path: string,
  body?: unknown
): Promise<RestReply> {
  const reply = await inject<RestReply>(tabId, instrumentWpRest, [
    { method, path, body }
  ], 'MAIN');
  if (typeof reply === 'string') return { ok: false, error: reply };
  return reply;
}

export async function upload(
  tabId: number,
  name: string,
  mime: string,
  b64: string
): Promise<RestReply> {
  const reply = await inject<RestReply>(tabId, instrumentWpUpload, [
    { name, mime, b64 }
  ], 'MAIN');
  if (typeof reply === 'string') return { ok: false, error: reply };
  return reply;
}

export async function editViaUi(
  tabId: number,
  opts: { title?: string; content?: string; publish?: boolean }
): Promise<{ ok: boolean; message?: string }> {
  const reply = await inject<{ ok: boolean; message?: string }>(
    tabId,
    instrumentWpEditorUi,
    [opts],
    'MAIN'
  );
  return reply;
}

export function adminUrl(origin: string, postId?: number | string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  if (postId) return `${base}/wp-admin/post.php?post=${postId}&action=edit`;
  return `${base}/wp-admin/post-new.php`;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Find an open, matching tab for a configured WP site (or the active tab). */
export async function storedWpTab(): Promise<{ tabId: number; origin: string } | undefined> {
  for (const site of store.state.wpSites) {
    const origin = originOf(site.url);
    if (!origin) continue;
    const tabs = await listTabs();
    for (const t of tabs) {
      if (!t.url || t.id === undefined) continue;
      if (originOf(t.url) === origin) return { tabId: t.id, origin };
    }
  }
  const [a] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (a?.id !== undefined && a.url) {
    const origin = originOf(a.url);
    if (origin) return { tabId: a.id, origin };
  }
  return undefined;
}

export async function quickListPosts(): Promise<{ ok: boolean; posts?: unknown; error?: string; tabId?: number }> {
  const t = await storedWpTab();
  if (!t) return { ok: false, error: 'Open a WordPress tab or add your site in Settings → WordPress.' };
  const session = await sessionAt(t.tabId);
  if (!session.loggedIn && !session.nonce) {
    return { ok: false, error: `Not logged into WordPress at ${t.origin}. Log in via wp-admin first.` };
  }
  const r = await rest(
    t.tabId,
    'GET',
    'wp/v2/posts?per_page=15&orderby=modified&_fields=id,title.rendered,status,date,link'
  );
  if (!r.ok) return { ok: false, error: `WP REST error ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}` };
  return { ok: true, posts: r.value, tabId: t.tabId };
}

export async function quickOpenEditor(existing: { tabId: number; origin: string } | undefined, postId?: number): Promise<{ url: string; tabId?: number }> {
  let t = existing ?? (await storedWpTab());
  if (!t) {
    const site = store.state.wpSites[0];
    if (!site) throw new Error('No WordPress site configured (Settings → WordPress)');
    t = { tabId: await chrome.tabs.create({ url: site.url }).then((x) => x.id as number), origin: originOf(site.url) ?? '' };
    await new Promise((r) => setTimeout(r, 500));
  }
  const url = adminUrl(t.origin, postId);
  await chrome.tabs.update(t.tabId, { url, active: true });
  return { url, tabId: t.tabId };
}