import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cloneSettings, DEFAULT_SETTINGS, mergeSettings } from '../shared/defaults';
import type { Settings } from '../shared/types';

let cached: Settings | null = null;

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<Settings> {
  if (cached) return cloneSettings(cached);
  try {
    const raw = await fs.readFile(settingsFile(), 'utf8');
    cached = mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw));
  } catch {
    cached = cloneSettings(DEFAULT_SETTINGS);
  }
  return cloneSettings(cached);
}

export async function saveSettings(input: Settings): Promise<Settings> {
  const merged = mergeSettings(DEFAULT_SETTINGS, input);
  merged.version = 1;
  merged.general.recentRoots = Array.isArray(merged.general.recentRoots)
    ? merged.general.recentRoots.slice(0, 12)
    : [];
  merged.theme.accent = normalizeAccent(merged.theme.accent);
  merged.theme.radius = clampNumber(merged.theme.radius, 4, 20, 10);
  merged.theme.fontScale = clampNumber(merged.theme.fontScale, 0.9, 1.15, 1);
  merged.naming.maxBaseLength = clampNumber(merged.naming.maxBaseLength, 20, 160, 100);
  merged.subtitle.offsetMs = clampNumber(merged.subtitle.offsetMs, -60000, 60000, 0);
  merged.convert.bitrateKbps = clampNumber(merged.convert.bitrateKbps, 64, 320, 192);
  merged.convert.concurrency = clampNumber(merged.convert.concurrency, 0, 16, 1);
  merged.cover.name = (merged.cover.name || 'cover').replace(/[\\/:*?"<>|]/g, '').trim() || 'cover';

  const dir = path.dirname(settingsFile());
  await fs.mkdir(dir, { recursive: true });
  const temp = settingsFile() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(merged, null, 2), 'utf8');
  await fs.rename(temp, settingsFile());
  cached = cloneSettings(merged);
  return cloneSettings(merged);
}

function normalizeAccent(value: string): string {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_SETTINGS.theme.accent;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}
