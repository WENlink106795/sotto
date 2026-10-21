export type FileKind = 'audio' | 'subtitle' | 'image' | 'text';
export type AudioFormat = 'mp3' | 'm4a';
export type ThemePreset = 'fluent' | 'material' | 'studio';
export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable';
export type SubtitleEncoding = 'utf-8' | 'utf-8-bom' | 'gb18030';
export type MatchKind = 'exact' | 'normalized' | 'fuzzy' | 'single' | 'manual';

export interface FileInfo {
  path: string;
  name: string;
  base: string;
  ext: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
}

export interface ScanFolder {
  path: string;
  name: string;
  relativePath: string;
  files: FileInfo[];
}

export interface ScanStats {
  audio: number;
  subtitle: number;
  image: number;
  text?: number;
  totalFiles: number;
  bytes: number;
}

export interface ScanResult {
  root: string;
  rootName: string;
  folders: ScanFolder[];
  stats: ScanStats;
  warnings: string[];
  truncated: boolean;
  scannedAt: number;
}

export interface ThemeSettings {
  preset: ThemePreset;
  mode: ThemeMode;
  accent: string;
  density: Density;
  radius: number;
  transparency: boolean;
  reduceMotion: boolean;
  fontScale: number;
}

export interface NamingSettings {
  enabled: boolean;
  normalizeNfkc: boolean;
  removeEmoji: boolean;
  asciiOnly: boolean;
  keepPunctuation: string;
  extraRemove: string;
  extraKeep: string;
  maxBaseLength: number;
  collapseSpaces: boolean;
  renameAudioWithoutSubtitle: boolean;
}

export interface SubtitleSettings {
  convertVtt: boolean;
  convertSrt: boolean;
  convertTxt: boolean;
  deleteSource: boolean;
  encoding: SubtitleEncoding;
  includeMetadata: boolean;
  mergeLines: boolean;
  offsetMs: number;
}

export interface CoverSettings {
  enabled: boolean;
  autoPick: boolean;
  name: string;
  convertToJpeg: boolean;
  overwrite: boolean;
}

export interface ConvertSettings {
  enabled: boolean;
  format: AudioFormat;
  bitrateKbps: number;
  deleteOriginal: boolean;
  formats: string[];
  concurrency: number;
}

export interface RecentLibrary {
  root: string;
  name: string;
  lastOpenedAt: number;
  audioCount: number;
}

export interface GeneralSettings {
  language: 'zh-CN' | 'en-US';
  ffmpegPath: string;
  recentRoots: RecentLibrary[];
  showAdvanced: boolean;
}

export interface Settings {
  version: 1;
  theme: ThemeSettings;
  naming: NamingSettings;
  subtitle: SubtitleSettings;
  cover: CoverSettings;
  convert: ConvertSettings;
  general: GeneralSettings;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  userDataPath: string;
  logsPath: string;
  osRelease: string;
}

export interface FfmpegInfo {
  available: boolean;
  path: string;
  version: string;
  source: 'custom' | 'bundled' | 'path' | 'common' | 'missing';
  checkedAt: number;
}

export interface PlanWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface AudioConversionPlan {
  sourcePath: string;
  outputPath: string;
  outputName: string;
  format: AudioFormat;
  bitrateKbps: number;
  deleteOriginal: boolean;
  estimatedBytes: number | null;
  skipReason: string | null;
}

export interface PairPlan {
  id: string;
  folder: string;
  audio: FileInfo;
  subtitle: FileInfo | null;
  match: MatchKind;
  score: number;
  targetBase: string;
  renamedAudioName: string;
  audioRenameNeeded: boolean;
  subtitleSourceName: string | null;
  subtitleConvert: boolean;
  subtitleDeleteSource: boolean;
  subtitleOutputName: string | null;
  subtitleRenameName: string | null;
  existingLrc: FileInfo | null;
  lrcWillOverwrite: boolean;
  audioConversion: AudioConversionPlan | null;
  removedChars: string[];
  warnings: PlanWarning[];
}

export interface CoverPlan {
  folder: string;
  image: FileInfo;
  targetName: string;
  targetPath: string;
  action: 'none' | 'move' | 'copy' | 'convert';
  existingTarget: FileInfo | null;
  overwrite: boolean;
  warnings: PlanWarning[];
}

export interface FolderPlan {
  folder: string;
  folderName: string;
  relativePath: string;
  pairs: PairPlan[];
  orphanAudios: FileInfo[];
  orphanSubtitles: FileInfo[];
  coverCandidates: FileInfo[];
  cover: CoverPlan | null;
  warnings: PlanWarning[];
}

export interface PlanSummary {
  folders: number;
  pairs: number;
  renames: number;
  subtitleConversions: number;
  audioConversions: number;
  covers: number;
  warnings: number;
  errors: number;
  renamedBytes: number;
}

export interface PlanResult {
  planId: string;
  root: string;
  rootName: string;
  folders: FolderPlan[];
  summary: PlanSummary;
  settingsSnapshot: Settings;
  ffmpeg: FfmpegInfo;
  createdAt: number;
}

export interface ManualPair {
  audioPath: string;
  subtitlePath: string;
}

export interface CoverChoice {
  folder: string;
  imagePath: string;
  convertToJpeg?: boolean;
}

export interface PlanRequest {
  root: string;
  settings: Settings;
  manualPairs: ManualPair[];
  coverChoices: CoverChoice[];
}

export interface ApplySelection {
  pairIds: string[] | null;
  coverFolders: string[] | null;
  renameAudio: boolean;
  renameSubtitle: boolean;
  convertSubtitles: boolean;
  convertAudio: boolean;
  applyCovers: boolean;
}

export interface ApplyRequest {
  plan: PlanResult;
  selection: ApplySelection;
}

export type ApplyItemKind =
  | 'rename-audio'
  | 'rename-subtitle'
  | 'convert-subtitle'
  | 'delete-subtitle-source'
  | 'convert-audio'
  | 'trash-audio-original'
  | 'cover'
  | 'cover-convert';

export interface ApplyItem {
  kind: ApplyItemKind;
  from: string | null;
  to: string | null;
  status: 'success' | 'failed' | 'skipped';
  message: string;
}

export interface ApplyStats {
  renamed: number;
  subtitlesConverted: number;
  audioConverted: number;
  covers: number;
  failed: number;
  skipped: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface ApplyResult {
  runId: string;
  root: string;
  status: 'success' | 'partial' | 'failed';
  startedAt: number;
  finishedAt: number;
  stats: ApplyStats;
  items: ApplyItem[];
  undoAvailable: boolean;
  logPath: string | null;
}

export type UndoStatus = 'success' | 'partial' | 'failed';

export interface UndoResult {
  runId: string;
  status: UndoStatus;
  restored: number;
  failed: number;
  items: ApplyItem[];
  message: string;
}

export interface RunRecord {
  runId: string;
  root: string;
  rootName: string;
  startedAt: number;
  finishedAt: number;
  status: 'success' | 'partial' | 'failed';
  stats: ApplyStats;
  undoAvailable: boolean;
  undoneAt: number | null;
}

export type ProgressPhase =
  | 'scan'
  | 'plan'
  | 'rename'
  | 'subtitle'
  | 'audio'
  | 'cover'
  | 'finish';

export interface ProgressEvent {
  runId: string;
  phase: ProgressPhase;
  current: number;
  total: number;
  overallPercent: number;
  message: string;
  detail: string | null;
  level: 'info' | 'warn' | 'error';
  at: number;
}

export interface SubtitlePreview {
  sourcePath: string;
  sourceEncoding: string;
  cueCount: number;
  durationMs: number | null;
  lrc: string;
  lrcBytes: number;
  warnings: string[];
}

export interface PickedImage {
  path: string;
  name: string;
  ext: string;
  size: number;
}

export interface AppErrorShape {
  code: string;
  message: string;
  detail?: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape };