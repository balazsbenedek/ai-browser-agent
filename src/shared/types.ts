export type BrainStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'submitting'
  | 'asking'
  | 'running'
  | 'stopped'
  | 'error';

export interface TabInfo {
  id?: number;
  windowId: number;
  index: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  audible?: boolean;
  favIconUrl?: string;
}

/** CSS-selector based description of a chat UI. Works for "any" AI page. */
export interface BrainAdapterConfig {
  /** CSS selector of the chat input (textarea/input OR [contenteditable]). */
  input: string;
  /** Optional CSS selector of the send button. Falls back to Enter key. */
  send?: string;
  /** CSS selector(s) matching each assistant message element. */
  messages?: string;
  /** CSS selector(s) that, while present, indicate the AI is busy. */
  loading?: string[];
  /** Root to watch when a `messages` selector is not provided. */
  container?: string;
  /** After this many ms with a stable response, we consider the turn done. */
  stabilityMs?: number;
  /** How long to wait for the AI to reply before giving up a turn. */
  timeoutMs?: number;
}

export interface AdapterPreset {
  id: string;
  label: string;
  test: (url: string) => boolean;
  config: BrainAdapterConfig;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export type LogKind =
  | 'info'
  | 'call'
  | 'result'
  | 'brain'
  | 'ok'
  | 'error'
  | 'approval'
  | 'ask';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  text: string;
}

export interface WPSite {
  id: string;
  name: string;
  url: string;
}

export interface ApprovalReq {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  tabId?: number;
  tabUrl?: string;
}

export interface PendingQuestion {
  id: string;
  text: string;
}

export interface AppState {
  status: BrainStatus;
  brainUrl: string;
  brainTabId?: number;
  connected: boolean;
  adapterId: string;
  adapter: BrainAdapterConfig;
  currentTask?: string;
  turn: number;
  maxTurns: number;
  running: boolean;
  logs: LogEntry[];
  pendingApproval?: ApprovalReq;
  autoApproveWrites: boolean;
  allowDestructive: boolean;
  pendingQuestion?: PendingQuestion;
  wpSites: WPSite[];
  lastResult?: string;
}