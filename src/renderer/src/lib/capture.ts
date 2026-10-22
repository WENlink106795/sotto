import type { ThemeMode, ThemePreset } from '@shared/types';

export type ViewKey = 'library' | 'history' | 'converter' | 'settings';

export interface RuntimeConfig {
  capture: boolean;
  view: ViewKey;
  emptyDemo: boolean;
  workspaceDemo: boolean;
  theme: ThemePreset | null;
  mode: ThemeMode | null;
}

function readParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function parsePreset(value: string | null): ThemePreset | null {
  return value === 'fluent' || value === 'material' || value === 'studio' ? value : null;
}

function parseMode(value: string | null): ThemeMode | null {
  if (value === 'light' || value === 'dark') return value;
  return null;
}

function parseView(value: string | null): { view: ViewKey; emptyDemo: boolean; workspaceDemo: boolean } {
  if (value === 'workspace') return { view: 'library', emptyDemo: false, workspaceDemo: true };
  if (value === 'empty') return { view: 'library', emptyDemo: true, workspaceDemo: false };
  if (value === 'settings') return { view: 'settings', emptyDemo: false, workspaceDemo: false };
  if (value === 'history') return { view: 'history', emptyDemo: false, workspaceDemo: false };
  return { view: 'library', emptyDemo: false, workspaceDemo: false };
}

function buildConfig(): RuntimeConfig {
  const params = readParams();
  const view = parseView(params.get('view'));
  return {
    capture: params.get('capture') === '1',
    view: view.view,
    emptyDemo: view.emptyDemo,
    workspaceDemo: view.workspaceDemo,
    theme: parsePreset(params.get('theme')),
    mode: parseMode(params.get('mode'))
  };
}

export const runtimeConfig: RuntimeConfig = buildConfig();

export function isCapture(): boolean {
  return runtimeConfig.capture;
}
