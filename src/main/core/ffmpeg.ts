import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FfmpegInfo } from '@shared/types';
import { toPathKey } from './util';

const IS_WINDOWS = process.platform === 'win32';
const FFMPEG_EXE = IS_WINDOWS ? 'ffmpeg.exe' : 'ffmpeg';
const FFPROBE_EXE = IS_WINDOWS ? 'ffprobe.exe' : 'ffprobe';
const VERSION_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 15000;
const CONVERT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BUFFER = 16 * 1024 * 1024;

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface FfmpegProgress {
  timeMs: number;
}

/**
 * Runs an executable without ever rejecting. Captures stdout/stderr as UTF-8 and
 * enforces a hard timeout so a wedged child process cannot stall the main process.
 */
export function executeCommand(
  file: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const out = typeof stdout === 'string' ? stdout : String(stdout ?? '');
          const err = typeof stderr === 'string' ? stderr : String(stderr ?? '');
          if (error) {
            const failure = error as NodeJS.ErrnoException & { code?: string | number };
            finish({
              ok: false,
              code: typeof failure.code === 'number' ? failure.code : null,
              stdout: out,
              stderr: err,
              error: failure.message
            });
            return;
          }
          finish({ ok: true, code: 0, stdout: out, stderr: err, error: null });
        }
      );
      child.on('error', (error) => {
        finish({ ok: false, code: null, stdout: '', stderr: '', error: error.message });
      });
    } catch (error) {
      finish({
        ok: false,
        code: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

async function isRegularFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

async function verifyBinary(target: string, kind: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  if (!(await isRegularFile(target))) return null;
  const result = await executeCommand(target, ['-version'], VERSION_TIMEOUT_MS);
  if (!result.ok) return null;
  const text = result.stdout + '\n' + result.stderr;
  const pattern = kind === 'ffmpeg' ? /ffmpeg version\s+([^\s,]+)/i : /ffprobe version\s+([^\s,]+)/i;
  const match = pattern.exec(text);
  return match ? match[1] : 'unknown';
}

function bundledCandidates(): string[] {
  const candidates: string[] = [];
  const arch = process.arch || 'x64';
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    candidates.push(path.join(resources, 'ffmpeg', arch, FFMPEG_EXE));
    candidates.push(path.join(resources, 'ffmpeg', FFMPEG_EXE));
  }
  const cwd = process.cwd();
  candidates.push(path.join(cwd, 'resources', 'ffmpeg', arch, FFMPEG_EXE));
  candidates.push(path.join(cwd, 'resources', 'ffmpeg', FFMPEG_EXE));
  return candidates;
}

async function customCandidates(rawPath: string | undefined): Promise<string[]> {
  const raw = (rawPath || '').trim().replace(/^"(.*)"$/, '$1');
  if (!raw) return [];
  const resolved = path.resolve(raw);
  const candidates: string[] = [];
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      candidates.push(path.join(resolved, FFMPEG_EXE));
    } else if (stat.isFile()) {
      candidates.push(resolved);
    }
    return candidates;
  } catch {
    if (IS_WINDOWS && !path.extname(resolved)) candidates.push(resolved + '.exe');
    return candidates;
  }
}

async function searchOnPath(command: string): Promise<string[]> {
  const finder = IS_WINDOWS ? 'where' : 'which';
  const result = await executeCommand(finder, [command], 8000);
  if (!result.ok) return [];
  const text = result.stdout + '\n' + result.stderr;
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !/^info:/i.test(line) &&
        !/could not find|not found/i.test(line)
    );
}

function commonCandidates(): string[] {
  const env = process.env;
  const candidates: string[] = [];
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.PROGRAMFILES;
  const programFilesX86 = env['ProgramFiles(x86)'];
  const programData = env.ProgramData;
  const userProfile = env.USERPROFILE;

  if (localAppData) {
    candidates.push(path.join(localAppData, 'Microsoft', 'WinGet', 'Links', FFMPEG_EXE));
    candidates.push(path.join(localAppData, 'Programs', 'ffmpeg', 'bin', FFMPEG_EXE));
  }
  if (programFiles) {
    candidates.push(path.join(programFiles, 'ffmpeg', 'bin', FFMPEG_EXE));
    candidates.push(path.join(programFiles, 'ffmpeg', FFMPEG_EXE));
  }
  if (programFilesX86) {
    candidates.push(path.join(programFilesX86, 'ffmpeg', 'bin', FFMPEG_EXE));
  }
  candidates.push(path.join(path.parse(process.cwd()).root, 'ffmpeg', 'bin', FFMPEG_EXE));
  if (programData) {
    candidates.push(path.join(programData, 'chocolatey', 'bin', FFMPEG_EXE));
  }
  if (userProfile) {
    candidates.push(path.join(userProfile, 'scoop', 'shims', FFMPEG_EXE));
  }
  return candidates;
}

async function findExecutables(
  root: string,
  fileName: string,
  maxDepth: number,
  budget: { remaining: number }
): Promise<string[]> {
  const found: string[] = [];
  if (budget.remaining <= 0) return found;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      found.push(entryPath);
      continue;
    }
    if (entry.isDirectory() && maxDepth > 0) {
      found.push(...(await findExecutables(entryPath, fileName, maxDepth - 1, budget)));
    }
  }
  return found;
}

async function wingetCandidates(): Promise<string[]> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  const packages = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(packages, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: string[] = [];
  const budget = { remaining: 600 };
  const directories = entries
    .filter((entry) => entry.isDirectory() && /ffmpeg/i.test(entry.name))
    .slice(0, 20);
  for (const directory of directories) {
    const found = await findExecutables(
      path.join(packages, directory.name),
      FFMPEG_EXE,
      4,
      budget
    );
    candidates.push(...found);
    if (budget.remaining <= 0) break;
  }
  return candidates;
}

/**
 * Resolves an ffmpeg binary in a predictable order:
 * custom path -> bundled resources (arch first, then legacy flat) -> PATH -> common installs.
 * Missing binaries are reported, never thrown.
 */
export async function detectFfmpeg(customPath?: string): Promise<FfmpegInfo> {
  const checkedAt = Date.now();

  try {
    const attempts: { target: string; source: FfmpegInfo['source'] }[] = [];

    for (const target of await customCandidates(customPath)) {
      attempts.push({ target, source: 'custom' });
    }
    for (const target of bundledCandidates()) {
      attempts.push({ target, source: 'bundled' });
    }
    for (const target of await searchOnPath(FFMPEG_EXE)) {
      attempts.push({ target, source: 'path' });
    }
    for (const target of commonCandidates()) {
      attempts.push({ target, source: 'common' });
    }
    for (const target of await wingetCandidates()) {
      attempts.push({ target, source: 'common' });
    }

    const seen = new Set<string>();
    for (const attempt of attempts) {
      const key = toPathKey(attempt.target);
      if (seen.has(key)) continue;
      seen.add(key);
      const version = await verifyBinary(attempt.target, 'ffmpeg');
      if (version) {
        return {
          available: true,
          path: path.resolve(attempt.target),
          version,
          source: attempt.source,
          checkedAt
        };
      }
    }
  } catch {
    // Fall through to the missing result.
  }

  return { available: false, path: '', version: '', source: 'missing', checkedAt };
}

/** Finds ffprobe next to the selected ffmpeg first, then on PATH. */
export async function findFfprobe(ffmpegPath: string): Promise<string | null> {
  try {
    const trimmed = (ffmpegPath || '').trim();
    if (trimmed) {
      const directory = path.dirname(path.resolve(trimmed));
      const candidates: string[] = [path.join(directory, FFPROBE_EXE)];
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const lower = entry.name.toLowerCase();
          if (lower.startsWith('ffprobe') && !lower.endsWith('.dll')) {
            candidates.push(path.join(directory, entry.name));
          }
        }
      } catch {
        // Directory listing is optional; the direct sibling path still counts.
      }
      const seen = new Set<string>();
      for (const local of candidates) {
        const key = toPathKey(local);
        if (seen.has(key)) continue;
        seen.add(key);
        if (await verifyBinary(local, 'ffprobe')) return local;
      }
    }
    for (const target of await searchOnPath(FFPROBE_EXE)) {
      if (await verifyBinary(target, 'ffprobe')) return path.resolve(target);
    }
  } catch {
    // Missing ffprobe is an expected state.
  }
  return null;
}

/** Reads a media duration in milliseconds via ffprobe, with an ffmpeg stderr fallback. */
export async function probeDurationMs(filePath: string, ffmpegPath: string): Promise<number | null> {
  try {
    if (!(await isRegularFile(filePath))) return null;
  } catch {
    return null;
  }

  try {
    const ffprobe = await findFfprobe(ffmpegPath);
    if (ffprobe) {
      const result = await executeCommand(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath
        ],
        PROBE_TIMEOUT_MS
      );
      if (result.ok) {
        const seconds = Number.parseFloat(result.stdout.trim().split(/\r?\n/)[0] || '');
        if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
      }
    }
  } catch {
    // Fall through to the ffmpeg probe.
  }

  try {
    let binary = (ffmpegPath || '').trim();
    if (!binary) {
      const detected = await detectFfmpeg();
      binary = detected.available ? detected.path : '';
    }
    if (!binary) return null;
    const result = await executeCommand(
      binary,
      ['-hide_banner', '-i', filePath],
      PROBE_TIMEOUT_MS
    );
    const text = result.stderr + '\n' + result.stdout;
    const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
    if (match) {
      const milliseconds =
        (Number.parseInt(match[1], 10) * 3600 +
          Number.parseInt(match[2], 10) * 60 +
          Number.parseFloat(match[3])) *
        1000;
      if (Number.isFinite(milliseconds) && milliseconds > 0) return Math.round(milliseconds);
    }
  } catch {
    // Unknown duration is a valid outcome.
  }

  return null;
}

/** Runs ffmpeg with the standard conversion timeout; never rejects for exit codes. */
export async function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  timeoutMs: number = CONVERT_TIMEOUT_MS,
  onProgress?: (progress: FfmpegProgress) => void
): Promise<CommandResult> {
  if (!ffmpegPath || !ffmpegPath.trim()) {
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: '',
      error: 'ffmpeg path is empty'
    };
  }
  if (!onProgress) return executeCommand(ffmpegPath, args, timeoutMs);
  return runFfmpegStreaming(ffmpegPath, args, timeoutMs, onProgress);
}

function runFfmpegStreaming(
  ffmpegPath: string,
  args: string[],
  timeoutMs: number,
  onProgress: (progress: FfmpegProgress) => void
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let pending = '';
    let lastReportedMs = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(ffmpegPath, [...args, '-progress', 'pipe:1', '-nostats'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const report = (timeMs: number): void => {
      if (!Number.isFinite(timeMs) || timeMs < 0) return;
      if (timeMs - lastReportedMs < 350) return;
      lastReportedMs = timeMs;
      try {
        onProgress({ timeMs });
      } catch {
        // A progress listener must never break ffmpeg.
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_BUFFER) stdout = stdout.slice(-MAX_BUFFER);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (match) report(Number(match[1]) / 1000);
      }
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_BUFFER) stderr = stderr.slice(-MAX_BUFFER);
    });

    child.on('error', (error) => {
      finish({ ok: false, code: null, stdout, stderr, error: error.message });
    });

    child.on('close', (code) => {
      // Flush a final progress line if ffmpeg ended without a trailing newline.
      const match = /out_time_(?:us|ms)=(\d+)/.exec(pending);
      if (match) report(Number(match[1]) / 1000);
      finish({
        ok: code === 0,
        code,
        stdout,
        stderr,
        error: code === 0 ? null : stderr.trim().split(/\r?\n/).slice(-1)[0] || 'ffmpeg exited with ' + code
      });
    });

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process may already have exited.
      }
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: 'ffmpeg timed out after ' + Math.round(timeoutMs / 1000) + ' seconds'
      });
    }, timeoutMs);
  });
}
