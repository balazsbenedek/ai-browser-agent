import type { BrainAdapterConfig } from '../../shared/types';
import { store } from '../store';
import { defaultAdapter } from '../store';
import { pickPreset } from './adapters';

export function describeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Resolve the adapter config: per-host override > known-site preset > default. */
export function pickConfig(url: string, host?: string): { id: string; config: BrainAdapterConfig } {
  const h = host ?? describeHost(url);
  const override = store.settings.brainConfigs[h];
  if (override) {
    return { id: `custom:${h}`, config: { ...override } };
  }
  const preset = pickPreset(url);
  return { id: preset.id, config: { ...preset.config } };
}

export function defaultConfig(): BrainAdapterConfig {
  return { ...defaultAdapter };
}