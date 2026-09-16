import type { Tool } from './browser';
import { browserTools } from './browser';
import { wpTools } from './wp';

export type { Tool, ToolCtx, ToolMode } from './browser';
export type { ToolResult } from '../../shared/types';

export const TOOLS: Tool[] = [...browserTools, ...wpTools];

export const REGISTRY: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t])
);

export function toolHelp(): string {
  return TOOLS.map((t) => `- ${t.name} [${t.mode}]: ${t.brief}`).join('\n');
}