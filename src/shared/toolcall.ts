// The tool-call wire protocol between the AI brain and the extension.
//
// The AI is instructed (via an injected system prompt) to call the browser by
// emitting fenced JSON:
//
//   ```agent {"tool":"screenshot","args":{"tabId":3}}```
//
// Reasoning-free, structured, and easy to parse out of any chat reply. A
// terminal call marks the end of a task:
//
//   ```agent {"tool":"done","args":{"summary":"..."}}```

import type { ToolCall } from './types';

const FENCE = '```agent';
const FENCE_END = '```';

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith(FENCE)) {
      let json = line.slice(FENCE.length).trim();
      // allow closing fence on same line
      if (json.endsWith(FENCE_END)) json = json.slice(0, -FENCE_END.length).trim();
      let j = i + 1;
      if (!json) {
        const buf: string[] = [];
        while (j < lines.length) {
          const l = lines[j];
          if (l.trim() === FENCE_END) break;
          buf.push(l);
          j++;
        }
        json = buf.join('\n').trim();
      }
      try {
        const obj = JSON.parse(json) as Partial<ToolCall>;
        if (obj && typeof obj.tool === 'string') {
          calls.push({ tool: obj.tool, args: (obj.args ?? {}) as Record<string, unknown> });
        }
      } catch {
        // not ours
      }
      i = Math.max(i + 1, j);
    }
    i++;
  }
  return calls;
}

export function isDoneCall(call: ToolCall): boolean {
  return call.tool === 'done';
}

export function renderResultsBlock(calls: { call: ToolCall; result: unknown }[]): string {
  const parts = calls.map(({ call, result }) => {
    let value: string;
    try {
      value = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    } catch {
      value = String(result);
    }
    return `### tool "${call.tool}" ${JSON.stringify(call.args)}\n${value}`;
  });
  return `[tool results]\n\n${parts.join('\n\n')}\n\n[end tool results]`;
}

/** Marker appended to each turn we submit so the adapter can anchor replies. */
export function marker(seq: number): string {
  return `[agent-turn:${seq}]`;
}

export function wrapForBrain(text: string, seq: number): string {
  return `${marker(seq)}\n\n${text}\n\n${marker(seq)}`;
}