// Self-contained functions injected into pages via chrome.scripting.executeScript.
// Each function must be fully self-contained (no imports, no closures over
// outer scope) — their sources are serialized across the process boundary.
//
// All of them receive data through `args` (the `args` option of executeScript).

export function instrumentReadPage() {
  const text = (document.body && document.body.innerText) || '';
  const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
  return {
    title: document.title,
    url: location.href,
    text: clamp(text, 120000),
    headings: Array.from(document.querySelectorAll('h1,h2,h3'))
      .slice(0, 40)
      .map((h) => (h as HTMLElement).innerText.trim())
      .filter(Boolean),
    links: Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).length
  };
}

export function instrumentReadHtml(args: { selector?: string; asText?: boolean }) {
  const el = args.selector ? document.querySelector(args.selector) : document.documentElement;
  if (!el) return { ok: false, error: 'selector not found' };
  const strlen = (s: string) => (s.length > 120000 ? s.slice(0, 120000) : s);
  const out = args.asText
    ? (el as HTMLElement).innerText
    : (el as HTMLElement).outerHTML;
  return { ok: true, value: strlen(out) };
}

export function instrumentClick(args: {
  selector?: string;
  text?: string;
  index?: number;
  double?: boolean;
}) {
  const index = args.index ?? 0;
  const clickNow = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    if (args.double)
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  };
  const info = (el: Element) => {
    const a = el as HTMLElement;
    return {
      tag: el.tagName.toLowerCase(),
      text: (a.innerText || a.textContent || '').trim().slice(0, 120),
      href: (el as HTMLAnchorElement).href || undefined,
      id: el.id || undefined
    };
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  if (args.text) {
    const els = Array.from(document.querySelectorAll<HTMLElement>('a,button,input[type=submit],input[type=button],[role=button],summary,.nav-link,.menu-item')).filter(
      (e) => visible(e) && (e.innerText || e.textContent || '').trim() === args.text
    );
    if (!els.length) return { ok: false, error: 'no element with text: ' + args.text };
    const el = els[Math.min(index, els.length - 1)];
    clickNow(el);
    return { ok: true, value: info(el), count: els.length };
  }
  if (args.selector) {
    const els = Array.from(document.querySelectorAll(args.selector));
    if (!els.length) return { ok: false, error: 'selector not found: ' + args.selector };
    const el = els[Math.min(index, els.length - 1)];
    clickNow(el);
    return { ok: true, value: info(el), count: els.length };
  }
  return { ok: false, error: 'need selector or text' };
}

export function instrumentType(args: {
  selector: string;
  text: string;
  pressEnter?: boolean;
  clear?: boolean;
}) {
  const el = document.querySelector<HTMLElement>(args.selector);
  if (!el) return { ok: false, error: 'selector not found: ' + args.selector };
  const type = (input: HTMLElement, value: string) => {
    if (input.isContentEditable || input.getAttribute('contenteditable') !== null) {
      input.focus();
      input.textContent = value;
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
      );
    } else if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      const proto =
        input.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const inner = input.querySelector('textarea, input, [contenteditable="true"]');
      if (inner) type(inner as HTMLElement, value);
      else return { ok: false, error: 'not a text field: ' + args.selector };
    }
    if (args.pressEnter) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      );
    }
    return { ok: true, valueLength: value.length };
  };
  return type(el, args.text);
}

export function instrumentScroll(args: {
  dx?: number;
  dy?: number;
  to?: 'top' | 'bottom' | 'page';
  selector?: string;
}) {
  if (args.selector) {
    const el = document.querySelector(args.selector);
    if (!el) return { ok: false, error: 'selector not found' };
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
  } else if (args.to === 'top') {
    window.scrollTo(0, 0);
  } else if (args.to === 'bottom') {
    window.scrollTo(0, document.body.scrollHeight);
  } else if (args.to === 'page') {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'auto' });
  } else {
    window.scrollBy({ top: args.dy ?? 0, left: args.dx ?? 0, behavior: 'auto' });
  }
  return {
    ok: true,
    scrollY: window.scrollY,
    scrollX: window.scrollX,
    docHeight: document.documentElement.scrollHeight,
    viewHeight: window.innerHeight
  };
}

export function instrumentFind(args: { text?: string; max?: number; interactiveOnly?: boolean }) {
  const max = Math.max(1, Math.min(args.max ?? 10, 50));
  const match = (args.text ?? '').toLowerCase();
  const out: Record<string, unknown>[] = [];
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const collect = (sel: string) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (out.length >= max) break;
      if (!visible(el)) continue;
      const t = (el.innerText || el.textContent || '').trim();
      if (!match || t.toLowerCase().includes(match)) {
        const r = el.getBoundingClientRect();
        out.push({
          tag: el.tagName.toLowerCase(),
          text: t.slice(0, 120),
          href: (el as HTMLAnchorElement).href || undefined,
          id: el.id || undefined,
          x: Math.round(r.left),
          y: Math.round(r.top)
        });
      }
    }
  };
  collect('a,button,[role=button],input,textarea,select,summary,[contenteditable="true"],h1,h2,h3,[data-tip]');
  if (out.length < max && !args.interactiveOnly) {
    collect('li,div,p,span');
  }
  return { ok: true, count: out.length, value: out.slice(0, max) };
}

export function instrumentRunJs(args: { code: string }) {
  try {
    const fn = new Function('return (' + args.code + ');') as () => unknown;
    const v = fn();
    let clean: unknown = v;
    if (v instanceof Element) {
      clean = { _element: v.tagName, text: (v as HTMLElement).innerText.slice(0, 500) };
    } else if (typeof v === 'function') {
      clean = String(v).slice(0, 200);
    } else if (typeof v === 'object' && v !== null) {
      try {
        JSON.stringify(v);
      } catch {
        clean = { _error: 'not json-serializable', type: Object.prototype.toString.call(v) };
      }
    } else if (v === undefined) {
      clean = { _value: 'undefined' };
    }
    return { ok: true, value: clean };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function instrumentWpSession() {
  const w = window as unknown as Record<string, unknown>;
  const settings = w.wpApiSettings as Record<string, unknown> | undefined;
  let root = settings?.root as string | undefined;
  const nonce = (settings?.nonce as string) || '';
  const user = (w.userSettings as Record<string, unknown> | undefined)?.uid as string | undefined;
  root = root || location.origin + '/wp-json/';
  const isAdmin = /\/wp-admin(\/|$)/i.test(location.pathname);
  const adminBar = document.querySelector('#wpadminbar') !== null;
  return {
    ok: true,
    url: location.href,
    origin: location.origin,
    restRoot: root,
    nonce,
    isAdmin,
    adminBar,
    user,
    loggedIn: adminBar || isAdmin
  };
}

export function instrumentWpRest(args: {
  method: string;
  path: string;
  body?: unknown;
  restRoot?: string;
  nonce?: string;
  headers?: Record<string, string>;
}) {
  const w = window as unknown as Record<string, unknown>;
  const settings = w.wpApiSettings as Record<string, unknown> | undefined;
  const root =
    args.restRoot ||
    (settings?.root as string) ||
    location.origin + '/wp-json/';
  const nonce = args.nonce || (settings?.nonce as string) || '';
  const headers: Record<string, string> = {
    ...(args.headers || {})
  };
  if (nonce) headers['X-WP-Nonce'] = nonce;
  if (args.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(root + args.path.replace(/^\/+/, ''), {
    method: args.method,
    headers,
    body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
    credentials: 'same-origin',
    redirect: 'follow'
  })
    .then(async (res) => {
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json')
        ? await res.json()
        : await res.text();
      return {
        ok: res.ok,
        status: res.status,
        value: data,
        notLoggedIn: res.status === 401,
        restRoot: root
      };
    })
    .catch((e) => ({ ok: false, error: String(e) }));
}

export function instrumentWpUpload(args: {
  name: string;
  mime: string;
  b64: string;
  restRoot?: string;
  nonce?: string;
}) {
  const w = window as unknown as Record<string, unknown>;
  const settings = w.wpApiSettings as Record<string, unknown> | undefined;
  const root =
    args.restRoot ||
    (settings?.root as string) ||
    location.origin + '/wp-json/';
  const nonce = args.nonce || (settings?.nonce as string) || '';
  const bin = atob(args.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: args.mime || 'application/octet-stream' });
  const fd = new FormData();
  fd.append('file', blob, args.name);
  const headers: Record<string, string> = {};
  if (nonce) headers['X-WP-Nonce'] = nonce;
  return fetch(root + 'wp/v2/media', {
    method: 'POST',
    headers,
    body: fd,
    credentials: 'same-origin'
  })
    .then(async (res) => {
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, value: data };
    })
    .catch((e) => ({ ok: false, error: String(e) }));
}

export async function instrumentWpEditorUi(args: {
  title?: string;
  content?: string;
  publish?: boolean;
}) {
  const help = (ok: boolean, msg: string) => ({ ok, message: msg });
  try {
    const titleInput = document.querySelector<HTMLInputElement>('#title');
    if (!titleInput) return help(false, 'no #title input (open the editor first)');
    if (typeof args.title === 'string') {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(titleInput, args.title);
      else titleInput.value = args.title;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    if (typeof args.content === 'string') {
      const w = window as unknown as Record<string, unknown>;
      const wpData = w.wp as
        | {
            data?: { dispatch?: (store: string) => Record<string, (m: unknown) => unknown> };
          }
        | undefined;
      const dispatch = wpData?.data?.dispatch;
      if (dispatch) {
        const editPost = dispatch('core/edit-post');
        const switchEditorMode = (editPost as Record<string, unknown>).switchEditorMode as
          | ((m: string) => unknown)
          | undefined;
        if (switchEditorMode) switchEditorMode('text');
      }
      await new Promise((r) => setTimeout(r, 600));
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea.editor-post-text-editor, textarea.editor-block-list__textarea, .block-editor textarea, textarea[name="content"]'
      );
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, args.content);
        else textarea.value = args.content;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        return help(false, 'could not switch to code editor textarea');
      }
    }

    if (args.publish) {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          'button.editor-post-publish-button, button.editor-post-publish-button__button, button.editor-post-save-draft, button.is-primary'
        )
      );
      const target =
        buttons.find((b) => /publish|update/i.test(b.innerText || b.getAttribute('aria-label') || '')) ||
        buttons[0];
      if (target) {
        target.scrollIntoView();
        target.click();
      } else {
        return help(false, 'no publish/update button found');
      }
    }
    return help(true, 'editor updated');
  } catch (e) {
    return help(false, String(e));
  }
}