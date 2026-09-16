import type {
  AppState,
  BrainAdapterConfig,
  BrainStatus,
  LogEntry,
  LogKind,
  WPSite
} from '../shared/types';
import { sendToPanel } from '../shared/messages';

const LOG_CAP = 500;

export const defaultAdapter: BrainAdapterConfig = {
  input: '#prompt-textarea',
  send: '',
  messages: '',
  loading: [],
  stabilityMs: 1500,
  timeoutMs: 120000
};

export interface Settings {
  brainUrl: string;
  adapter: BrainAdapterConfig;
  autoApproveWrites: boolean;
  allowDestructive: boolean;
  maxTurns: number;
  wpSites: WPSite[];
  /** per-host custom selector overrides */
  brainConfigs: Record<string, BrainAdapterConfig>;
}

let logCounter = 0;

function freshState(): AppState {
  return {
    status: 'idle',
    brainUrl: '',
    connected: false,
    adapterId: 'custom',
    adapter: { ...defaultAdapter },
    turn: 0,
    maxTurns: 60,
    running: false,
    logs: [],
    autoApproveWrites: false,
    allowDestructive: false,
    wpSites: []
  };
}

export const store = {
  state: freshState(),
  settings: {
    brainUrl: '',
    adapter: { ...defaultAdapter },
    autoApproveWrites: false,
    allowDestructive: false,
    maxTurns: 60,
    wpSites: [] as WPSite[],
    brainConfigs: {} as Record<string, BrainAdapterConfig>
  } as Settings,

  async init(): Promise<void> {
    const box = (await chrome.storage.local.get('settings').catch(() => ({}))) as {
      settings?: Settings;
    };
    if (box.settings) this.settings = { ...this.settings, ...box.settings };
    this.state = {
      ...freshState(),
      brainUrl: this.settings.brainUrl,
      adapter: { ...this.settings.adapter },
      maxTurns: this.settings.maxTurns,
      autoApproveWrites: this.settings.autoApproveWrites,
      allowDestructive: this.settings.allowDestructive,
      wpSites: this.settings.wpSites
    };
  },

  async persist(): Promise<void> {
    this.settings.brainUrl = this.state.brainUrl;
    this.settings.adapter = this.state.adapter;
    this.settings.autoApproveWrites = this.state.autoApproveWrites;
    this.settings.allowDestructive = this.state.allowDestructive;
    this.settings.maxTurns = this.state.maxTurns;
    this.settings.wpSites = this.state.wpSites;
    await chrome.storage.local.set({ settings: this.settings }).catch(() => undefined);
  },

  setStatus(s: BrainStatus): void {
    this.state.status = s;
    this.broadcast();
  },

  patch(p: Partial<AppState>): void {
    Object.assign(this.state, p);
    void this.persist();
    this.broadcast();
  },

  log(kind: LogKind, text: string): void {
    const entry: LogEntry = { id: ++logCounter, t: Date.now(), kind, text };
    this.state.logs = [...this.state.logs.slice(-LOG_CAP + 1), entry];
    this.broadcast();
  },

  cpuLog(kind: LogKind, text: string): void {
    // minimal side-effect logging used from tools to avoid spamming the panel
    void kind;
    void text;
  },

  broadcast(): void {
    sendToPanel({ kind: 'STATE_SNAPSHOT', state: { ...this.state, logs: this.state.logs } });
  },

  clearLogs(): void {
    this.state.logs = [];
    this.broadcast();
  }
};