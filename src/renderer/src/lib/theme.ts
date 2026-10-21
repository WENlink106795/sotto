import { DEFAULT_SETTINGS, mergeSettings } from '@shared/defaults';
import type { Settings, ThemeMode, ThemeSettings } from '@shared/types';
import { runtimeConfig } from './capture';

const STORAGE_KEY = 'sotto.settings.cache';
let mediaCleanup: (() => void) | null = null;

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '').trim();
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((part) => part + part)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return { r: 79, g: 141, b: 247 };
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b)
  );
}

export function contrastText(hex: string): string {
  const luminance = relativeLuminance(hex);
  const white = 1.05 / (luminance + 0.05);
  const black = (luminance + 0.05) / 0.05;
  return white >= black ? '#ffffff' : '#0b0e14';
}

export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeSettings, options?: { capture?: boolean }): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme.preset;
  root.dataset.mode = resolveMode(theme.mode);
  root.dataset.density = theme.density;
  root.dataset.transparency = theme.transparency ? 'on' : 'off';
  root.dataset.motion = theme.reduceMotion ? 'off' : 'on';
  root.dataset.capture = options?.capture || runtimeConfig.capture ? '1' : '0';
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-contrast', contrastText(theme.accent));
  root.style.setProperty('--accent-rgb', hexToRgbString(theme.accent));
  root.style.setProperty('--radius-base', theme.radius + 'px');
  root.style.setProperty('--font-scale', String(theme.fontScale));

  if (mediaCleanup) {
    mediaCleanup();
    mediaCleanup = null;
  }
  if (theme.mode === 'system' && window.matchMedia) {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (): void => {
      root.dataset.mode = query.matches ? 'dark' : 'light';
    };
    query.addEventListener('change', listener);
    mediaCleanup = () => query.removeEventListener('change', listener);
  }
}

export function hexToRgbString(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb.r + ', ' + rgb.g + ', ' + rgb.b;
}

export function cacheSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage can be unavailable in private modes */
  }
}

export function readCachedSettings(): Settings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    return null;
  }
}

export function bootTheme(): void {
  const cached = readCachedSettings();
  const theme: ThemeSettings = { ...DEFAULT_SETTINGS.theme, ...(cached ? cached.theme : {}) };
  if (runtimeConfig.theme) theme.preset = runtimeConfig.theme;
  if (runtimeConfig.mode) theme.mode = runtimeConfig.mode;
  applyTheme(theme, { capture: runtimeConfig.capture });
}
