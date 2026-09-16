import type { AdapterPreset } from '../../shared/types';

export const PRESETS: AdapterPreset[] = [
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    test: (u) => /(^|\.)(chat\.openai\.com|chatgpt\.com)$/i.test(hostOf(u)),
    config: {
      input: '#prompt-textarea',
      send: '[data-testid="send-button"]',
      messages: '[data-message-author-role="assistant"]',
      loading: ['[data-testid="stop-button"]'],
      stabilityMs: 1200,
      timeoutMs: 120000
    }
  },
  {
    id: 'claude',
    label: 'Claude',
    test: (u) => /(^|\.)claude\.ai$/i.test(hostOf(u)),
    config: {
      input: '.ProseMirror[contenteditable="true"]',
      send: 'button[aria-label*="Send"], button[aria-label*="send"]',
      messages: '[data-testid="known-chat-message"], [data-is-streaming="false"] div.font-claude-message',
      loading: [],
      stabilityMs: 1600,
      timeoutMs: 120000
    }
  },
  {
    id: 'gemini',
    label: 'Gemini',
    test: (u) => /(^|\.)gemini\.google\.com$/i.test(hostOf(u)),
    config: {
      input: 'rich-textarea[contenteditable="true"], .ql-editor[contenteditable="true"]',
      send: 'button[aria-label*="Send"], button.send-button',
      messages: 'message-content, .model-response-text',
      loading: [],
      stabilityMs: 1500,
      timeoutMs: 120000
    }
  },
  {
    id: 'openwebui',
    label: 'Open WebUI',
    test: (u) => /openwebui|localhost/i.test(u) && /\/chat(\/|$)/i.test(u),
    config: {
      input: '#chat-input',
      send: '[aria-label="Send"]',
      messages: '.chat-msg-content',
      loading: ['[data-testid="stop"]', '.typing-indicator'],
      stabilityMs: 1000,
      timeoutMs: 90000
    }
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    test: (u) => /(^|\.)chat\.deepseek\.com$/i.test(hostOf(u)),
    config: {
      input:
        'textarea#chat-input, textarea[placeholder*="Send a message"], textarea[placeholder*="Message"], textarea[placeholder*="Ask"], textarea[placeholder*="发送"], div[contenteditable="true"][role="textbox"]',
      send: 'button[aria-label="Send message"], [data-testid="send-button"], [role="button"][aria-label*="send"], button[type="submit"]',
      messages: '.ds-markdown, [data-message-author-role="assistant"]',
      loading: [],
      stabilityMs: 1600,
      timeoutMs: 120000
    }
  },
  {
    id: 'generic',
    label: 'Generic / custom LLM UI',
    test: () => true,
    config: {
      input: '#prompt-textarea',
      send: '',
      messages: '',
      loading: ['[data-testid="stop-button"]'],
      stabilityMs: 1500,
      timeoutMs: 120000
    }
  }
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function pickPreset(url: string): AdapterPreset {
  return PRESETS.find((p) => {
    try {
      return p.test(url);
    } catch {
      return false;
    }
  }) ?? PRESETS[PRESETS.length - 1];
}

export function describeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}