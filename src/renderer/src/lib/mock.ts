import { cloneSettings, DEFAULT_SETTINGS } from '@shared/defaults';
import {
  extensionOf,
  joinBaseAndExt,
  matchKeyWithoutBrackets,
  normalizeForMatch,
  sanitizeBaseName,
  stripExtension
} from '@shared/naming';
import type {
  AppInfo,
  ApplyRequest,
  ApplySelection,
  ApplyResult,
  ApplyStats,
  AudioConversionPlan,
  CoverChoice,
  CoverPlan,
  FfmpegInfo,
  FileInfo,
  FileKind,
  FolderPlan,
  MatchKind,
  PairPlan,
  PlanRequest,
  PlanResult,
  PlanWarning,
  ProgressEvent,
  RendererLogEntry,
  RunRecord,
  ScanFolder,
  ScanResult,
  Settings,
  SubtitlePreview,
  UndoResult,
  UpdateInfo,
  UpdateProgress
} from '@shared/types';
import type { MurmurApi } from '@shared/api';

export const DEMO_ROOT = 'D:\\ASMR\\Whisper Garden';
const DEMO_ROOT_NAME = 'Whisper Garden';

interface DemoFileSpec {
  name: string;
  kind: FileKind;
  size: number;
}

interface DemoFolderSpec {
  name: string;
  files: DemoFileSpec[];
}

const DEMO_FOLDERS: DemoFolderSpec[] = [
  {
    name: '01 雨夜书房 Rain Study',
    files: [
      { name: '【简体】01 耳边轻语♡.wav', kind: 'audio', size: 62914560 },
      { name: '简体 01 耳边轻语.vtt', kind: 'subtitle', size: 8240 },
      { name: '02 - 雨夜助眠 ☆.flac', kind: 'audio', size: 138412032 },
      { name: '02 - 雨夜助眠 ☆.vtt', kind: 'subtitle', size: 7880 },
      { name: '03 Track 03： whispered story.mp3', kind: 'audio', size: 12845056 },
      { name: 'Track 03 whispered story (CV：雨宮).vtt', kind: 'subtitle', size: 10120 },
      { name: 'cover.jpg', kind: 'image', size: 1240000 },
      { name: '夜雨封面-竖版.jpg', kind: 'image', size: 820000 },
      { name: '纹理.png', kind: 'image', size: 2100000 }
    ]
  },
  {
    name: '02 枕边低语 Pillow Whispers',
    files: [
      { name: '【KU100】04 耳元でささやき♪.mp3', kind: 'audio', size: 24117248 },
      { name: '【KU100】04 耳元でささやき.vtt', kind: 'subtitle', size: 9120 },
      { name: '05 晚安，好梦… (Full Ver.).m4a', kind: 'audio', size: 9807872 },
      { name: '05 晚安，好梦… (Full Ver.).vtt', kind: 'subtitle', size: 11240 },
      { name: '05 晚安，好梦… (Full Ver.).lrc', kind: 'subtitle', size: 6840 },
      { name: 'pillow art.png', kind: 'image', size: 1520000 },
      { name: '枕边低语.jpg', kind: 'image', size: 980000 }
    ]
  },
  {
    name: '03 深海安眠 Deep Blue',
    files: [
      { name: '06 深海のゆらぎ♡ (48kHz).flac', kind: 'audio', size: 96337920 },
      { name: '06 深海のゆらぎ 48kHz.vtt', kind: 'subtitle', size: 8640 },
      { name: '07 潮汐耳语[立体声]♡.wav', kind: 'audio', size: 184549376 },
      { name: '07 潮汐耳语 立体声 (CV：雨宮).srt', kind: 'subtitle', size: 10240 },
      { name: 'deep blue cover.webp', kind: 'image', size: 1760000 },
      { name: 'waves.jpg', kind: 'image', size: 1120000 }
    ]
  },
  {
    name: '04 篝火与呼吸 Campfire',
    files: [
      { name: '08 篝火边的呼吸声☆.flac', kind: 'audio', size: 74186752 },
      { name: 'campfire breath.vtt', kind: 'subtitle', size: 7460 },
      { name: '09 指尖划过麦克风.wav', kind: 'audio', size: 121634816 },
      { name: '09 指尖划过麦克风.srt', kind: 'subtitle', size: 9180 },
      { name: '10 未命名的白噪音.wav', kind: 'audio', size: 168820736 },
      { name: 'ember.png', kind: 'image', size: 1340000 },
      { name: 'campfire.jpg', kind: 'image', size: 1240000 }
    ]
  }
];

const CAPTURE_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('capture') === '1';
  } catch {
    return false;
  }
})();

function delay(min = 250, max = 650): Promise<void> {
  if (CAPTURE_MODE) {
    return new Promise((resolve) => window.setTimeout(resolve, 50 + Math.random() * 60));
  }
  const span = Math.max(1, max - min);
  return new Promise((resolve) => window.setTimeout(resolve, min + Math.random() * span));
}

function fileInfo(folderPath: string, spec: DemoFileSpec, index: number): FileInfo {
  const ext = extensionOf(spec.name);
  return {
    path: folderPath + '\\' + spec.name,
    name: spec.name,
    base: stripExtension(spec.name),
    ext,
    kind: spec.kind,
    size: spec.size,
    mtimeMs: Date.now() - (index + 1) * 3600 * 1000 * 27
  };
}

function buildScan(root: string): ScanResult {
  const folders: ScanFolder[] = DEMO_FOLDERS.map((folder, folderIndex) => {
    const path = root + '\\' + folder.name;
    return {
      path,
      name: folder.name,
      relativePath: folder.name,
      files: folder.files.map((spec, fileIndex) => fileInfo(path, spec, folderIndex * 7 + fileIndex))
    };
  });
  const stats = { audio: 0, subtitle: 0, image: 0, totalFiles: 0, bytes: 0 };
  for (const folder of folders) {
    for (const file of folder.files) {
      stats.totalFiles += 1;
      stats.bytes += file.size;
      if (file.kind === 'audio') stats.audio += 1;
      if (file.kind === 'subtitle') stats.subtitle += 1;
      if (file.kind === 'image') stats.image += 1;
    }
  }
  return {
    root,
    rootName: pathName(root),
    folders,
    stats,
    warnings: [],
    truncated: false,
    scannedAt: Date.now()
  };
}

function pathName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

interface MatchCandidate {
  match: MatchKind;
  score: number;
}

function evaluateMatch(audioBase: string, subtitleBase: string): MatchCandidate | null {
  if (audioBase === subtitleBase) return { match: 'exact', score: 1 };
  const audioNormal = normalizeForMatch(audioBase);
  const subtitleNormal = normalizeForMatch(subtitleBase);
  if (audioNormal && audioNormal === subtitleNormal) return { match: 'normalized', score: 0.94 };
  const audioKey = matchKeyWithoutBrackets(audioBase);
  const subtitleKey = matchKeyWithoutBrackets(subtitleBase);
  if (audioKey && subtitleKey && (audioKey === subtitleKey || audioKey.includes(subtitleKey) || subtitleKey.includes(audioKey))) {
    return { match: 'fuzzy', score: 0.82 };
  }
  if (audioNormal && subtitleNormal) {
    const shorter = audioNormal.length <= subtitleNormal.length ? audioNormal : subtitleNormal;
    const longer = shorter === audioNormal ? subtitleNormal : audioNormal;
    if (shorter.length >= 6 && longer.includes(shorter)) return { match: 'fuzzy', score: 0.68 };
  }
  return null;
}

function makeWarnings(match: MatchKind, removed: string[], existingLrc: FileInfo | null, subtitleConvert: boolean): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const hasInvalidCharWarning = removed.some((char) => char === '：' || char === ':');
  if (match === 'fuzzy' && !hasInvalidCharWarning) {
    warnings.push({
      code: 'FUZZY_MATCH',
      severity: 'warning',
      message: '字幕为模糊匹配，建议确认配对是否正确。'
    });
  }
  if (removed.length > 0 && removed.some((char) => char === '：' || char === ':')) {
    warnings.push({
      code: 'INVALID_CHAR',
      severity: 'warning',
      message: '文件名中的「：」不属于播放器兼容字符，执行时会自动移除。'
    });
  }
  if (existingLrc && subtitleConvert) {
    warnings.push({
      code: 'LRC_EXISTS',
      severity: 'info',
      message: '目标位置已有 LRC，执行时会保留备份后更新。'
    });
  }
  return warnings;
}

function buildConversion(
  audio: FileInfo,
  targetBase: string,
  folderPath: string,
  settings: Settings
): AudioConversionPlan | null {
  if (!settings.convert.enabled) return null;
  const formats = settings.convert.formats.map((item) => item.toLowerCase());
  if (!formats.includes(audio.ext)) return null;
  if (audio.ext === settings.convert.format) return null;
  const outputName = joinBaseAndExt(targetBase, settings.convert.format);
  const ratio = audio.ext === 'wav' ? 0.14 : 0.42;
  const estimated = Math.round(audio.size * ratio * (settings.convert.bitrateKbps / 192));
  return {
    sourcePath: audio.path,
    outputPath: folderPath + '\\' + outputName,
    outputName,
    format: settings.convert.format,
    bitrateKbps: settings.convert.bitrateKbps,
    deleteOriginal: settings.convert.deleteOriginal,
    estimatedBytes: estimated,
    skipReason: null
  };
}

function findExistingLrc(folderFiles: FileInfo[], targetBase: string, subtitle: FileInfo | null): FileInfo | null {
  return (
    folderFiles.find((file) => {
      if (file.kind !== 'subtitle' || file.ext !== 'lrc') return false;
      if (subtitle && file.path === subtitle.path) return false;
      return normalizeForMatch(file.base) === normalizeForMatch(targetBase);
    }) || null
  );
}

function buildPair(
  folderPath: string,
  folderIndex: number,
  pairIndex: number,
  audio: FileInfo,
  subtitle: FileInfo | null,
  match: MatchKind,
  score: number,
  folderFiles: FileInfo[],
  settings: Settings
): PairPlan {
  const sanitized = sanitizeBaseName(audio.base, settings.naming);
  const targetBase = sanitized.value;
  const subtitleConvert = Boolean(
    subtitle && ((subtitle.ext === 'vtt' && settings.subtitle.convertVtt) || (subtitle.ext === 'srt' && settings.subtitle.convertSrt))
  );
  const audioConversion = buildConversion(audio, targetBase, folderPath, settings);
  const renamedAudioName = joinBaseAndExt(targetBase, audio.ext);
  const audioRenameNeeded = renamedAudioName.toLowerCase() !== audio.name.toLowerCase();
  const subtitleOutputName = subtitle && subtitleConvert ? joinBaseAndExt(targetBase, 'lrc') : null;
  let subtitleRenameName: string | null = null;
  if (subtitle) {
    if (subtitleConvert) {
      subtitleRenameName = settings.subtitle.deleteSource ? null : joinBaseAndExt(targetBase, subtitle.ext);
    } else {
      subtitleRenameName = joinBaseAndExt(targetBase, subtitle.ext);
    }
  }
  const existingLrc = findExistingLrc(folderFiles, targetBase, subtitle);
  const removedChars = sanitized.removed.map((item) => item.char).slice(0, 4);
  const warnings = makeWarnings(match, removedChars, existingLrc, subtitleConvert);
  return {
    id: 'pair-' + folderIndex + '-' + pairIndex + '-' + audio.ext,
    folder: folderPath,
    audio,
    subtitle,
    match,
    score,
    targetBase,
    renamedAudioName,
    audioRenameNeeded,
    subtitleSourceName: subtitle ? subtitle.name : null,
    subtitleConvert,
    subtitleDeleteSource: subtitleConvert && settings.subtitle.deleteSource,
    subtitleOutputName,
    subtitleRenameName,
    existingLrc,
    lrcWillOverwrite: Boolean(existingLrc && subtitleConvert),
    audioConversion,
    removedChars,
    warnings
  };
}

function matchFolderPairs(files: FileInfo[]): { audio: FileInfo; subtitle: FileInfo | null; match: MatchKind; score: number }[] {
  const audios = files.filter((file) => file.kind === 'audio');
  const subtitles = files.filter((file) => file.kind === 'subtitle');
  const used = new Set<string>();
  const result: { audio: FileInfo; subtitle: FileInfo | null; match: MatchKind; score: number }[] = [];
  for (const audio of audios) {
    let best: { subtitle: FileInfo; match: MatchKind; score: number } | null = null;
    for (const subtitle of subtitles) {
      if (used.has(subtitle.path)) continue;
      const evaluated = evaluateMatch(audio.base, subtitle.base);
      if (evaluated && (!best || evaluated.score > best.score)) {
        best = { subtitle, match: evaluated.match, score: evaluated.score };
      }
    }
    if (best) {
      used.add(best.subtitle.path);
      result.push({ audio, subtitle: best.subtitle, match: best.match, score: best.score });
    } else {
      result.push({ audio, subtitle: null, match: 'manual', score: 0 });
    }
  }
  const leftovers = subtitles.filter((subtitle) => !used.has(subtitle.path));
  const unmatched = result.filter((item) => !item.subtitle);
  if (leftovers.length === 1 && unmatched.length >= 1) {
    const target = unmatched[0];
    const subtitle = leftovers[0];
    target.subtitle = subtitle;
    target.match = 'single';
    target.score = 0.45;
    used.add(subtitle.path);
  }
  return result;
}

function coverPlanFor(
  folderPath: string,
  images: FileInfo[],
  choices: CoverChoice[],
  settings: Settings
): CoverPlan | null {
  const choice = choices.find((item) => item.folder === folderPath);
  if (!choice) return null;
  const image = images.find((item) => item.path === choice.imagePath);
  if (!image) return null;
  const convert = choice.convertToJpeg !== undefined ? choice.convertToJpeg : settings.cover.convertToJpeg;
  const wantsJpeg = convert || image.ext === 'jpg' || image.ext === 'jpeg';
  const targetName = (settings.cover.name || 'cover') + (wantsJpeg ? '.jpg' : '.' + image.ext);
  const targetPath = folderPath + '\\' + targetName;
  let action: CoverPlan['action'] = 'move';
  if (image.path === targetPath) action = 'none';
  else if (convert && image.ext !== 'jpg' && image.ext !== 'jpeg') action = 'convert';
  const existingTarget = images.find((item) => item.path === targetPath) || null;
  const warnings: PlanWarning[] = [];
  if (existingTarget && existingTarget.path !== image.path && !settings.cover.overwrite) {
    warnings.push({
      code: 'COVER_EXISTS',
      severity: 'warning',
      message: '目录中已存在 ' + targetName + '，执行时先备份旧封面。'
    });
  }
  return {
    folder: folderPath,
    image,
    targetName,
    targetPath,
    action,
    existingTarget,
    overwrite: settings.cover.overwrite,
    warnings
  };
}

const MOCK_FFMPEG: FfmpegInfo = {
  available: true,
  path: 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe',
  version: '7.1.1',
  source: 'path',
  checkedAt: Date.now()
};

function buildDemoPlan(request: PlanRequest): PlanResult {
  const scan = buildScan(request.root);
  const folders: FolderPlan[] = [];
  let pairSeed = 0;
  for (let folderIndex = 0; folderIndex < scan.folders.length; folderIndex += 1) {
    const scanFolder = scan.folders[folderIndex];
    const audios = scanFolder.files.filter((file) => file.kind === 'audio');
    const subtitles = scanFolder.files.filter((file) => file.kind === 'subtitle');
    const images = scanFolder.files.filter((file) => file.kind === 'image');
    const matches = matchFolderPairs(scanFolder.files);
    const pairs: PairPlan[] = [];
    for (const item of matches) {
      if (!item.subtitle && !request.settings.naming.renameAudioWithoutSubtitle) continue;
      pairSeed += 1;
      pairs.push(
        buildPair(
          scanFolder.path,
          folderIndex,
          pairSeed,
          item.audio,
          item.subtitle,
          item.match,
          item.score,
          scanFolder.files,
          request.settings
        )
      );
    }
    const pairedAudioPaths = new Set(pairs.map((pair) => pair.audio.path));
    const pairedSubtitlePaths = new Set(
      pairs.map((pair) => (pair.subtitle ? pair.subtitle.path : '')).filter(Boolean)
    );
    const linkedLrcPaths = new Set(
      pairs.map((pair) => (pair.existingLrc ? pair.existingLrc.path : '')).filter(Boolean)
    );
    const orphanAudios = audios.filter((audio) => !pairedAudioPaths.has(audio.path));
    const orphanSubtitles = subtitles.filter(
      (subtitle) => !pairedSubtitlePaths.has(subtitle.path) && !linkedLrcPaths.has(subtitle.path)
    );
    const cover = coverPlanFor(scanFolder.path, images, request.coverChoices, request.settings);
    const folderWarnings: PlanWarning[] = [];
    folders.push({
      folder: scanFolder.path,
      folderName: scanFolder.name,
      relativePath: scanFolder.relativePath,
      pairs,
      orphanAudios,
      orphanSubtitles,
      coverCandidates: images,
      cover,
      warnings: folderWarnings
    });
  }
  const summary = summarize(folders, scan.stats.totalFiles, scan.stats.bytes);
  return {
    planId: 'plan-demo-' + Date.now().toString(36),
    root: scan.root,
    rootName: scan.rootName,
    folders,
    summary,
    settingsSnapshot: cloneSettings(request.settings),
    ffmpeg: { ...MOCK_FFMPEG, checkedAt: Date.now() },
    createdAt: Date.now()
  };
}

function summarize(folders: FolderPlan[], totalFiles: number, bytes: number): PlanResult['summary'] {
  const summary = {
    folders: folders.length,
    pairs: 0,
    renames: 0,
    subtitleConversions: 0,
    audioConversions: 0,
    covers: 0,
    warnings: 0,
    errors: 0,
    renamedBytes: 0
  };
  for (const folder of folders) {
    summary.pairs += folder.pairs.length;
    if (folder.cover && folder.cover.action !== 'none') summary.covers += 1;
    for (const pair of folder.pairs) {
      if (pair.audioRenameNeeded) {
        summary.renames += 1;
        summary.renamedBytes += pair.audio.size;
      }
      if (pair.subtitleRenameName && pair.subtitle && pair.subtitleRenameName !== pair.subtitle.name) {
        summary.renames += 1;
        if (pair.subtitle) summary.renamedBytes += pair.subtitle.size;
      }
      if (pair.subtitleConvert) summary.subtitleConversions += 1;
      if (pair.audioConversion) summary.audioConversions += 1;
      for (const warning of pair.warnings) {
        if (warning.severity === 'warning') summary.warnings += 1;
        if (warning.severity === 'error') {
          summary.warnings += 1;
          summary.errors += 1;
        }
      }
    }
    for (const warning of folder.warnings) {
      if (warning.severity === 'warning') summary.warnings += 1;
      if (warning.severity === 'error') {
        summary.warnings += 1;
        summary.errors += 1;
      }
    }
  }
  void totalFiles;
  void bytes;
  return summary;
}


function mockHistory(): RunRecord[] {
  const now = Date.now();
  return [
    {
      runId: 'run-demo-101',
      root: DEMO_ROOT,
      rootName: DEMO_ROOT_NAME,
      startedAt: now - 1000 * 60 * 60 * 3,
      finishedAt: now - 1000 * 60 * 60 * 3 + 1000 * 96,
      status: 'success',
      stats: {
        renamed: 12,
        subtitlesConverted: 9,
        audioConverted: 6,
        covers: 3,
        failed: 0,
        skipped: 0,
        bytesBefore: 1041423868,
        bytesAfter: 482116440
      },
      undoAvailable: true,
      undoneAt: null
    },
    {
      runId: 'run-demo-102',
      root: 'E:\\Audio\\Night Sessions 2024',
      rootName: 'Night Sessions 2024',
      startedAt: now - 1000 * 60 * 60 * 26,
      finishedAt: now - 1000 * 60 * 60 * 26 + 1000 * 64,
      status: 'partial',
      stats: {
        renamed: 6,
        subtitlesConverted: 5,
        audioConverted: 0,
        covers: 2,
        failed: 1,
        skipped: 2,
        bytesBefore: 322122547,
        bytesAfter: 322122547
      },
      undoAvailable: false,
      undoneAt: null
    },
    {
      runId: 'run-demo-103',
      root: 'D:\\Voice\\雨声收藏',
      rootName: '雨声收藏',
      startedAt: now - 1000 * 60 * 60 * 24 * 4,
      finishedAt: now - 1000 * 60 * 60 * 24 * 4 + 1000 * 41,
      status: 'success',
      stats: {
        renamed: 4,
        subtitlesConverted: 4,
        audioConverted: 1,
        covers: 1,
        failed: 0,
        skipped: 0,
        bytesBefore: 186646528,
        bytesAfter: 118489088
      },
      undoAvailable: false,
      undoneAt: null
    }
  ];
}

let mockSettings: Settings = (() => {
  const settings = cloneSettings(DEFAULT_SETTINGS);
  settings.convert.enabled = true;
  settings.convert.format = 'mp3';
  settings.convert.bitrateKbps = 192;
  settings.general.recentRoots = [
    {
      root: DEMO_ROOT,
      name: DEMO_ROOT_NAME,
      lastOpenedAt: Date.now() - 1000 * 60 * 60 * 3,
      audioCount: 42
    },
    {
      root: 'E:\\Audio\\Night Sessions 2024',
      name: 'Night Sessions 2024',
      lastOpenedAt: Date.now() - 1000 * 60 * 60 * 26,
      audioCount: 18
    },
    {
      root: 'D:\\Voice\\雨声收藏',
      name: '雨声收藏',
      lastOpenedAt: Date.now() - 1000 * 60 * 60 * 24 * 4,
      audioCount: 7
    }
  ];
  return settings;
})();

let history: RunRecord[] = mockHistory();
const progressListeners = new Set<(event: ProgressEvent) => void>();

export function createMockApi(): MurmurApi {
  return {
    async getAppInfo(): Promise<AppInfo> {
      await delay(120, 260);
      return {
        name: 'Sotto',
        version: '0.1.0',
        electron: '34.5.3',
        chrome: '132.0.6834.210',
        node: '20.18.1',
        platform: 'win32',
        arch: 'x64',
        isPackaged: false,
        userDataPath: 'C:\\Users\\Mika\\AppData\\Roaming\\Sotto',
        logsPath: 'C:\\Users\\Mika\\AppData\\Roaming\\Sotto\\logs',
        osRelease: '10.0.22631'
      };
    },
    async pickFolder(): Promise<string | null> {
      await delay(280, 500);
      return DEMO_ROOT;
    },
    async pickFfmpeg(): Promise<string | null> {
      await delay(250, 450);
      return 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe';
    },
    async openPath(): Promise<void> {
      await delay(80, 160);
    },
    async revealPath(): Promise<void> {
      await delay(80, 160);
    },
    async openExternal(): Promise<void> {
      await delay(80, 160);
    },
    async scan(root: string): Promise<ScanResult> {
      await delay(380, 620);
      return buildScan(root || DEMO_ROOT);
    },
    async buildPlan(request: PlanRequest): Promise<PlanResult> {
      await delay(300, 560);
      return buildDemoPlan(request);
    },
    async applyPlan(request: ApplyRequest): Promise<ApplyResult> {
      const plan = request.plan;
      const selection = request.selection;
      const runId = 'run-' + Date.now().toString(36);
      const startedAt = Date.now();
      const pairNames = plan.folders.flatMap((folder) => folder.pairs.map((pair) => pair.renamedAudioName));
      const subtitleNames = plan.folders
        .flatMap((folder) => folder.pairs.map((pair) => pair.subtitleRenameName || ''))
        .filter(Boolean);
      const audioNames = plan.folders
        .flatMap((folder) => folder.pairs.map((pair) => (pair.audioConversion ? pair.audioConversion.outputName : '')))
        .filter(Boolean);
      const coverNames = plan.folders
        .map((folder) => (folder.cover ? folder.cover.targetName : ''))
        .filter(Boolean);
      const steps: { phase: ProgressEvent['phase']; message: string; detail: string | null }[] = [];
      for (let i = 0; i < 6; i += 1) {
        steps.push({
          phase: 'rename',
          message: '统一音频与字幕名称',
          detail: pairNames[i % Math.max(1, pairNames.length)] || null
        });
      }
      for (let i = 0; i < 5; i += 1) {
        steps.push({
          phase: 'subtitle',
          message: '转换字幕为 LRC',
          detail: subtitleNames[i % Math.max(1, subtitleNames.length)] || null
        });
      }
      for (let i = 0; i < 4; i += 1) {
        steps.push({
          phase: 'audio',
          message: '转码音频',
          detail: audioNames[i % Math.max(1, audioNames.length)] || null
        });
      }
      for (let i = 0; i < 3; i += 1) {
        steps.push({
          phase: 'cover',
          message: '整理封面',
          detail: coverNames[i % Math.max(1, coverNames.length)] || null
        });
      }
      steps.push({ phase: 'finish', message: '收尾并写入运行记录', detail: null });
      const total = steps.length;
      for (let index = 0; index < total; index += 1) {
        await delay(180, 260);
        const step = steps[index];
        const overallPercent = Math.min(100, Math.round(((index + 1) / total) * 100));
        const event: ProgressEvent = {
          runId,
          phase: step.phase,
          current: index + 1,
          total,
          overallPercent,
          message: step.message,
          detail: step.detail,
          level: 'info',
          at: Date.now()
        };
        progressListeners.forEach((listener) => listener(event));
      }
      await delay(220, 320);
      const stats = computeApplyStats(plan, selection);
      const finishedAt = Date.now();
      const result: ApplyResult = {
        runId,
        root: plan.root,
        status: 'success',
        startedAt,
        finishedAt,
        stats,
        items: [],
        undoAvailable: true,
        logPath: 'C:\\Users\\Mika\\AppData\\Roaming\\Sotto\\logs\\' + runId + '.log'
      };
      const record: RunRecord = {
        runId,
        root: plan.root,
        rootName: plan.rootName,
        startedAt,
        finishedAt,
        status: 'success',
        stats,
        undoAvailable: true,
        undoneAt: null
      };
      history = [record, ...history].slice(0, 12);
      return result;
    },
    async undoRun(runId?: string): Promise<UndoResult> {
      await delay(500, 900);
      const target = runId
        ? history.find((record) => record.runId === runId)
        : history.find((record) => record.undoAvailable && !record.undoneAt);
      if (!target) {
        return {
          runId: runId || '',
          status: 'failed',
          restored: 0,
          failed: 0,
          items: [],
          message: '没有可撤销的操作。'
        };
      }
      const restored = target.stats.renamed + target.stats.subtitlesConverted + target.stats.audioConverted + target.stats.covers;
      history = history.map((record) =>
        record.runId === target.runId ? { ...record, undoAvailable: false, undoneAt: Date.now() } : record
      );
      return {
        runId: target.runId,
        status: 'success',
        restored,
        failed: 0,
        items: [],
        message: '已恢复 ' + restored + ' 项改动。'
      };
    },
    async getHistory(): Promise<RunRecord[]> {
      await delay(220, 420);
      return history.map((record) => ({ ...record, stats: { ...record.stats } }));
    },
    async previewSubtitle(sourcePath: string, settings: Settings): Promise<SubtitlePreview> {
      await delay(300, 500);
      const lrc = [
        '[ti:雨夜书房]',
        '[ar:Whisper Garden]',
        '[00:00.35]……',
        '[00:04.20]雨落在窗沿上。',
        '[00:09.80]把耳机戴好，慢慢呼吸。',
        '[00:16.40]现在，只需要听着雨声。'
      ].join('\r\n');
      return {
        sourcePath,
        sourceEncoding: 'UTF-8',
        cueCount: 4,
        durationMs: 21400,
        lrc:
          (settings.subtitle.includeMetadata ? '[ti:雨夜书房]\r\n[ar:Whisper Garden]\r\n' : '') +
          '[00:00.35]……\r\n[00:04.20]雨落在窗沿上。\r\n[00:09.80]把耳机戴好，慢慢呼吸。\r\n[00:16.40]现在，只需要听着雨声。',
        lrcBytes: lrc.length,
        warnings: []
      };
    },
    async getSettings(): Promise<Settings> {
      await delay(120, 240);
      return cloneSettings(mockSettings);
    },
    async saveSettings(settings: Settings): Promise<Settings> {
      await delay(100, 200);
      mockSettings = cloneSettings(settings);
      return cloneSettings(mockSettings);
    },
    async getFfmpegInfo(refresh?: boolean): Promise<FfmpegInfo> {
      await delay(150, 320);
      return {
        ...MOCK_FFMPEG,
        available: Boolean(mockSettings.general.ffmpegPath || MOCK_FFMPEG.path),
        checkedAt: Date.now(),
        path: mockSettings.general.ffmpegPath || MOCK_FFMPEG.path
      };
    },
    async log(entry: RendererLogEntry): Promise<void> {
      if (typeof console !== 'undefined') console.debug('[sotto:log]', entry.level, entry.message);
    },
    async exportLogs(): Promise<string | null> {
      await delay(140, 240);
      return 'C:\\Users\\Mika\\Downloads\\Sotto-diagnostics-demo.log';
    },
    async exportSettings(): Promise<string | null> {
      await delay(120, 220);
      return 'C:\\Users\\Mika\\Downloads\\Sotto-settings-demo.json';
    },
    async importSettings(): Promise<Settings | null> {
      await delay(120, 220);
      return cloneSettings(mockSettings);
    },
    async checkForUpdates(): Promise<UpdateInfo | null> {
      await delay(120, 200);
      return null;
    },
    async downloadUpdate(): Promise<string> {
      await delay(80, 120);
      return 'C:\\Users\\Mika\\AppData\\Roaming\\Sotto\\updates\\Sotto-Setup-demo.exe';
    },
    async installUpdate(): Promise<void> {
      await delay(80, 120);
    },
    windowMinimize(): void {
      /* browser preview */
    },
    windowToggleMaximize(): void {
      /* browser preview */
    },
    windowClose(): void {
      /* browser preview */
    },
    async isWindowMaximized(): Promise<boolean> {
      return false;
    },
    getPathForFile(): string {
      return DEMO_ROOT;
    },
    onProgress(listener: (event: ProgressEvent) => void): () => void {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
      };
    },
    onWindowMaximized(): () => void {
      return () => undefined;
    },
    onUpdateProgress(listener: (progress: UpdateProgress) => void): () => void {
      void listener;
      return () => undefined;
    }
  };
}

function computeApplyStats(plan: PlanResult, selection: ApplySelection): ApplyStats {
  let renamed = 0;
  let subtitlesConverted = 0;
  let audioConverted = 0;
  let covers = 0;
  for (const folder of plan.folders) {
    if (selection.applyCovers && folder.cover && folder.cover.action !== 'none') covers += 1;
    for (const pair of folder.pairs) {
      if (selection.renameAudio && pair.audioRenameNeeded) renamed += 1;
      if (
        selection.renameSubtitle &&
        pair.subtitle &&
        pair.subtitleRenameName &&
        pair.subtitleRenameName !== pair.subtitle.name
      ) {
        renamed += 1;
      }
      if (selection.convertSubtitles && pair.subtitleConvert) subtitlesConverted += 1;
      if (selection.convertAudio && pair.audioConversion && !pair.audioConversion.skipReason) audioConverted += 1;
    }
  }
  return {
    renamed,
    subtitlesConverted,
    audioConverted,
    covers,
    failed: 0,
    skipped: 0,
    bytesBefore: plan.summary.renamedBytes,
    bytesAfter: Math.round(plan.summary.renamedBytes * 0.46)
  };
}

export function demoCoverChoices(scan: ScanResult, settings: Settings): CoverChoice[] {
  const choices: CoverChoice[] = [];
  for (const folder of scan.folders) {
    const image = folder.files.find((file) => file.kind === 'image');
    if (image) {
      choices.push({
        folder: folder.path,
        imagePath: image.path,
        convertToJpeg: settings.cover.convertToJpeg
      });
    }
  }
  return choices;
}