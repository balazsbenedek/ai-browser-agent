# AI Browser Agent — WordPress Editor

Turn **any AI chat URL** into an autonomous agent that controls your entire browser —
**including every tab already open** — and is specialized for **editing WordPress**.

Built for **Brave** (and Chromium). Manifest V3 · React + TypeScript + Vite.

![icon](public/icons/icon128.png)

---

## What it does

1. You give it the URL of any AI chat (ChatGPT, Claude, Gemini, a local Open WebUI,
   any custom LLM interface).
2. The extension opens that AI in a tab and injects a **system prompt** describing a
   browser tool surface: list/open/activate/close tabs, screenshot, read pages, click,
   type, scroll, run JS — plus a dedicated **WordPress toolkit**.
3. The AI replies with fenced JSON tool calls like:

   ```` ```agent {"tool":"screenshot","args":{"tabId":3}} ``` ````

4. The extension executes the call, feeds the result back into the chat, and the loop
   continues until the task is done.

All tool calls go through the **extension's background worker**, so they work on tabs
that were opened *before the extension was installed*.

## WordPress specialization

Two ways to edit:

- **REST path (recommended, fast):** uses the site's REST API through your *logged-in*
  admin session (cookies + `wp_rest` nonce — **no passwords stored**). Tools:
  `wp_info`, `wp_list_posts`, `wp_read_post`, `wp_create_post`, `wp_edit_post`,
  `wp_publish`, `wp_trash_post`, `wp_add_media`.
- **UI path (human-like):** `wp_open_editor` opens the Gutenberg editor,
  `wp_edit_via_ui` edits title/content and clicks Update/Publish like a person.

## Install into Brave (dev mode)

1. **Build** the extension:
   ```bash
   npm install
   npm run build      # outputs ./dist
   ```
2. Open **`brave://extensions`** (or `chrome://extensions`).
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`dist/`** folder.

The toolbar icon opens the side panel.

> Using the toolbar button requires Brave ≥ 116. `chrome.debugger` and
> `<all_urls>` scripting are fine for a locally-loaded unpacked extension.

## Quick start

1. **Agent tab** → enter your AI chat URL (e.g. `https://chatgpt.com`) → **Connect**.
   The extension opens/attaches to a tab of that AI and handshakes with its chat box.
2. Make sure you're **logged into your WordPress wp-admin** in some tab; optionally add
   your site under the **WordPress** tab (name + URL).
3. Type a task in **Agent → Task** and press **Run**, e.g.:
   > "Find the post titled 'Launch day', change its title to 'Launch — Today',
   > add this image, and save it as a draft."
4. Watch the **event log**, approve write actions when prompted, and stop anytime.

## Tool surface the AI can use

| area | tools |
| --- | --- |
| Tabs | `list_tabs`, `get_tab`, `activate_tab`, `open_tab`, `close_tab`, `navigate`, `reload`, `back` |
| Page | `screenshot`, `read_page`, `read_html`, `find`, `click`, `type`, `press_key`, `scroll`, `run_js`, `wait` |
| WordPress | `wp_info`, `wp_list_posts`, `wp_read_post`, `wp_create_post`, `wp_edit_post`, `wp_publish`, `wp_trash_post`, `wp_add_media`, `wp_open_editor`, `wp_edit_via_ui` |

## Safety

- **Read-only** tools run freely.
- **Write** actions (click, type, publish, edit…) pause and ask for your **Approve/Deny**
  in the panel (toggleable: *Settings → auto-approve writes*).
- **Destructive** tools (delete/trash/close tab) are blocked until you enable
  *Settings → allow destructive*.
- The agent can also **`ask_user`** a question mid-task if it gets stuck.

## Does it work with "any AI"?

The connection layer is selector-driven. Built-in presets exist for ChatGPT, Claude,
Gemini and Open WebUI; anything else uses the **generic** adapter, where you set CSS
selectors for the chat's input box / send button / message area in
**Settings → AI chat selectors**. If the agent can't type into or read your AI's page,
that's where you tune it.

## Project layout

```
src/background/        service worker: router, agent loop, tool engine, WordPress engine
src/content/           brainAdapter (chat bridge) + instrument functions (page/CDP helpers)
src/sidepanel/         React UI: agent console, tab manager, WordPress, settings
src/shared/            types + runtime message + tool-call wire protocol
scripts/               icon generator
```

### Wire protocol (shared/toolcall.ts)

- AI → extension: fenced ` ```agent {"tool":...,"args":{...}} ``` ` blocks
- extension → AI: `[tool results]` blocks
- Terminal call: ` ```agent {"tool":"done","args":{"summary":"..."}} ``` `

## License

MIT