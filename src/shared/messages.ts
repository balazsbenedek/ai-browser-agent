// Runtime message protocol between:
//   content script (brainAdapter) <-> background
//   side panel (UI)               <-> background

import type {
  AppState,
  ApprovalReq,
  BrainAdapterConfig,
  LogEntry,
  PendingQuestion
} from './types';

export type MsgToBackground =
  | { kind: 'BRAIN_READY'; url: string; ts: number }
  | { kind: 'BRAIN_MESSAGE'; text: string; ts: number }
  | { kind: 'SPAWN_TASK'; text: string }
  | { kind: 'STOP' }
  | { kind: 'PANEL_READY' }
  | { kind: 'APPROVAL_RESPONSE'; id: string; approved: boolean }
  | { kind: 'ASK_RESPONSE'; id: string; text: string }
  | {
      kind: 'CMD';
      action: string;
      payload?: Record<string, unknown>;
    };

export type MsgToContent =
  | { kind: 'BRAIN_SETUP'; config: BrainAdapterConfig }
  | { kind: 'BRAIN_SUBMIT'; text: string; seq: number }
  | { kind: 'BRAIN_ENSURE' };

export type MsgToPanel =
  | { kind: 'STATE_SNAPSHOT'; state: AppState }
  | { kind: 'LOG'; entry: LogEntry }
  | { kind: 'APPROVAL_REQ'; req: ApprovalReq }
  | { kind: 'ASK_USER'; q: PendingQuestion }
  | { kind: 'BRAIN_ACK' };

export type RtMsg = MsgToBackground | MsgToContent | MsgToPanel;

export function sendToBackground(msg: MsgToBackground): void {
  void chrome.runtime.sendMessage(msg);
}

export function sendToPanel(msg: MsgToPanel): void {
  void chrome.runtime
    .sendMessage(msg)
    .catch(() => undefined);
}

export function sendToTab(tabId: number, msg: MsgToContent): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg).catch((e) => {
    throw new Error(`sendMessage to tab ${tabId} failed: ${String(e)}`);
  });
}