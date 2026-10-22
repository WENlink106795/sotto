import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { IPC, IPC_EVENTS } from '../shared/ipc';
import type {
  AppInfo,
  ApplyRequest,
  FfmpegInfo,
  IpcResult,
  PlanRequest,
  ProgressEvent,
  RendererLogEntry,
  Settings,
  UpdateInfo,
  UpdateProgress
} from '../shared/types';
import { loadSettings, saveSettings } from './settings-store';
import { cloneSettings, mergeSettings } from '../shared/defaults';
import { detectFfmpeg } from './core/ffmpeg';
import { scanLibrary } from './core/scan';
import { buildPlan } from './core/plan';
import { applyPlan, listHistory, undoRunById } from './core/apply';
import { previewSubtitle } from './core/subtitle';
import { AppLogger } from './core/logger';
import { checkForUpdates, downloadUpdate } from './core/updates';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'murmur',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

let mainWindow: BrowserWindow | null = null;
let ffmpegCache: FfmpegInfo | null = null;
let logger: AppLogger | null = null;
let updateCache: { at: number; info: UpdateInfo | null } | null = null;
const allowedRoots = new Set<string>();
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif'
};

function getWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window is not available');
  return mainWindow;
}

function sendProgress(event: ProgressEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_EVENTS.progress, event);
  }
}

function sendUpdateProgress(progress: UpdateProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC_EVENTS.updateProgress, progress);
  }
}

function buildAppInfo(): AppInfo {
  return {
    name: 'Sotto',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    logsPath: path.join(app.getPath('userData'), 'logs'),
    osRelease: os.release()
  };
}

function handle<T>(channel: string, handler: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    const startedAt = Date.now();
    try {
      const data = await handler(...args);
      void logger?.debug('ipc', channel + ' ok', { ms: Date.now() - startedAt });
      return { ok: true, data } satisfies IpcResult<T>;
    } catch (error) {
      const err = error as Error & { code?: string; detail?: string };
      void logger?.error('ipc', channel + ' failed', error, {
        ms: Date.now() - startedAt,
        code: err.code || 'E_UNKNOWN'
      });
      console.error('[ipc]', channel, err);
      return {
        ok: false,
        error: {
          code: err.code || 'E_UNKNOWN',
          message: err.message || String(err),
          detail: err.detail
        }
      } satisfies IpcResult<T>;
    }
  });
}

function isPathInside(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function getFfmpeg(refresh = false): Promise<FfmpegInfo> {
  if (ffmpegCache && !refresh) return ffmpegCache;
  const settings = await loadSettings();
  ffmpegCache = await detectFfmpeg(settings.general.ffmpegPath);
  return ffmpegCache;
}

function registerIpc(): void {
  handle<AppInfo>(IPC.appInfo, async () => buildAppInfo());

  handle<string | null>(IPC.pickFolder, async () => {
    const settings = await loadSettings();
    const lastRoot = settings.general.recentRoots[0]?.root;
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择 ASMR 作品文件夹',
      defaultPath: lastRoot,
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  handle<string | null>(IPC.pickFfmpeg, async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择 ffmpeg.exe',
      filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    ffmpegCache = null;
    return result.filePaths[0];
  });

  handle<void>(IPC.openPath, async (targetPath: string) => {
    assertString(targetPath, 'path');
    const error = await shell.openPath(targetPath);
    if (error) throw new Error(error);
  });

  handle<void>(IPC.revealPath, async (targetPath: string) => {
    assertString(targetPath, 'path');
    shell.showItemInFolder(targetPath);
  });

  handle<void>(IPC.openExternal, async (url: string) => {
    assertString(url, 'url');
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links are allowed');
    await shell.openExternal(url);
  });

  handle(IPC.scan, async (root: string) => {
    assertString(root, 'root');
    const resolved = path.resolve(root);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error('Not a directory: ' + resolved);
    allowedRoots.add(resolved);
    const scan = await scanLibrary(resolved, (message) => {
      sendProgress({
        runId: 'scan',
        phase: 'scan',
        current: 0,
        total: 0,
        overallPercent: 15,
        message,
        detail: null,
        level: 'info',
        at: Date.now()
      });
    });
    void logger?.info('scan', 'complete', {
      root: resolved,
      folders: scan.folders.length,
      files: scan.stats.totalFiles,
      audio: scan.stats.audio,
      subtitle: scan.stats.subtitle,
      image: scan.stats.image,
      truncated: scan.truncated
    });
    return scan;
  });

  handle(IPC.plan, async (request: PlanRequest) => {
    const ffmpeg = await getFfmpeg();
    const plan = await buildPlan(request, ffmpeg);
    void logger?.info('plan', 'complete', {
      root: request.root,
      planId: plan.planId,
      folders: plan.summary.folders,
      pairs: plan.summary.pairs,
      renames: plan.summary.renames,
      subtitles: plan.summary.subtitleConversions,
      audio: plan.summary.audioConversions,
      warnings: plan.summary.warnings
    });
    return plan;
  });

  handle(IPC.apply, async (request: ApplyRequest) => {
    const ffmpeg = await getFfmpeg();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    void logger?.info('apply', 'started', { runId, root: request.plan.root });
    const result = await applyPlan(request, {
      runId,
      ffmpeg,
      dataDir: app.getPath('userData'),
      logsDir: path.join(app.getPath('userData'), 'logs'),
      trashFile: async (targetPath: string) => {
        await shell.trashItem(targetPath);
      },
      onProgress: (event) => sendProgress({ ...event, runId })
    });
    void logger?.info('apply', 'finished', {
      runId,
      status: result.status,
      ms: Date.now() - startedAt,
      stats: result.stats,
      logPath: result.logPath
    });
    return result;
  });

  handle(IPC.undo, async (runId?: string) => {
    const result = await undoRunById(runId, app.getPath('userData'));
    void logger?.info('undo', 'finished', {
      runId: result.runId,
      status: result.status,
      restored: result.restored,
      failed: result.failed
    });
    return result;
  });

  handle(IPC.history, async () => listHistory(app.getPath('userData')));

  handle(IPC.subtitlePreview, async (sourcePath: string, settings: Settings) => {
    assertString(sourcePath, 'path');
    return previewSubtitle(sourcePath, settings);
  });

  handle(IPC.settingsGet, async () => loadSettings());

  handle(IPC.settingsSave, async (settings: Settings) => {
    const saved = await saveSettings(settings);
    nativeTheme.themeSource =
      saved.theme.mode === 'light' ? 'light' : saved.theme.mode === 'dark' ? 'dark' : 'system';
    ffmpegCache = null;
    logger?.setEnabled(saved.general.loggingEnabled);
    return saved;
  });

  handle(IPC.ffmpegInfo, async (refresh?: boolean) => getFfmpeg(Boolean(refresh)));

  handle(IPC.logWrite, async (entry: RendererLogEntry) => {
    if (!logger || !entry || typeof entry.message !== 'string') return;
    const allowed = new Set(['debug', 'info', 'warn', 'error']);
    const level = allowed.has(entry.level) ? entry.level : 'info';
    const meta: Record<string, unknown> = { source: entry.source || 'renderer' };
    if (entry.stack) meta.stack = entry.stack;
    if (entry.meta && typeof entry.meta === 'object') Object.assign(meta, entry.meta);
    await logger.log(level, 'renderer', entry.message.slice(0, 4000), meta);
  });

  handle<string | null>(IPC.exportLogs, async () => {
    if (!logger) throw new Error('日志模块尚未初始化');
    const settings = await loadSettings();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出诊断日志',
      defaultPath: path.join(app.getPath('downloads'), 'Sotto-diagnostics-' + stamp + '.log'),
      filters: [{ name: '诊断日志', extensions: ['log', 'txt'] }]
    });
    if (result.canceled || !result.filePath) {
      void logger.info('diagnostics', 'export canceled');
      return null;
    }
    const bytes = await logger.exportTo(result.filePath, buildAppInfo(), settings);
    void logger.info('diagnostics', 'exported', { path: result.filePath, bytes });
    return result.filePath;
  });

  handle<string | null>(IPC.settingsExport, async () => {
    const settings = await loadSettings();
    const exported = cloneSettings(settings);
    exported.general.recentRoots = [];
    exported.general.ffmpegPath = '';
    exported.general.lastUpdatePrompt = '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出 Sotto 设置',
      defaultPath: path.join(app.getPath('downloads'), 'Sotto-settings-' + stamp + '.json'),
      filters: [{ name: 'Sotto 设置', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, JSON.stringify(exported, null, 2), 'utf8');
    void logger?.info('settings', 'exported', { path: result.filePath });
    return result.filePath;
  });

  handle<Settings | null>(IPC.settingsImport, async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '导入 Sotto 设置',
      filters: [{ name: 'Sotto 设置', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'));
    } catch {
      throw new Error('设置文件不是有效的 JSON');
    }
    const current = await loadSettings();
    const next = mergeSettings(current, parsed);
    next.general.recentRoots = current.general.recentRoots;
    next.general.ffmpegPath = current.general.ffmpegPath;
    next.general.lastUpdatePrompt = current.general.lastUpdatePrompt;
    const saved = await saveSettings(next);
    nativeTheme.themeSource =
      saved.theme.mode === 'light' ? 'light' : saved.theme.mode === 'dark' ? 'dark' : 'system';
    ffmpegCache = null;
    logger?.setEnabled(saved.general.loggingEnabled);
    void logger?.info('settings', 'imported', { path: result.filePaths[0] });
    return saved;
  });

  handle<UpdateInfo | null>(IPC.updateCheck, async (force?: boolean) => {
    if (!force && updateCache && Date.now() - updateCache.at < 30 * 60 * 1000) {
      return updateCache.info;
    }
    const info = await checkForUpdates(app.getVersion());
    updateCache = { at: Date.now(), info };
    void logger?.info('update', 'checked', {
      current: app.getVersion(),
      latest: info?.latestVersion ?? null,
      hasUpdate: info?.hasUpdate ?? false
    });
    return info;
  });

  handle<string>(IPC.updateDownload, async (info: UpdateInfo) => {
    if (!info || !info.hasUpdate) throw new Error('没有可下载的更新');
    sendUpdateProgress({ phase: 'downloading', downloaded: 0, total: info.assetSize || 0, percent: 0, message: '正在连接 GitHub…' });
    try {
      const target = await downloadUpdate(
        info,
        path.join(app.getPath('userData'), 'updates'),
        (progress) => sendUpdateProgress(progress)
      );
      void logger?.info('update', 'downloaded', { path: target, version: info.latestVersion });
      return target;
    } catch (error) {
      sendUpdateProgress({
        phase: 'error',
        downloaded: 0,
        total: info.assetSize || 0,
        percent: 0,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });

  handle<void>(IPC.updateInstall, async (filePath: string) => {
    assertString(filePath, 'update path');
    const updatesDir = path.join(app.getPath('userData'), 'updates');
    if (!isPathInside(path.resolve(filePath), updatesDir)) {
      throw new Error('更新安装包不在允许的目录中');
    }
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    setTimeout(() => app.quit(), 1200);
  });

  handle(IPC.windowIsMaximized, async () => getWindow().isMaximized());

  ipcMain.on(IPC.windowMinimize, () => getWindow().minimize());
  ipcMain.on(IPC.windowClose, () => getWindow().close());
  ipcMain.on(IPC.windowToggleMaximize, () => {
    const win = getWindow();
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid ' + name);
}

function registerImageProtocol(): void {
  protocol.handle('murmur', async (request) => {
    try {
      const url = new URL(request.url);
      const target = url.searchParams.get('path') || '';
      if (!target) return new Response('Missing path', { status: 400 });
      const resolved = path.resolve(target);
      const allowed = Array.from(allowedRoots).some((root) => isPathInside(resolved, root));
      if (!allowed) return new Response('Forbidden', { status: 403 });
      const ext = path.extname(resolved).slice(1).toLowerCase();
      const mime = MIME[ext];
      if (!mime) return new Response('Unsupported media type', { status: 415 });
      const data = await fs.readFile(resolved);
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Cache-Control': 'no-cache'
        }
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

let crashPromptShown = false;

async function showCrashPrompt(title: string, error: unknown): Promise<void> {
  if (crashPromptShown) return;
  crashPromptShown = true;
  const logsPath = logger?.filePath || path.join(app.getPath('userData'), 'logs', 'app.log');
  const enabled = logger?.isEnabled() ?? false;
  const detail = enabled
    ? '日志已写入：' + logsPath + '\n\n请将日志文件发送给维护者，便于定位问题。'
    : '日志记录当前未开启。可在「设置 › 工具」中开启后重试，或先把复现步骤发送给维护者。';
  try {
    const result = await dialog.showMessageBox({
      type: 'error',
      title,
      message: 'Sotto 遇到了异常',
      detail,
      buttons: ['打开日志文件夹', '复制日志路径', '关闭'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    });
    if (result.response === 0) {
      await shell.openPath(path.dirname(logsPath));
    } else if (result.response === 1) {
      clipboard.writeText(logsPath);
    }
  } catch {
    // A crash dialog must never mask the original failure.
  }
  if (error instanceof Error) {
    void logger?.error('process', title, error);
  }
}

function installCrashLogging(): void {
  process.on('uncaughtException', (error) => {
    void logger?.error('process', 'uncaughtException', error);
    void showCrashPrompt('未捕获异常', error).finally(() => {
      setTimeout(() => app.exit(1), 500);
    });
  });
  process.on('unhandledRejection', (reason) => {
    void logger?.error('process', 'unhandledRejection', reason);
    void showCrashPrompt('未处理的 Promise 拒绝', reason);
  });
  app.on('child-process-gone', (_event, details) => {
    void logger?.error('child-process', 'gone', new Error(details.reason), {
      type: details.type,
      serviceName: details.serviceName,
      exitCode: details.exitCode
    });
  });
  app.on('before-quit', () => {
    void logger?.info('app', 'quitting');
    void logger?.flush();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#0d0d12',
    title: 'Sotto',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void logger?.error('renderer', 'render-process-gone', new Error(details.reason), {
      exitCode: details.exitCode
    });
    void showCrashPrompt('界面进程异常', new Error(details.reason));
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    void logger?.warn('renderer', 'did-fail-load', { code, description, url });
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      void logger?.warn('renderer-console', message, { line, sourceId });
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IPC_EVENTS.windowMaximized, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IPC_EVENTS.windowMaximized, false);
  });
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    void logger?.info('app', 'second-instance');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.sotto');
    logger = new AppLogger({
      directory: path.join(app.getPath('userData'), 'logs'),
      maxBytes: 5 * 1024 * 1024,
      maxBackups: 3,
      enabled: false
    });
    try {
      await logger.init();
    } catch (error) {
      console.error('[logger] initialization failed', error);
      logger = null;
    }
    installCrashLogging();
    registerImageProtocol();
    registerIpc();
    const settings = await loadSettings();
    logger?.setEnabled(settings.general.loggingEnabled);
    if (logger?.isEnabled()) {
      void logger.info('app', 'started', {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged
      });
    }
    nativeTheme.themeSource =
      settings.theme.mode === 'light' ? 'light' : settings.theme.mode === 'dark' ? 'dark' : 'system';
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}