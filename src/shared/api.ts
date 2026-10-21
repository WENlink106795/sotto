import type {
  AppInfo,
  ApplyRequest,
  ApplyResult,
  FfmpegInfo,
  PlanRequest,
  PlanResult,
  ProgressEvent,
  RunRecord,
  ScanResult,
  Settings,
  SubtitlePreview,
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

  windowMinimize(): void;
  windowToggleMaximize(): void;
  windowClose(): void;
  isWindowMaximized(): Promise<boolean>;
  getPathForFile(file: unknown): string;

  onProgress(listener: (event: ProgressEvent) => void): () => void;
  onWindowMaximized(listener: (maximized: boolean) => void): () => void;
}
