import type { Tool } from './browser';
import type { ToolResult } from '../../shared/types';
import { listTabs, waitForTabLoad, pickTabArgs } from '../tabs';
import { store } from '../store';
import { adminUrl, editViaUi, rest, sessionAt, upload } from '../wp/engine';

const fail = (error: string): ToolResult => ({ ok: false, error });

/** Find which open tab is "the WordPress tab". */
async function findWpTab(
  args: Record<string, unknown>,
  defaultTabId?: number
): Promise<{ tabId: number; origin: string; note: string } | { error: string }> {
  const picked = pickTabArgs(args);
  if (typeof picked.tabId === 'number') {
    const tab = await chrome.tabs.get(picked.tabId).catch(() => undefined);
    if (!tab || !tab.url) return { error: `no tab ${picked.tabId}` };
    const origin = new URL(tab.url).origin;
    return { tabId: picked.tabId, origin, note: 'explicit tab' };
  }
  // match a configured WP site
  for (const site of store.state.wpSites) {
    let siteOrigin = '';
    try {
      siteOrigin = new URL(site.url).origin;
    } catch {
      continue;
    }
    const tabs = await listTabs();
    for (const t of tabs) {
      if (!t.url) continue;
      try {
        if (new URL(t.url).origin === siteOrigin) return { tabId: t.id as number, origin: siteOrigin, note: `matches site "${site.name}"` };
      } catch {
        /* skip */
      }
    }
  }
  const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const a = active[0];
  if (a?.id !== undefined && a.url) {
    return { tabId: a.id, origin: new URL(a.url).origin, note: 'active tab' };
  }
  if (typeof defaultTabId === 'number') {
    const tab = await chrome.tabs.get(defaultTabId).catch(() => undefined);
    if (tab?.url) return { tabId: defaultTabId, origin: new URL(tab.url).origin, note: 'task-start tab' };
  }
  return { error: 'no WordPress tab found — open the site’s wp-admin or configure it in Settings' };
}

async function needSession(
  args: Record<string, unknown>,
  defaultTabId?: number
): Promise<{ tabId: number; origin: string; session: Awaited<ReturnType<typeof sessionAt>> } | { error: string }> {
  const t = await findWpTab(args, defaultTabId);
  if ('error' in t) return t;
  const session = await sessionAt(t.tabId);
  if (!session.loggedIn && !session.nonce) {
    return { error: `not logged into WordPress at ${t.origin}. Hint: open ${t.origin}/wp-admin/ and log in as admin first.` };
  }
  return { tabId: t.tabId, origin: t.origin, session };
}

export const wpTools: Tool[] = [
  {
    name: 'wp_info',
    mode: 'read',
    brief: 'Describe the WordPress session: which tab, if logged in (admin bar / REST nonce), REST root. args: {tabId?}.',
    run: async (ctx, args) => {
      const t = await findWpTab(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const session = await sessionAt(t.tabId);
      return { ok: true, value: { ...session, tabId: t.tabId, matched: t.note } };
    }
  },
  {
    name: 'wp_list_posts',
    mode: 'read',
    brief: 'List posts. args: {tabId?, perPage?=20, status?:"publish|draft|pending|future|trash|any", search?}. Returns id,title,status,date,link.',
    run: async (ctx, args) => {
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const perPage = Math.min(Math.max(Number(args.perPage ?? 20), 1), 100);
      const q = new URLSearchParams({
        per_page: String(perPage),
        orderby: args.orderby ? String(args.orderby) : 'modified',
        order: 'desc',
        _fields: 'id,title.rendered,status,date,link,modified'
      });
      if (args.status) q.set('status', String(args.status));
      if (args.search) q.set('search', String(args.search));
      const r = await rest(t.tabId, 'GET', `wp/v2/posts?${q.toString()}`);
      if (!r.ok) return fail(r.notLoggedIn ? 'wordpress: not logged in (open wp-admin and log in)' : `wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: { count: (r.value as unknown[]).length, posts: r.value } };
    }
  },
  {
    name: 'wp_read_post',
    mode: 'read',
    brief: 'Read a post {id}: title, status, content (HTML rendered + raw), link. args: {id, tabId?}.',
    run: async (ctx, args) => {
      const id = String(args.id ?? '').trim();
      if (!id) return fail('id required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const r = await rest(t.tabId, 'GET', `wp/v2/posts/${id}?_fields=id,title.rendered,title.raw,content.rendered,content.raw,status,date,link,modified,slug,excerpt.rendered`);
      if (!r.ok) return fail(r.notLoggedIn ? 'wordpress: not logged in' : `wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_create_post',
    mode: 'write',
    brief: 'Create a NEW post. args: {title, content?, status?:"draft"|"publish"|"pending", tabId?}. Returns id.',
    run: async (ctx, args) => {
      const title = String(args.title ?? '');
      if (!title.trim()) return fail('title required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const r = await rest(t.tabId, 'POST', 'wp/v2/posts', {
        title,
        content: args.content !== undefined ? String(args.content) : '',
        status: args.status || 'draft'
      });
      if (!r.ok) return fail(`wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_edit_post',
    mode: 'write',
    brief: 'Edit an existing post. args: {id, title?, content?, status?(draft|publish|pending), tabId?}.',
    run: async (ctx, args) => {
      const id = String(args.id ?? '').trim();
      if (!id) return fail('id required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const body: Record<string, unknown> = {};
      if (typeof args.title === 'string') body.title = args.title;
      if (typeof args.content === 'string') body.content = args.content;
      if (typeof args.status === 'string') body.status = args.status;
      if (!Object.keys(body).length) return fail('nothing to edit: pass title, content or status');
      const r = await rest(t.tabId, 'POST', `wp/v2/posts/${id}`, body);
      if (!r.ok) return fail(`wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_publish',
    mode: 'write',
    brief: 'Publish (set status=publish) a post. args: {id, tabId?}.',
    run: async (ctx, args) => {
      const id = String(args.id ?? '').trim();
      if (!id) return fail('id required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const r = await rest(t.tabId, 'POST', `wp/v2/posts/${id}`, { status: 'publish' });
      if (!r.ok) return fail(`wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_trash_post',
    mode: 'destructive',
    brief: 'Move a post {id} to the trash. Only when the user asks. args: {id, tabId?}.',
    run: async (ctx, args) => {
      const id = String(args.id ?? '').trim();
      if (!id) return fail('id required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const r = await rest(t.tabId, 'DELETE', `wp/v2/posts/${id}`);
      if (!r.ok) return fail(`wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_add_media',
    mode: 'write',
    brief: 'Upload an image to the media library. args: {name:"file.png", mime:"image/png", dataBase64:"...", tabId?}. Returns attachment.',
    run: async (ctx, args) => {
      const name = String(args.name ?? '');
      const b64 = String(args.dataBase64 ?? '');
      if (!name || !b64) return fail('name and dataBase64 required');
      const t = await needSession(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const r = await upload(t.tabId, name, String(args.mime ?? 'application/octet-stream'), b64);
      if (!r.ok) return fail(`wordpress error: ${r.status ?? '?'} ${JSON.stringify(r.value ?? r.error)}`);
      return { ok: true, value: r.value };
    }
  },
  {
    name: 'wp_open_editor',
    mode: 'write',
    brief: 'Open the Gutenberg editor for a post {id} (or post-new.php if no id) in a tab and activate it. args: {id?, tabId?}.',
    run: async (ctx, args) => {
      const t = await findWpTab(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const url = adminUrl(t.origin, args.id ? String(args.id) : undefined);
      await chrome.tabs.update(t.tabId, { url, active: true });
      await waitForTabLoad(t.tabId, 25000);
      return { ok: true, value: { tabId: t.tabId, url } };
    }
  },
  {
    name: 'wp_edit_via_ui',
    mode: 'write',
    brief: 'Human-style edit in the currently-open editor tab: args {title?, content?, publish?:boolean, tabId?}. Slower, visual Gutenberg path.',
    run: async (ctx, args) => {
      const t = await findWpTab(args, ctx.defaultTabId);
      if ('error' in t) return fail(t.error);
      const url = (await currentUrl(t.tabId)) || '';
      if (!/wp-admin\/post(-new)?\.php/.test(url)) {
        return fail('not on the post editor page — call wp_open_editor first');
      }
      const done = await editViaUi(t.tabId, {
        title: typeof args.title === 'string' ? args.title : undefined,
        content: typeof args.content === 'string' ? args.content : undefined,
        publish: Boolean(args.publish)
      });
      return done.ok ? { ok: true, value: done } : fail(done.message ?? 'editor edit failed');
    }
  }
];

async function currentUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  return tab?.url ?? '';
}