import type {
  AppInfo,
  ApplyRequest,
  AudioFormat,
  ConverterProgress,
  ConverterRequest,
  ConverterResult,
  ConverterScan,
  RendererLogEntry,
  ApplyResult,
  FfmpegInfo,
  PlanRequest,
  PlanResult,
  ProgressEvent,
  UpdateInfo,
  RunRecord,
  ScanResult,
  Settings,
  SubtitlePreview,
  UpdateProgress,
  UndoResult
} from './types';

export interface MurmurApi {
  getAppInfo(): Promise<AppInfo>;
  pickFolder(): Promise<string | null>;
  pickFfmpeg(): Promise<string | null>;
  openPath(targetPath: string): Promise<void>;
  revealPath(targetPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;

  scan(root: string): Promise<ScanResult>;
  buildPlan(request: PlanRequest): Promise<PlanResult>;
  applyPlan(request: ApplyRequest): Promise<ApplyResult>;
  undoRun(runId?: string): Promise<UndoResult>;
  getHistory(): Promise<RunRecord[]>;
  previewSubtitle(sourcePath: string, settings: Settings): Promise<SubtitlePreview>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getFfmpegInfo(refresh?: boolean): Promise<FfmpegInfo>;
  log(entry: RendererLogEntry): Promise<void>;
  exportLogs(): Promise<string | null>;
  exportSettings(): Promise<string | null>;
  importSettings(): Promise<Settings | null>;
  checkForUpdates(force?: boolean): Promise<UpdateInfo | null>;
  downloadUpdate(info: UpdateInfo): Promise<string>;
  installUpdate(filePath: string): Promise<void>;

  pickConverterSource(mode: 'file' | 'folder'): Promise<string | null>;
  pickConverterOutput(): Promise<string | null>;
  scanConverter(request: ConverterRequest): Promise<ConverterScan>;
  startConverter(request: ConverterRequest): Promise<ConverterResult>;
  readClipboardText(): Promise<string>;

  windowMinimize(): void;
  windowToggleMaximize(): void;
  windowClose(): void;
  isWindowMaximized(): Promise<boolean>;
  getPathForFile(file: unknown): string;

  onProgress(listener: (event: ProgressEvent) => void): () => void;
  onWindowMaximized(listener: (maximized: boolean) => void): () => void;
  onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void;
  onConverterProgress(listener: (progress: ConverterProgress) => void): () => void;
}