import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MurmurApi } from '../shared/api';
import { IPC, IPC_EVENTS } from '../shared/ipc';
import type { IpcResult, ProgressEvent, UpdateInfo, UpdateProgress } from '../shared/types';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new Error('Invalid IPC response from main process');
  }
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & { code?: string; detail?: string };
    error.code = result.error.code;
    error.detail = result.error.detail;
    throw error;
  }
  return result.data;
}

const api: MurmurApi = {
  getAppInfo: () => invoke(IPC.appInfo),
  pickFolder: () => invoke(IPC.pickFolder),
  pickFfmpeg: () => invoke(IPC.pickFfmpeg),
  openPath: (targetPath) => invoke(IPC.openPath, targetPath),
  revealPath: (targetPath) => invoke(IPC.revealPath, targetPath),
  openExternal: (url) => invoke(IPC.openExternal, url),

  scan: (root) => invoke(IPC.scan, root),
  buildPlan: (request) => invoke(IPC.plan, request),
  applyPlan: (request) => invoke(IPC.apply, request),
  undoRun: (runId) => invoke(IPC.undo, runId),
  getHistory: () => invoke(IPC.history),
  previewSubtitle: (sourcePath, settings) => invoke(IPC.subtitlePreview, sourcePath, settings),

  getSettings: () => invoke(IPC.settingsGet),
  saveSettings: (settings) => invoke(IPC.settingsSave, settings),
  getFfmpegInfo: (refresh) => invoke(IPC.ffmpegInfo, Boolean(refresh)),
  log: (entry) => invoke(IPC.logWrite, entry),
  exportLogs: () => invoke(IPC.exportLogs),
  exportSettings: () => invoke(IPC.settingsExport),
  importSettings: () => invoke(IPC.settingsImport),
  checkForUpdates: (force) => invoke(IPC.updateCheck, Boolean(force)),
  downloadUpdate: (info: UpdateInfo) => invoke(IPC.updateDownload, info) as Promise<string>,
  installUpdate: (filePath: string) => invoke(IPC.updateInstall, filePath),

  windowMinimize: () => ipcRenderer.send(IPC.windowMinimize),
  windowToggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
  windowClose: () => ipcRenderer.send(IPC.windowClose),
  isWindowMaximized: () => invoke(IPC.windowIsMaximized),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file as File);
    } catch {
      return '';
    }
  },

  onProgress: (listener) => {
    const wrapped = (_event: unknown, payload: ProgressEvent) => listener(payload);
    ipcRenderer.on(IPC_EVENTS.progress, wrapped);
    return () => ipcRenderer.removeListener(IPC_EVENTS.progress, wrapped);
  },
  onWindowMaximized: (listener) => {
    const wrapped = (_event: unknown, maximized: boolean) => listener(maximized);
    ipcRenderer.on(IPC_EVENTS.windowMaximized, wrapped);
    return () => ipcRenderer.removeListener(IPC_EVENTS.windowMaximized, wrapped);
  },
  onUpdateProgress: (listener) => {
    const wrapped = (_event: unknown, payload: UpdateProgress) => listener(payload);
    ipcRenderer.on(IPC_EVENTS.updateProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC_EVENTS.updateProgress, wrapped);
  }
};

contextBridge.exposeInMainWorld('murmur', api);