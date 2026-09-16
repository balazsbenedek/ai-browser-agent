import { useEffect, useRef, useState } from 'react';
import type { AppState, LogEntry, TabInfo, WPSite } from '../shared/types';
import { sendToBackground } from '../shared/messages';

type TabKey = 'agent' | 'tabs' | 'wp' | 'settings';

const cmd = (action: string, payload?: Record<string, unknown>) =>
  sendToBackground({ kind: 'CMD', action, payload });
const cmdR = <T,>(action: string, payload?: Record<string, unknown>): Promise<T> =>
  chrome.runtime.sendMessage({ kind: 'CMD', action, payload }) as Promise<T>;

const timeAgo = (t?: number) => (t ? new Date(t).toLocaleTimeString() : '');

function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LogRow({ e }: { e: LogEntry }) {
  return (
    <div className={`log log-${e.kind}`}>
      <span className="log-t">{timeAgo(e.t)}</span>
      <span className="log-body">{e.text}</span>
    </div>
  );
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<TabKey>('agent');
  const [brainUrlInput, setBrainUrlInput] = useState('');
  const [taskInput, setTaskInput] = useState('');
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [note, setNote] = useState('');
  const [askInput, setAskInput] = useState('');
  const [wpPosts, setWpPosts] = useState<Record<string, unknown>[]>([]);
  const [wpNotice, setWpNotice] = useState('');
  const [wpName, setWpName] = useState('');
  const [wpUrl, setWpUrl] = useState('');
  const [adapterInput, setAdapterInput] = useState('');
  const [adapterSend, setAdapterSend] = useState('');
  const [adapterMessages, setAdapterMessages] = useState('');
  const [adapterLoading, setAdapterLoading] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (msg: unknown) => {
      const m = msg as { kind?: string; state?: AppState };
      if (m?.kind === 'STATE_SNAPSHOT' && m.state) {
        setState(m.state);
        setBrainUrlInput((prev) => (prev ? prev : m.state!.brainUrl));
      }
    };
    chrome.runtime.onMessage.addListener(h);
    sendToBackground({ kind: 'PANEL_READY' });
    void refreshTabs();
    return () => chrome.runtime.onMessage.removeListener(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state) return;
    setAdapterInput(state.adapter.input ?? '');
    setAdapterSend(state.adapter.send ?? '');
    setAdapterMessages(state.adapter.messages ?? '');
    setAdapterLoading((state.adapter.loading ?? []).join(', '));
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state]);

  const refreshTabs = async () => {
    try {
      const res = await cmdR<{ ok: true; value: TabInfo[] }>('list-tabs');
      if (res?.ok) setTabs(res.value);
    } catch {
      /* panel closing */
    }
  };

  const connect = async () => {
    if (brainUrlInput.trim()) cmd('set-brain-url', { url: brainUrlInput.trim() });
    setNote('Connecting…');
    const res = await cmdR<{ ok: boolean; error?: string }>('connect');
    setNote(res?.ok ? 'Connected' : res?.error ?? 'connect failed');
  };

  const runTask = () => {
    if (taskInput.trim()) sendToBackground({ kind: 'SPAWN_TASK', text: taskInput.trim() });
  };

  const refreshPosts = async () => {
    setWpNotice('Loading…');
    const res = await cmdR<{ ok: boolean; value?: unknown; error?: string }>('wp:list');
    if (res?.ok) {
      const v = res.value as { posts?: Record<string, unknown>[] } | undefined;
      setWpPosts(v?.posts ?? []);
      setWpNotice('Loaded');
    } else {
      setWpPosts([]);
      setWpNotice(res?.error ?? 'failed');
    }
  };

  const saveSettings = () => {
    const host = state?.brainUrl ? hostName(state.brainUrl) : '';
    cmd('save-settings', {
      autoApproveWrites: state?.autoApproveWrites,
      allowDestructive: state?.allowDestructive,
      maxTurns: state?.maxTurns,
      host,
      adapter: {
        input: adapterInput,
        send: adapterSend,
        messages: adapterMessages,
        loading: adapterLoading
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
    });
  };

  const s = state;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">AI Browser Agent</div>
        <nav className="tabs">
          {(['agent', 'tabs', 'wp', 'settings'] as TabKey[]).map((k) => (
            <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
              {k === 'agent' ? 'Agent' : k === 'tabs' ? 'Tabs' : k === 'wp' ? 'WordPress' : 'Settings'}
            </button>
          ))}
        </nav>
        <span className={`dot ${s?.connected ? 'on' : ''}`} title={s?.connected ? 'brain connected' : 'brain not connected'} />
      </header>

      <div className="approval-area">
        {s?.pendingApproval && (
          <div className="banner banner-approval">
            <div className="banner-title">Approve action</div>
            <code className="banner-code">
              {s.pendingApproval.tool} {JSON.stringify(s.pendingApproval.args)}
            </code>
            <div className="banner-actions">
              <button
                className="btn primary"
                onClick={() => sendToBackground({ kind: 'APPROVAL_RESPONSE', id: s.pendingApproval!.id, approved: true })}
              >
                Approve
              </button>
              <button
                className="btn"
                onClick={() => sendToBackground({ kind: 'APPROVAL_RESPONSE', id: s.pendingApproval!.id, approved: false })}
              >
                Deny
              </button>
            </div>
          </div>
        )}
        {s?.pendingQuestion && (
          <div className="banner banner-ask">
            <div className="banner-title">The agent asks</div>
            <div className="banner-text">{s.pendingQuestion.text}</div>
            <div className="row">
              <input
                className="input grow"
                value={askInput}
                placeholder="your answer"
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    sendToBackground({ kind: 'ASK_RESPONSE', id: s.pendingQuestion!.id, text: askInput });
                    setAskInput('');
                  }
                }}
              />
              <button
                className="btn primary"
                onClick={() => {
                  sendToBackground({ kind: 'ASK_RESPONSE', id: s.pendingQuestion!.id, text: askInput });
                  setAskInput('');
                }}
              >
                Send
              </button>
              <button className="btn" onClick={() => sendToBackground({ kind: 'ASK_RESPONSE', id: s.pendingQuestion!.id, text: '' })}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {note && <div className="banner banner-note">{note}</div>}
      </div>

      {tab === 'agent' && (
        <div className="section">
          <div className="card">
            <label>AI brain URL</label>
            <div className="row">
              <input
                className="input grow"
                value={brainUrlInput}
                placeholder="https://chatgpt.com"
                onChange={(e) => setBrainUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void connect()}
              />
              <button className="btn primary" onClick={() => void connect()}>
                Connect
              </button>
              <button className="btn" onClick={() => cmd('open-brain')}>
                Open AI
              </button>
            </div>
            {s && (
              <div className="hint">
                {s.connected
                  ? `Connected to ${s.brainUrl} — adapter ${s.adapterId}`
                  : 'Not connected. Set the URL of any AI chat and press Connect.'}
              </div>
            )}
          </div>

          <div className="card">
            <label>Task for the agent</label>
            <textarea
              className="input textarea"
              rows={4}
              value={taskInput}
              placeholder={'e.g. "Find the post titled Launch day in my WordPress, change its title to Launch — Today, then publish it."'}
              onChange={(e) => setTaskInput(e.target.value)}
            />
            <div className="row">
              <button className="btn primary" onClick={runTask} disabled={s?.running}>
                Run
              </button>
              <button className="btn danger" onClick={() => sendToBackground({ kind: 'STOP' })} disabled={!s?.running}>
                Stop
              </button>
              {s && (
                <span className="hint">
                  turn {s.turn}/{s.maxTurns} · {s.running ? 'running' : s.status}
                </span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <label>Event log</label>
              <button className="btn small" onClick={() => cmd('clear-logs')}>
                clear
              </button>
            </div>
            <div className="logbox" ref={logRef}>
              {(s?.logs ?? []).map((e) => (
                <LogRow key={e.id} e={e} />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'tabs' && (
        <div className="section">
          <div className="card">
            <div className="card-head">
              <label>Open tabs ({tabs.length})</label>
              <button className="btn small" onClick={() => void refreshTabs()}>
                refresh
              </button>
            </div>
            <div className="tablist">
              {tabs.map((t, i) => (
                <div className="tabrow" key={t.id ?? i}>
                  <span className="tab-fav">
                    {t.favIconUrl ? <img src={t.favIconUrl} alt="" /> : t.active ? '●' : '○'}
                  </span>
                  <div className="tab-meta">
                    <div className="tab-title">{t.title || '(empty tab)'}</div>
                    <div className="tab-url">{t.url}</div>
                  </div>
                  <button className="btn small" onClick={() => void cmd('activate-tab', { tabId: t.id })}>
                    Show
                  </button>
                  <button
                    className="btn small danger"
                    onClick={() => {
                      void cmd('close-tab', { tabId: t.id });
                      void refreshTabs();
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'wp' && (
        <div className="section">
          <div className="card">
            <label>Configured WordPress sites</label>
            {s && s.wpSites.length ? (
              <div className="tablist">
                {s.wpSites.map((site: WPSite) => (
                  <div className="tabrow" key={site.id}>
                    <div className="tab-meta">
                      <div className="tab-title">{site.name}</div>
                      <div className="tab-url">{site.url}</div>
                    </div>
                    <button className="btn small" onClick={() => cmd('remove-wp-site', { id: site.id })}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="hint">None yet. Add the URL of a site you're logged into (e.g. https://mysite.com/wp-admin/).</div>
            )}
            <div className="row">
              <input className="input grow" placeholder="name" value={wpName} onChange={(e) => setWpName(e.target.value)} />
              <input className="input grow" placeholder="https://example.com/wp-admin/" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)} />
              <button
                className="btn primary"
                onClick={() => {
                  void cmd('add-wp-site', { name: wpName, url: wpUrl });
                  setWpName('');
                  setWpUrl('');
                }}
              >
                + Add
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <label>Recent posts (from a logged-in tab)</label>
              <button className="btn small" onClick={() => void refreshPosts()}>
                load
              </button>
            </div>
            {wpNotice && <div className="hint">{wpNotice}</div>}
            <div className="tablist">
              {wpPosts.map((p) => (
                <div className="tabrow" key={p.id as string}>
                  <div className="tab-meta">
                    <div className="tab-title">{String((p.title as { rendered?: string })?.rendered ?? '(no title)')}</div>
                    <div className="tab-url">#{String(p.id)} · {String(p.status)}</div>
                  </div>
                  <button className="btn small" onClick={() => cmd('wp:open', { postId: Number(p.id) })}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="section">
          <div className="card">
            <label>Safety</label>
            <label className="checkline">
              <input
                type="checkbox"
                checked={s?.autoApproveWrites ?? false}
                onChange={(e) => cmd('save-settings', { autoApproveWrites: e.target.checked })}
              />
              Auto-approve write actions
            </label>
            <label className="checkline">
              <input
                type="checkbox"
                checked={s?.allowDestructive ?? false}
                onChange={(e) => cmd('save-settings', { allowDestructive: e.target.checked })}
              />
              Allow destructive actions (delete/trash)
            </label>
            <label className="checkline">
              Max turns
              <input
                type="number"
                className="input num"
                value={s?.maxTurns ?? 60}
                onChange={(e) => cmd('save-settings', { maxTurns: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="card">
            <label>AI chat selectors</label>
            <div className="hint">
              CSS selectors describing the connected AI's chat page (saved per brain URL). Tune these if the agent can't type into or read replies from your AI.
            </div>
            <label className="field">
              Input box
              <input className="input" value={adapterInput} onChange={(e) => setAdapterInput(e.target.value)} />
            </label>
            <label className="field">
              Send button
              <input className="input" value={adapterSend} onChange={(e) => setAdapterSend(e.target.value)} />
            </label>
            <label className="field">
              Assistant messages (empty = auto-detect)
              <input className="input" value={adapterMessages} onChange={(e) => setAdapterMessages(e.target.value)} />
            </label>
            <label className="field">
              Loading indicator(s), comma-separated
              <input className="input" value={adapterLoading} onChange={(e) => setAdapterLoading(e.target.value)} />
            </label>
            <button className="btn primary" onClick={saveSettings}>
              Save selectors
            </button>
          </div>
        </div>
      )}

      <footer className="foot">AI Browser Agent · connects your AI to your browser.</footer>
    </div>
  );
}