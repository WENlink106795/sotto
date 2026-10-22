import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppInfo, LogLevel, Settings } from '@shared/types';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BACKUPS = 3;
const MAX_META_CHARS = 8000;
const SECRET_KEY = /(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|authorization|cookie|credential)/i;

export interface AppLoggerOptions {
  directory: string;
  maxBytes?: number;
  maxBackups?: number;
  homeDir?: string;
  enabled?: boolean;
}

export interface DiagnosticsInput {
  appInfo: AppInfo;
  settings: Settings;
  appLog: string;
  applyLogs: { name: string; text: string }[];
}

export interface ApplyLogFile {
  name: string;
  text: string;
}

/**
 * Redact obvious credentials and the current user's home directory before a
 * line reaches disk. This is deliberately conservative: logs are meant to be
 * shared with a maintainer, so paths and tokens should not be copied verbatim.
 */
export function redactText(value: string, homeDir = os.homedir()): string {
  let text = String(value ?? '');
  if (homeDir) {
    const variants = new Set([homeDir, homeDir.replace(/\\/g, '/'), homeDir.replace(/\//g, '\\')]);
    for (const variant of variants) {
      if (variant) text = text.split(variant).join('~');
    }
  }
  text = text.replace(
    /((?:password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*)(["']?)([^\s"',;]+)/gi,
    '$1$2<redacted>'
  );
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1<redacted>');
  text = text.replace(/\b(gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_\-]{12,}/g, '$1<redacted>');
  if (text.length > 12000) text = text.slice(0, 12000) + '…';
  return text;
}

function normalizeMeta(value: unknown, homeDir: string, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, homeDir);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message, homeDir),
      stack: value.stack ? redactText(value.stack, homeDir) : undefined
    };
  }
  if (depth >= 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => normalizeMeta(item, homeDir, depth + 1));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SECRET_KEY.test(key) ? '<redacted>' : normalizeMeta(item, homeDir, depth + 1);
    }
    return result;
  }
  return String(value);
}

function metaSuffix(meta: Record<string, unknown> | undefined, homeDir: string): string {
  if (!meta) return '';
  try {
    const json = JSON.stringify(normalizeMeta(meta, homeDir));
    if (!json || json === '{}') return '';
    return ' ' + (json.length > MAX_META_CHARS ? json.slice(0, MAX_META_CHARS) + '…' : json);
  } catch {
    return ' {"meta":"<unserializable>"}';
  }
}

/** Build one stable, human-readable line. Exported for tests and diagnostics. */
export function formatLogLine(
  level: LogLevel,
  scope: string,
  message: string,
  meta?: Record<string, unknown>,
  at: Date = new Date(),
  homeDir = os.homedir()
): string {
  const safeScope = String(scope || 'app').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 32);
  const safeMessage = redactText(String(message ?? ''), homeDir).replace(/\r?\n/g, '\\n').slice(0, 6000);
  return (
    at.toISOString() +
    ' ' +
    level.toUpperCase().padEnd(5, ' ') +
    ' [' +
    safeScope +
    '] ' +
    safeMessage +
    metaSuffix(meta, homeDir)
  );
}

function limitedText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const slice = Buffer.from(text, 'utf8').subarray(-maxBytes).toString('utf8');
  return '[…truncated…]\n' + slice.slice(Math.max(0, slice.indexOf('\n') + 1));
}

function settingsSummary(settings: Settings, homeDir: string): string {
  const summary = {
    theme: settings.theme,
    naming: settings.naming,
    subtitle: settings.subtitle,
    cover: settings.cover,
    convert: settings.convert,
    general: {
      language: settings.general.language,
      ffmpegPath: settings.general.ffmpegPath,
      showAdvanced: settings.general.showAdvanced
    }
  };
  return redactText(JSON.stringify(summary, null, 2), homeDir);
}

/** Build a self-contained text bundle suitable for attaching to a bug report. */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const home = os.homedir();
  const info = input.appInfo;
  const header = [
    'Sotto diagnostics bundle',
    'generatedAt: ' + new Date().toISOString(),
    'app: ' + info.name + ' ' + info.version,
    'electron: ' + info.electron,
    'chrome: ' + info.chrome,
    'node: ' + info.node,
    'platform: ' + info.platform + ' / ' + info.arch,
    'osRelease: ' + info.osRelease,
    'packaged: ' + String(info.isPackaged),
    'userData: ' + redactText(info.userDataPath, home),
    'logs: ' + redactText(info.logsPath, home),
    '',
    'Note: log paths can reveal folder names. Review this file before sharing it.',
    '',
    '--- settings ---',
    settingsSummary(input.settings, home),
    '',
    '--- app.log ---',
    input.appLog || '(empty)',
    ''
  ];
  const parts = [header.join('\n')];
  for (const log of input.applyLogs) {
    parts.push('--- ' + log.name + ' ---\n' + (redactText(log.text, home) || '(empty)') + '\n');
  }
  return parts.join('\n');
}

export class AppLogger {
  readonly directory: string;
  readonly filePath: string;
  readonly maxBytes: number;
  readonly maxBackups: number;
  private readonly homeDir: string;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  private enabled: boolean;

  constructor(options: AppLoggerOptions) {
    this.directory = options.directory;
    this.filePath = path.join(options.directory, 'app.log');
    this.maxBytes = Math.max(64, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.maxBackups = Math.max(1, options.maxBackups ?? DEFAULT_MAX_BACKUPS);
    this.homeDir = options.homeDir ?? os.homedir();
    this.enabled = options.enabled ?? true;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = Boolean(enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    this.initialized = true;
  }

  async log(
    level: LogLevel,
    scope: string,
    message: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.initialized) {
      try {
        await this.init();
      } catch {
        return;
      }
    }
    const line = formatLogLine(level, scope, message, meta, new Date(), this.homeDir);
    this.queue = this.queue.then(() => this.append(line)).catch(() => undefined);
    return this.queue;
  }

  debug(scope: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    return this.log('debug', scope, message, meta);
  }

  info(scope: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    return this.log('info', scope, message, meta);
  }

  warn(scope: string, message: string, meta?: Record<string, unknown>): Promise<void> {
    return this.log('warn', scope, message, meta);
  }

  error(scope: string, message: string, error?: unknown, meta?: Record<string, unknown>): Promise<void> {
    const details = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : error === undefined
        ? undefined
        : { message: String(error) };
    return this.log('error', scope, message, { ...(meta || {}), ...(details ? { error: details } : {}) });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async append(line: string): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await this.rotateIfNeeded();
      await fs.appendFile(this.filePath, line + '\n', 'utf8');
    } catch {
      // Logging must never crash or block the app.
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.filePath);
      if (stat.size < this.maxBytes) return;
      for (let index = this.maxBackups - 1; index >= 1; index -= 1) {
        const source = path.join(this.directory, 'app.' + index + '.log');
        const target = path.join(this.directory, 'app.' + (index + 1) + '.log');
        await fs.rename(source, target).catch(() => undefined);
      }
      await fs.rename(this.filePath, path.join(this.directory, 'app.1.log')).catch(() => undefined);
    } catch {
      // A missing app.log is the normal first-run case.
    }
  }

  async readRecent(maxBytes = 2_000_000): Promise<string> {
    await this.flush();
    const names: string[] = [];
    for (let index = this.maxBackups; index >= 1; index -= 1) names.push('app.' + index + '.log');
    names.push('app.log');
    let text = '';
    for (const name of names) {
      try {
        text += await fs.readFile(path.join(this.directory, name), 'utf8');
        text += '\n';
      } catch {
        // Skip missing rotation files.
      }
    }
    return limitedText(text, maxBytes);
  }

  async readApplyLogs(limit = 6, maxBytes = 1_500_000): Promise<ApplyLogFile[]> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.directory);
    } catch {
      return [];
    }
    const files: { name: string; mtimeMs: number }[] = [];
    for (const name of entries) {
      if (!/^apply-.*\.log$/i.test(name)) continue;
      try {
        const stat = await fs.stat(path.join(this.directory, name));
        files.push({ name, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore files that disappear while listing.
      }
    }
    files.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const result: ApplyLogFile[] = [];
    let used = 0;
    for (const file of files.slice(0, limit)) {
      try {
        const text = await fs.readFile(path.join(this.directory, file.name), 'utf8');
        if (!text) continue;
        const remaining = Math.max(0, maxBytes - used);
        if (remaining === 0) break;
        const clipped = text.length > remaining ? text.slice(-remaining) : text;
        used += Buffer.byteLength(clipped, 'utf8');
        result.push({ name: file.name, text: clipped });
      } catch {
        // Ignore unreadable files.
      }
    }
    return result;
  }

  async exportTo(destination: string, appInfo: AppInfo, settings: Settings): Promise<number> {
    await this.flush();
    const appLog = await this.readRecent(2_000_000);
    const applyLogs = await this.readApplyLogs();
    const bundle = buildDiagnostics({ appInfo, settings, appLog, applyLogs });
    await fs.writeFile(destination, bundle, 'utf8');
    return Buffer.byteLength(bundle, 'utf8');
  }
}
