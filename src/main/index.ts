import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, shell } from 'electron';
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
  Settings
} from '../shared/types';
import { loadSettings, saveSettings } from './settings-store';
import { detectFfmpeg } from './core/ffmpeg';
import { scanLibrary } from './core/scan';
import { buildPlan } from './core/plan';
import { applyPlan, listHistory, undoRunById } from './core/apply';
import { previewSubtitle } from './core/subtitle';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'murmur',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
]);

let mainWindow: BrowserWindow | null = null;
let ffmpegCache: FfmpegInfo | null = null;
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

function handle<T>(channel: string, handler: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) } satisfies IpcResult<T>;
    } catch (error) {
      const err = error as Error & { code?: string; detail?: string };
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
  handle<AppInfo>(IPC.appInfo, async () => ({
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
  }));

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
    return scanLibrary(resolved, (message) => {
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
  });

  handle(IPC.plan, async (request: PlanRequest) => {
    const ffmpeg = await getFfmpeg();
    return buildPlan(request, ffmpeg);
  });

  handle(IPC.apply, async (request: ApplyRequest) => {
    const ffmpeg = await getFfmpeg();
    const runId = crypto.randomUUID();
    return applyPlan(request, {
      runId,
      ffmpeg,
      dataDir: app.getPath('userData'),
      logsDir: path.join(app.getPath('userData'), 'logs'),
      trashFile: async (targetPath: string) => {
        await shell.trashItem(targetPath);
      },
      onProgress: (event) => sendProgress({ ...event, runId })
    });
  });

  handle(IPC.undo, async (runId?: string) => undoRunById(runId, app.getPath('userData')));

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
    return saved;
  });

  handle(IPC.ffmpegInfo, async (refresh?: boolean) => getFfmpeg(Boolean(refresh)));

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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.sotto');
    registerImageProtocol();
    registerIpc();
    const settings = await loadSettings();
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