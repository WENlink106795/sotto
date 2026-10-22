import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppLogger, buildDiagnostics, formatLogLine, redactText } from '@core/logger';
import { cloneSettings, DEFAULT_SETTINGS } from '@shared/defaults';
import type { AppInfo } from '@shared/types';
import { createTempDir, removeDir } from './helpers';

const HOME = 'C:\\Users\\Alice';

function appInfo(directory: string): AppInfo {
  return {
    name: 'Sotto',
    version: '0.1.0',
    electron: '34.5.3',
    chrome: '132.0.6834.210',
    node: '20.18.1',
    platform: 'win32',
    arch: 'x64',
    isPackaged: false,
    userDataPath: directory,
    logsPath: path.join(directory, 'logs'),
    osRelease: '10.0.22631'
  };
}

let temporaryDirectory: string | null = null;

afterEach(async () => {
  if (temporaryDirectory) {
    await removeDir(temporaryDirectory);
    temporaryDirectory = null;
  }
});

describe('redactText', () => {
  it('removes the home directory and obvious credentials', () => {
    const text = redactText(
      'path=' + HOME + '\\Music\\a.mp3 token=placeholder-token password: hunter2',
      HOME
    );
    expect(text).toContain('~\\Music\\a.mp3');
    expect(text).not.toContain(HOME);
    expect(text).not.toContain('placeholder-token');
    expect(text).not.toContain('hunter2');
    expect(text).toContain('<redacted>');
  });
});

describe('formatLogLine', () => {
  it('formats level, scope and redacted meta', () => {
    const line = formatLogLine(
      'warn',
      'scan',
      'skipped a file',
      { file: HOME + '\\a.vtt', token: 'secret-value' },
      new Date('2026-01-01T00:00:00.000Z'),
      HOME
    );
    expect(line).toContain('2026-01-01T00:00:00.000Z');
    expect(line).toContain('WARN');
    expect(line).toContain('[scan]');
    expect(line).toContain('a.vtt');
    expect(line).toContain('~');
    expect(line).not.toContain('secret-value');
    expect(line).toContain('<redacted>');
  });
});

describe('AppLogger', () => {
  it('rotates, reads recent entries and exports a diagnostics bundle', async () => {
    temporaryDirectory = await createTempDir('sotto-logger-');
    const logger = new AppLogger({
      directory: temporaryDirectory,
      maxBytes: 180,
      maxBackups: 2,
      homeDir: HOME
    });
    await logger.init();
    for (let index = 0; index < 8; index += 1) {
      await logger.info('test', 'line ' + index, { path: HOME + '\\work' });
    }
    const recent = await logger.readRecent(20_000);
    expect(recent).toContain('line 7');
    expect(recent).toContain('work');
    expect(recent).toContain('~');
    expect(recent).not.toContain(HOME);

    const files = await fs.readdir(temporaryDirectory);
    expect(files.some((name) => /^app\.1\.log$/.test(name))).toBe(true);

    await fs.writeFile(path.join(temporaryDirectory, 'apply-demo.log'), 'apply line\n', 'utf8');
    const destination = path.join(temporaryDirectory, 'diagnostics.log');
    const bytes = await logger.exportTo(destination, appInfo(temporaryDirectory), cloneSettings(DEFAULT_SETTINGS));
    expect(bytes).toBeGreaterThan(100);
    const bundle = await fs.readFile(destination, 'utf8');
    expect(bundle).toContain('Sotto diagnostics bundle');
    expect(bundle).toContain('--- app.log ---');
    expect(bundle).toContain('--- apply-demo.log ---');
    expect(bundle).toContain('"naming"');
  });

  it('builds a bundle with environment and privacy note', () => {
    const bundle = buildDiagnostics({
      appInfo: appInfo('C:\\Users\\Alice\\AppData\\Roaming\\Sotto'),
      settings: cloneSettings(DEFAULT_SETTINGS),
      appLog: 'hello',
      applyLogs: [{ name: 'apply-one.log', text: 'one' }]
    });
    expect(bundle).toContain('Sotto diagnostics bundle');
    expect(bundle).toContain('Review this file before sharing it');
    expect(bundle).toContain('apply-one.log');
  });
});
