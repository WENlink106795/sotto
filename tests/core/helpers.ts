import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, cloneSettings } from '@shared/defaults';
import type { FfmpegInfo, Settings } from '@shared/types';

export async function createTempDir(prefix: string = 'sotto-test-'): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeDir(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export async function writeText(target: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

export function makeSettings(mutate?: (settings: Settings) => void): Settings {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  if (mutate) mutate(settings);
  return settings;
}

export function fakeFfmpeg(available: boolean, targetPath: string = ''): FfmpegInfo {
  return {
    available,
    path: available ? targetPath || (process.platform === 'win32' ? 'C:\\tools\\ffmpeg.exe' : '/usr/bin/ffmpeg') : '',
    version: available ? 'test' : '',
    source: available ? 'custom' : 'missing',
    checkedAt: Date.now()
  };
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else results.push(full);
    }
  };
  await walk(root);
  results.sort();
  return results;
}

export async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}
