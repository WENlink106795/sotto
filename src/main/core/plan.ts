import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  TEXT_EXTENSIONS,
  cloneSettings
} from '@shared/defaults';
import {
  matchKeyWithoutBrackets,
  normalizeForMatch,
  sanitizeBaseName
} from '@shared/naming';
import type { RemovedChar } from '@shared/naming';
import type {
  AudioConversionPlan,
  CoverChoice,
  CoverPlan,
  FileInfo,
  FileKind,
  FfmpegInfo,
  FolderPlan,
  MatchKind,
  PairPlan,
  PlanRequest,
  PlanResult,
  PlanSummary,
  PlanWarning,
  ScanFolder,
  Settings
} from '@shared/types';
import { scanLibrary } from './scan';
import { detectSubtitleKind, readSubtitleFile } from './subtitle';
import {
  isPathInside,
  isSameOrDescendantRelative,
  relativeDirectoryDistance,
  toPathKey
} from './util';

const FUZZY_THRESHOLD = 0.78;
const AMBIGUITY_MARGIN = 0.02;
const MAX_CROSS_FOLDER_DISTANCE = 2;
const MAX_COVER_CANDIDATES = 200;

const AUDIO_EXTENSION_SET = new Set(AUDIO_EXTENSIONS.map((value) => value.toLowerCase()));
const SUBTITLE_EXTENSION_SET = new Set(SUBTITLE_EXTENSIONS.map((value) => value.toLowerCase()));
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS.map((value) => value.toLowerCase()));
const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS.map((value) => value.toLowerCase()));

interface RawPair {
  audio: FileInfo;
  subtitle: FileInfo | null;
  match: MatchKind;
  score: number;
  warnings: PlanWarning[];
}

interface FolderContext {
  folder: ScanFolder;
  audios: FileInfo[];
  subtitles: FileInfo[];
  images: FileInfo[];
  texts: FileInfo[];
  ignoredTexts: FileInfo[];
  pairs: RawPair[];
  usedSubtitles: Set<string>;
  orphanAudios: FileInfo[];
  orphanSubtitles: FileInfo[];
  warnings: PlanWarning[];
  reservedNames: Set<string>;
  nameIndex: Map<string, FileInfo>;
}

interface PreparedCover {
  context: FolderContext;
  image: FileInfo;
  convertToJpeg: boolean | undefined;
}

interface SubtitleCandidate {
  file: FileInfo;
  kind: MatchKind;
  score: number;
  weighted: number;
}

interface PairTargets {
  targetBase: string;
  audioName: string;
  audioRenameNeeded: boolean;
  audioConversion: AudioConversionPlan | null;
  subtitleConvert: boolean;
  subtitleOutputName: string | null;
  subtitleRenameName: string | null;
  existingLrc: FileInfo | null;
  lrcWillOverwrite: boolean;
  subtitleDeleteSource: boolean;
  conversionSkipReason: string | null;
}

const MEDIA_SUFFIX = /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff|aif|ape|alac|wv)$/i;

/** Subtitle files are often named "track.mp3.vtt"; compare against the audio base without the media suffix. */
function stripMediaSuffix(base: string): string {
  return base.replace(MEDIA_SUFFIX, '');
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
}

function baseNameOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

function kindOfExtension(extension: string): FileKind | null {
  if (AUDIO_EXTENSION_SET.has(extension)) return 'audio';
  if (SUBTITLE_EXTENSION_SET.has(extension)) return 'subtitle';
  if (IMAGE_EXTENSION_SET.has(extension)) return 'image';
  if (TEXT_EXTENSION_SET.has(extension)) return 'text';
  return null;
}

function rankOf(kind: MatchKind): number {
  switch (kind) {
    case 'manual':
      return 4;
    case 'exact':
      return 3;
    case 'normalized':
      return 2;
    case 'fuzzy':
      return 1;
    default:
      return 0;
  }
}

function leadingNumber(base: string): string | null {
  // Only track-number prefixes count (optionally wrapped in one bracket), so a
  // number in the middle of a title cannot veto an otherwise valid fuzzy match.
  const match = /^\s*(?:[\[【(（][^\]】)）]{0,16}[\]】)）]\s*)?(\d{1,4})/.exec(base);
  if (!match) return null;
  return String(Number.parseInt(match[1], 10));
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2);
    pairs.set(gram, (pairs.get(gram) || 0) + 1);
  }
  let matches = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2);
    const count = pairs.get(gram) || 0;
    if (count > 0) {
      matches += 1;
      pairs.set(gram, count - 1);
    }
  }
  return (2 * matches) / (left.length - 1 + (right.length - 1));
}

function levenshteinDistance(left: string, right: string): number {
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  if (leftChars.length === 0) return rightChars.length;
  if (rightChars.length === 0) return leftChars.length;
  let previous = new Array<number>(rightChars.length + 1);
  for (let index = 0; index <= rightChars.length; index += 1) previous[index] = index;
  for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
    const current = new Array<number>(rightChars.length + 1);
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
      const cost = leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    previous = current;
  }
  return previous[rightChars.length];
}

function combinedSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const dice = diceCoefficient(left, right);
  const maxLength = Math.max(Array.from(left).length, Array.from(right).length);
  const ratio = 1 - levenshteinDistance(left, right) / maxLength;
  return Math.max(dice, ratio);
}

interface MatchResult {
  kind: 'exact' | 'normalized' | 'fuzzy';
  score: number;
}

/** Classifies how a subtitle base name relates to an audio base name. */
function classifyMatch(audioBase: string, subtitleBase: string): MatchResult | null {
  const audioTrimmed = audioBase.trim();
  const subtitleTrimmed = stripMediaSuffix(subtitleBase.trim());
  if (!audioTrimmed || !subtitleTrimmed) return null;
  if (audioTrimmed.toLowerCase() === subtitleTrimmed.toLowerCase()) {
    return { kind: 'exact', score: 1 };
  }
  const audioNormalized = normalizeForMatch(audioTrimmed);
  const subtitleNormalized = normalizeForMatch(subtitleTrimmed);
  if (audioNormalized.length > 0 && audioNormalized === subtitleNormalized) {
    return { kind: 'normalized', score: 0.96 };
  }
  const audioKey = matchKeyWithoutBrackets(audioTrimmed);
  const subtitleKey = matchKeyWithoutBrackets(subtitleTrimmed);
  if (audioKey.length > 0 && audioKey === subtitleKey) {
    return { kind: 'normalized', score: 0.92 };
  }
  if (audioNormalized.length < 2 || subtitleNormalized.length < 2) return null;
  const audioNumber = leadingNumber(audioBase);
  const subtitleNumber = leadingNumber(subtitleTrimmed);
  if (audioNumber && subtitleNumber && audioNumber !== subtitleNumber) return null;
  const audioFuzzy = audioKey.length > 0 ? audioKey : audioNormalized;
  const subtitleFuzzy = subtitleKey.length > 0 ? subtitleKey : subtitleNormalized;
  const similarity = combinedSimilarity(audioFuzzy, subtitleFuzzy);
  if (similarity >= FUZZY_THRESHOLD) return { kind: 'fuzzy', score: similarity };
  const shorter = Math.min(audioFuzzy.length, subtitleFuzzy.length);
  const longer = Math.max(audioFuzzy.length, subtitleFuzzy.length);
  if (
    shorter >= 2 &&
    longer > 0 &&
    (audioFuzzy.includes(subtitleFuzzy) || subtitleFuzzy.includes(audioFuzzy)) &&
    shorter / longer >= 0.5
  ) {
    return { kind: 'fuzzy', score: Math.max(0.8, shorter / longer) };
  }
  return null;
}

function selectBestSubtitle(
  audio: FileInfo,
  candidates: FileInfo[]
): { best: SubtitleCandidate; runnerUp: SubtitleCandidate | null; ambiguous: boolean } | null {
  const scored: SubtitleCandidate[] = [];
  for (const candidate of candidates) {
    const match = classifyMatch(audio.base, candidate.base);
    if (!match) continue;
    const formatBonus =
      candidate.ext === 'lrc' ? 0.15 : candidate.ext === 'vtt' ? 0.08 : candidate.ext === 'srt' ? 0.06 : 0;
    scored.push({
      file: candidate,
      kind: match.kind,
      score: match.score,
      weighted: rankOf(match.kind) + match.score + formatBonus
    });
  }
  if (scored.length === 0) return null;
  scored.sort(
    (left, right) =>
      right.weighted - left.weighted || compareNames(left.file.name, right.file.name)
  );
  const best = scored[0];
  const runnerUp = scored.length > 1 ? scored[1] : null;
  const ambiguous = Boolean(runnerUp && Math.abs(runnerUp.weighted - best.weighted) < AMBIGUITY_MARGIN);
  return { best, runnerUp, ambiguous };
}

function describeRemovedChar(entry: RemovedChar): string {
  // The UI renders one chip per entry, so prefer the literal removed character and
  // fall back to the Unicode label for invisible/control characters.
  const printable =
    entry.char.trim().length > 0 &&
    !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\ufeff]/.test(entry.char);
  return printable ? entry.char : entry.label;
}

function createPairId(audio: FileInfo, subtitle: FileInfo | null): string {
  const seed = toPathKey(audio.path) + '\u0000' + (subtitle ? toPathKey(subtitle.path) : '');
  return crypto.createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 16);
}

function checkPairInvariant(pair: PairPlan): PlanWarning | null {
  const expected = pair.targetBase.toLowerCase();
  const names = [pair.renamedAudioName, pair.subtitleOutputName, pair.subtitleRenameName].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  for (const name of names) {
    if (baseNameOf(name).toLowerCase() !== expected) {
      return {
        code: 'plan-invariant',
        severity: 'error',
        message: '目标文件名与目标基名不一致：' + name
      };
    }
  }
  return null;
}

function computePairTargets(
  base: string,
  raw: RawPair,
  context: FolderContext,
  settings: Settings,
  ffmpeg: FfmpegInfo,
  convertRequested: boolean
): PairTargets {
  // The original audio is always renamed to the shared target base; a conversion is a
  // separate, additional output and never replaces renamedAudioName.
  const audioName = base + '.' + raw.audio.ext;
  const audioRenameNeeded = raw.audio.name !== audioName;
  let audioConversion: AudioConversionPlan | null = null;
  let conversionSkipReason: string | null = null;

  if (convertRequested) {
    const outputName = base + '.' + settings.convert.format;
    let skipReason: string | null = null;
    if (!ffmpeg.available) {
      skipReason = '未检测到可用的 ffmpeg';
    } else if (context.nameIndex.has(outputName.toLowerCase())) {
      skipReason = '目标音频文件已存在';
    }
    audioConversion = {
      sourcePath: raw.audio.path,
      outputPath: path.join(context.folder.path, outputName),
      outputName,
      format: settings.convert.format,
      bitrateKbps: settings.convert.bitrateKbps,
      deleteOriginal: settings.convert.deleteOriginal,
      estimatedBytes: null,
      skipReason
    };
    conversionSkipReason = skipReason;
  }

  let subtitleConvert = false;
  let subtitleOutputName: string | null = null;
  let subtitleRenameName: string | null = null;
  let existingLrc: FileInfo | null = null;
  let lrcWillOverwrite = false;
  let subtitleDeleteSource = false;

  const subtitle = raw.subtitle;
  if (subtitle) {
    const wantsConvert =
      (subtitle.ext === 'vtt' && settings.subtitle.convertVtt) ||
      (subtitle.ext === 'srt' && settings.subtitle.convertSrt) ||
      (subtitle.ext === 'txt' && settings.subtitle.convertTxt);
    if (wantsConvert) {
      subtitleConvert = true;
      subtitleOutputName = base + '.lrc';
      const existing = context.nameIndex.get(subtitleOutputName.toLowerCase());
      if (existing) {
        existingLrc = existing;
        lrcWillOverwrite = true;
      }
      subtitleDeleteSource = settings.subtitle.deleteSource;
    } else if (settings.naming.enabled) {
      const desired = base + '.' + subtitle.ext;
      if (desired !== subtitle.name) subtitleRenameName = desired;
      if (subtitle.ext === 'lrc') existingLrc = subtitle;
    } else if (subtitle.ext === 'lrc') {
      existingLrc = subtitle;
    }
  }

  return {
    targetBase: base,
    audioName,
    audioRenameNeeded,
    audioConversion,
    subtitleConvert,
    subtitleOutputName,
    subtitleRenameName,
    existingLrc,
    lrcWillOverwrite,
    subtitleDeleteSource,
    conversionSkipReason
  };
}

function subtitleInAudioFolder(raw: RawPair, context: FolderContext): boolean {
  if (!raw.subtitle) return false;
  return toPathKey(path.dirname(raw.subtitle.path)) === toPathKey(context.folder.path);
}

function targetFileNames(targets: PairTargets, includeSubtitleRename: boolean): string[] {
  const names: string[] = [targets.audioName];
  if (targets.audioConversion && !targets.audioConversion.skipReason) {
    names.push(targets.audioConversion.outputName);
  }
  if (targets.subtitleConvert && targets.subtitleOutputName) {
    names.push(targets.subtitleOutputName);
  }
  // In-place subtitle renames outside the audio folder are validated separately, so a
  // collision there never changes the shared target base for the whole pair.
  if (targets.subtitleRenameName && includeSubtitleRename) {
    names.push(targets.subtitleRenameName);
  }
  return names;
}

function hasTargetCollision(
  targets: PairTargets,
  raw: RawPair,
  context: FolderContext,
  claimedSubtitles: Set<string>
): boolean {
  const seen = new Set<string>();
  for (const name of targetFileNames(targets, subtitleInAudioFolder(raw, context))) {
    const key = name.toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    if (context.reservedNames.has(key)) return true;
    const existing = context.nameIndex.get(key);
    if (!existing) continue;
    if (toPathKey(existing.path) === toPathKey(raw.audio.path)) continue;
    if (raw.subtitle && toPathKey(existing.path) === toPathKey(raw.subtitle.path)) continue;
    if (
      targets.subtitleConvert &&
      targets.existingLrc &&
      toPathKey(existing.path) === toPathKey(targets.existingLrc.path) &&
      !claimedSubtitles.has(toPathKey(existing.path))
    ) {
      continue;
    }
    return true;
  }
  return false;
}

interface InPlaceRenameDecision {
  name: string | null;
  warning: PlanWarning | null;
  reserveContext: FolderContext | null;
}

/**
 * Validates the target name of a subtitle that is renamed inside its own directory
 * (the kept source of a conversion, or a cross-folder rename). Collisions never
 * change the shared target base: the rename is skipped with a warning instead.
 */
function resolveInPlaceSubtitleRename(
  resolved: PairTargets,
  raw: RawPair,
  context: FolderContext,
  contexts: Map<string, FolderContext>,
  claimedSubtitles: Set<string>
): InPlaceRenameDecision {
  const subtitle = raw.subtitle;
  if (!subtitle) return { name: null, warning: null, reserveContext: null };
  const sourceDirectory = path.dirname(subtitle.path);
  const inAudioFolder = toPathKey(sourceDirectory) === toPathKey(context.folder.path);

  let desired: string | null = null;
  if (resolved.subtitleConvert) {
    if (resolved.subtitleDeleteSource) {
      return { name: null, warning: null, reserveContext: null };
    }
    desired = resolved.targetBase + '.' + subtitle.ext;
  } else if (resolved.subtitleRenameName && !inAudioFolder) {
    desired = resolved.subtitleRenameName;
  } else {
    // Same-folder non-convert renames go through the normal collision/suffix logic.
    return { name: resolved.subtitleRenameName, warning: null, reserveContext: null };
  }

  if (!desired || desired === subtitle.name) {
    return { name: null, warning: null, reserveContext: null };
  }

  const sourceContext = contexts.get(toPathKey(sourceDirectory));
  const desiredKey = desired.toLowerCase();
  const ownKey = toPathKey(subtitle.path);
  const desiredPathKey = toPathKey(path.join(sourceDirectory, desired));
  const existing = sourceContext ? sourceContext.nameIndex.get(desiredKey) : null;
  const conflictExisting = Boolean(existing && toPathKey(existing.path) !== ownKey);
  const conflictReserved = Boolean(sourceContext && sourceContext.reservedNames.has(desiredKey));
  const conflictClaimed = claimedSubtitles.has(desiredPathKey) && desiredPathKey !== ownKey;
  if (!sourceContext || conflictExisting || conflictReserved || conflictClaimed) {
    return {
      name: null,
      warning: {
        code: 'source-rename-skipped',
        severity: 'warning',
        message:
          '无法就地重命名字幕「' +
          subtitle.name +
          '」为「' +
          desired +
          '」（同目录目标已存在或被占用），已保留原文件名并继续生成 LRC'
      },
      reserveContext: null
    };
  }

  return { name: desired, warning: null, reserveContext: sourceContext };
}

function buildPairPlan(
  raw: RawPair,
  context: FolderContext,
  settings: Settings,
  ffmpeg: FfmpegInfo,
  claimedSubtitles: Set<string>,
  contexts: Map<string, FolderContext>
): PairPlan {
  const pairWarnings: PlanWarning[] = [...raw.warnings];
  const naming = settings.naming;
  const sanitized = naming.enabled ? sanitizeBaseName(raw.audio.base, naming) : null;
  const baseSeed = sanitized ? sanitized.value : raw.audio.base;
  const removedChars = sanitized ? sanitized.removed.map(describeRemovedChar) : [];
  if (sanitized) {
    if (sanitized.fallback) {
      pairWarnings.push({
        code: 'naming-fallback',
        severity: 'warning',
        message: '文件名规范化后为空，已回退为 untitled'
      });
    }
    if (sanitized.truncated) {
      pairWarnings.push({
        code: 'naming-truncated',
        severity: 'info',
        message: '文件名超过长度限制，已截断'
      });
    }
  }

  const convertRequested =
    settings.convert.enabled &&
    raw.audio.ext !== settings.convert.format &&
    settings.convert.formats.map((value) => value.toLowerCase()).includes(raw.audio.ext);

  let resolved: PairTargets | null = null;
  let attempt = 1;
  while (attempt < 1000) {
    const base = attempt === 1 ? baseSeed : baseSeed + ' (' + attempt + ')';
    const candidate = computePairTargets(base, raw, context, settings, ffmpeg, convertRequested);
    if (!hasTargetCollision(candidate, raw, context, claimedSubtitles)) {
      resolved = candidate;
      break;
    }
    attempt += 1;
  }
  if (!resolved) {
    resolved = computePairTargets(
      baseSeed + ' (' + crypto.randomUUID().slice(0, 6) + ')',
      raw,
      context,
      settings,
      ffmpeg,
      convertRequested
    );
    pairWarnings.push({
      code: 'target-collision',
      severity: 'warning',
      message: '目标文件名冲突，已使用唯一后缀避免覆盖'
    });
  } else if (attempt > 1) {
    pairWarnings.push({
      code: 'target-collision',
      severity: 'info',
      message: '目标文件名已存在，已使用后缀「(' + attempt + ')」避免覆盖'
    });
  }

  if (convertRequested && resolved.conversionSkipReason) {
    if (resolved.conversionSkipReason === '未检测到可用的 ffmpeg') {
      pairWarnings.push({
        code: 'ffmpeg-missing',
        severity: 'warning',
        message: '已启用音频转换，但未检测到可用的 ffmpeg，已跳过转换'
      });
    } else {
      pairWarnings.push({
        code: 'convert-skipped',
        severity: 'info',
        message: resolved.conversionSkipReason + '，已跳过音频转换'
      });
    }
  }
  if (resolved.lrcWillOverwrite) {
    pairWarnings.push({
      code: 'lrc-overwrite',
      severity: 'info',
      message: '将覆盖已存在的 LRC 文件，应用前会先备份'
    });
  }

  const inPlaceRename = resolveInPlaceSubtitleRename(
    resolved,
    raw,
    context,
    contexts,
    claimedSubtitles
  );
  if (inPlaceRename.warning) pairWarnings.push(inPlaceRename.warning);
  if (inPlaceRename.name && inPlaceRename.reserveContext) {
    inPlaceRename.reserveContext.reservedNames.add(inPlaceRename.name.toLowerCase());
  }

  for (const name of targetFileNames(resolved, subtitleInAudioFolder(raw, context))) {
    context.reservedNames.add(name.toLowerCase());
  }

  const pair: PairPlan = {
    id: createPairId(raw.audio, raw.subtitle),
    folder: context.folder.path,
    audio: raw.audio,
    subtitle: raw.subtitle,
    match: raw.match,
    score: Number(raw.score.toFixed(4)),
    targetBase: resolved.targetBase,
    renamedAudioName: resolved.audioName,
    audioRenameNeeded: resolved.audioRenameNeeded,
    subtitleSourceName: raw.subtitle ? raw.subtitle.name : null,
    subtitleConvert: resolved.subtitleConvert,
    subtitleDeleteSource: resolved.subtitleDeleteSource,
    subtitleOutputName: resolved.subtitleOutputName,
    subtitleRenameName: inPlaceRename.name,
    existingLrc: resolved.existingLrc,
    lrcWillOverwrite: resolved.lrcWillOverwrite,
    audioConversion: resolved.audioConversion,
    removedChars,
    warnings: pairWarnings
  };

  const invariant = checkPairInvariant(pair);
  if (invariant) pairWarnings.push(invariant);
  return pair;
}

function collectCoverCandidates(context: FolderContext, all: FolderContext[]): FileInfo[] {
  const files: FileInfo[] = [];
  for (const other of all) {
    if (!isSameOrDescendantRelative(context.folder.relativePath, other.folder.relativePath)) {
      continue;
    }
    for (const image of other.images) files.push(image);
  }
  files.sort(
    (left, right) =>
      compareNames(path.dirname(left.path), path.dirname(right.path)) ||
      compareNames(left.name, right.name)
  );
  return files.slice(0, MAX_COVER_CANDIDATES);
}

function pickAutoCover(
  candidates: FileInfo[],
  folderPath: string,
  coverName: string
): FileInfo | null {
  if (candidates.length === 0) return null;
  const targetBase = coverName.toLowerCase();
  const named = candidates.filter((image) =>
    /^(cover|folder|front|album|jacket|封面|ジャケット|表紙)/i.test(image.base)
  );
  const direct = candidates.filter(
    (image) => path.dirname(image.path).toLowerCase() === folderPath.toLowerCase()
  );
  if (named.length === 0 && candidates.length > 1 && direct.length !== 1) {
    // Many unrelated scene/CG images: do not guess.
    return null;
  }
  const pool = named.length > 0 ? named : direct.length === 1 ? direct : candidates;
  const scored = pool.map((image) => {
    const base = image.base.toLowerCase();
    let score = 0;
    if (base === targetBase || base.startsWith(targetBase)) score += 200;
    if (/^(cover|folder|front|album|jacket|封面|ジャケット|表紙)/i.test(base)) score += 100;
    if (path.dirname(image.path).toLowerCase() === folderPath.toLowerCase()) score += 20;
    if (image.ext === 'jpg' || image.ext === 'jpeg') score += 10;
    score += Math.min(9, image.size / (1024 * 1024));
    return { image, score };
  });
  scored.sort((left, right) => right.score - left.score || compareNames(left.image.name, right.image.name));
  return scored[0]?.image || null;
}

function buildCoverPlan(
  prepared: PreparedCover,
  settings: Settings,
  ffmpeg: FfmpegInfo
): CoverPlan {
  const context = prepared.context;
  const image = prepared.image;
  const warnings: PlanWarning[] = [];
  const coverName = (settings.cover.name || 'cover').replace(/[\\/:*?"<>|]/g, '').trim() || 'cover';
  const wantsJpeg =
    prepared.convertToJpeg === undefined ? settings.cover.convertToJpeg : prepared.convertToJpeg;
  const isJpeg = image.ext === 'jpg' || image.ext === 'jpeg';
  const convert = wantsJpeg && !isJpeg;
  const extension = convert ? 'jpg' : image.ext;
  const targetName = coverName + '.' + extension;
  const sameName = image.name.toLowerCase() === targetName.toLowerCase();
  const action: CoverPlan['action'] = convert ? 'convert' : sameName ? 'none' : 'move';
  const targetPath = action === 'none' ? image.path : path.join(context.folder.path, targetName);
  const existingTarget =
    action === 'none' ? null : context.nameIndex.get(targetName.toLowerCase()) || null;

  if (convert && !ffmpeg.available) {
    warnings.push({
      code: 'ffmpeg-missing',
      severity: 'error',
      message: '转换封面为 JPEG 需要 ffmpeg，当前不可用'
    });
  }
  if (existingTarget && existingTarget.path !== image.path) {
    if (settings.cover.overwrite) {
      warnings.push({
        code: 'cover-overwrite',
        severity: 'info',
        message: '将备份并覆盖已有封面「' + existingTarget.name + '」'
      });
    } else {
      warnings.push({
        code: 'cover-exists',
        severity: 'warning',
        message: '封面目标已存在，应用时将跳过：「' + existingTarget.name + '」'
      });
    }
  }
  if (context.reservedNames.has(targetName.toLowerCase())) {
    warnings.push({
      code: 'cover-collision',
      severity: 'warning',
      message: '封面文件名与已规划的目标文件重名，应用时可能跳过'
    });
  }

  return {
    folder: context.folder.path,
    image,
    targetName: action === 'none' ? image.name : targetName,
    targetPath,
    action,
    existingTarget,
    overwrite: settings.cover.overwrite,
    warnings
  };
}

/**
 * Builds a dry-run plan: scans the root, matches audio/subtitle pairs, sanitizes
 * target names and resolves collisions. Performs no writes or conversions.
 */
export async function buildPlan(request: PlanRequest, ffmpeg: FfmpegInfo): Promise<PlanResult> {
  const settings = request.settings;
  const resolvedRoot = path.resolve(request.root);
  const scan = await scanLibrary(resolvedRoot);

  const contexts = new Map<string, FolderContext>();
  const orderedContexts: FolderContext[] = [];
  const fileIndex = new Map<string, FileInfo>();
  const looseWarnings: PlanWarning[] = [];
  const attachedWarnings: PlanWarning[] = [];

  const createContext = (directory: string, relativePath: string, name: string): FolderContext => {
    const folder: ScanFolder = { path: directory, name, relativePath, files: [] };
    const context: FolderContext = {
      folder,
      audios: [],
      subtitles: [],
      images: [],
      texts: [],
      ignoredTexts: [],
      pairs: [],
      usedSubtitles: new Set<string>(),
      orphanAudios: [],
      orphanSubtitles: [],
      warnings: [],
      reservedNames: new Set<string>(),
      nameIndex: new Map<string, FileInfo>()
    };
    contexts.set(toPathKey(directory), context);
    orderedContexts.push(context);
    return context;
  };

  for (const folder of scan.folders) {
    const context = createContext(folder.path, folder.relativePath, folder.name);
    for (const file of folder.files) {
      fileIndex.set(toPathKey(file.path), file);
      context.nameIndex.set(file.name.toLowerCase(), file);
      if (file.kind === 'audio') context.audios.push(file);
      else if (file.kind === 'subtitle') context.subtitles.push(file);
      else if (file.kind === 'text') context.texts.push(file);
      else context.images.push(file);
    }
  }

  for (const context of orderedContexts) {
    if (context.texts.length === 0) continue;
    for (const textFile of context.texts) {
      if (!settings.subtitle.convertTxt || textFile.size > 4 * 1024 * 1024) {
        context.ignoredTexts.push(textFile);
        continue;
      }
      try {
        const decoded = await readSubtitleFile(textFile.path);
        if (!detectSubtitleKind(decoded.text)) {
          context.ignoredTexts.push(textFile);
          continue;
        }
      } catch {
        context.ignoredTexts.push(textFile);
        continue;
      }
      context.subtitles.push(textFile);
    }
    if (context.ignoredTexts.length > 0) {
      context.warnings.push({
        code: 'txt-not-lyrics',
        severity: 'info',
        message: '跳过 ' + context.ignoredTexts.length + ' 个 txt 文件：未检测到带时间轴的歌词内容'
      });
    }
  }

  const ensureContext = (filePath: string): FolderContext => {
    const directory = path.resolve(path.dirname(filePath));
    const existing = contexts.get(toPathKey(directory));
    if (existing) return existing;
    const absolute = path.resolve(filePath);
    let relative = path.relative(resolvedRoot, directory);
    if (relative.startsWith('..' + path.sep) || relative === '..') relative = directory;
    return createContext(
      directory,
      relative,
      path.basename(directory) || path.basename(resolvedRoot)
    );
  };

  const ensureFileInfo = async (targetPath: string): Promise<FileInfo | null> => {
    const absolute = path.resolve(targetPath);
    const known = fileIndex.get(toPathKey(absolute));
    if (known) return known;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) return null;
      const name = path.basename(absolute);
      const extension = extensionOf(name);
      const kind = kindOfExtension(extension);
      if (!kind) return null;
      const info: FileInfo = {
        path: absolute,
        name,
        base: baseNameOf(name),
        ext: extension,
        kind,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      };
      fileIndex.set(toPathKey(absolute), info);
      const context = ensureContext(absolute);
      context.nameIndex.set(name.toLowerCase(), info);
      if (kind === 'audio') context.audios.push(info);
      else if (kind === 'subtitle') context.subtitles.push(info);
      else if (kind === 'text') context.texts.push(info);
      else context.images.push(info);
      return info;
    } catch {
      return null;
    }
  };

  const manualPairs = Array.isArray(request.manualPairs) ? request.manualPairs : [];
  const manualByAudio = new Map<string, RawPair>();
  const manualSubtitleOwners = new Map<string, string>();

  for (const manual of manualPairs) {
    if (!manual || typeof manual.audioPath !== 'string' || typeof manual.subtitlePath !== 'string') {
      continue;
    }
    const audio = await ensureFileInfo(manual.audioPath);
    if (!audio || audio.kind !== 'audio') {
      attachedWarnings.push({
        code: 'manual-audio-missing',
        severity: 'warning',
        message: '手动配对中的音频不存在：' + manual.audioPath
      });
      continue;
    }
    const subtitle = await ensureFileInfo(manual.subtitlePath);
    if (!subtitle || subtitle.kind !== 'subtitle') {
      attachedWarnings.push({
        code: 'manual-subtitle-missing',
        severity: 'warning',
        message: '手动配对中的字幕不存在：' + manual.subtitlePath
      });
      continue;
    }
    const audioKey = toPathKey(audio.path);
    const subtitleKey = toPathKey(subtitle.path);
    const owner = manualSubtitleOwners.get(subtitleKey);
    if (owner && owner !== audioKey) {
      attachedWarnings.push({
        code: 'manual-duplicate',
        severity: 'warning',
        message: '字幕「' + subtitle.name + '」只能手动配对给一个音频，已忽略重复配对'
      });
      continue;
    }
    if (manualByAudio.has(audioKey)) {
      attachedWarnings.push({
        code: 'manual-duplicate',
        severity: 'warning',
        message: '音频「' + audio.name + '」存在多个手动配对，已采用最后一次'
      });
    }
    manualSubtitleOwners.set(subtitleKey, audioKey);
    const warnings: PlanWarning[] = [];
    const audioContext = ensureContext(audio.path);
    const subtitleContext = ensureContext(subtitle.path);
    if (audioContext !== subtitleContext) {
      warnings.push({
        code: 'match-cross-folder',
        severity: 'info',
        message: '手动配对的字幕位于其他文件夹：' + subtitleContext.folder.relativePath
      });
    }
    manualByAudio.set(audioKey, {
      audio,
      subtitle,
      match: 'manual',
      score: 1,
      warnings
    });
  }

  for (const pair of manualByAudio.values()) {
    const audioContext = ensureContext(pair.audio.path);
    audioContext.pairs.push(pair);
    if (pair.subtitle) {
      const subtitleContext = ensureContext(pair.subtitle.path);
      subtitleContext.usedSubtitles.add(toPathKey(pair.subtitle.path));
    }
  }

  for (const context of orderedContexts) {
    context.audios.sort((left, right) => compareNames(left.name, right.name));
    context.subtitles.sort((left, right) => compareNames(left.name, right.name));
    context.images.sort((left, right) => compareNames(left.name, right.name));
  }

  const matchedAudios = new Set<string>();
  for (const pair of manualByAudio.values()) matchedAudios.add(toPathKey(pair.audio.path));

  // Pass 1: same-folder name matching.
  for (const context of orderedContexts) {
    for (const audio of context.audios) {
      const audioKey = toPathKey(audio.path);
      if (matchedAudios.has(audioKey)) continue;
      const candidates = context.subtitles.filter(
        (subtitle) => !context.usedSubtitles.has(toPathKey(subtitle.path))
      );
      const selection = selectBestSubtitle(audio, candidates);
      if (!selection) continue;
      const warnings: PlanWarning[] = [];
      if (selection.ambiguous) {
        warnings.push({
          code: 'match-ambiguous',
          severity: 'warning',
          message:
            '存在多个相似字幕，已选择「' +
            selection.best.file.name +
            '」' +
            (selection.runnerUp ? '（候选：' + selection.runnerUp.file.name + '）' : '')
        });
      }
      context.usedSubtitles.add(toPathKey(selection.best.file.path));
      matchedAudios.add(audioKey);
      context.pairs.push({
        audio,
        subtitle: selection.best.file,
        match: selection.best.kind,
        score: selection.best.score,
        warnings
      });
    }
  }

  // Pass 2: cross-folder matching inside a close subtree (parent/child/sibling).
  for (const context of orderedContexts) {
    for (const audio of context.audios) {
      const audioKey = toPathKey(audio.path);
      if (matchedAudios.has(audioKey)) continue;
      const candidates: (SubtitleCandidate & { distance: number; owner: FolderContext })[] = [];
      for (const other of orderedContexts) {
        if (other === context) continue;
        const distance = relativeDirectoryDistance(
          context.folder.relativePath,
          other.folder.relativePath
        );
        if (distance < 1 || distance > MAX_CROSS_FOLDER_DISTANCE) continue;
        for (const subtitle of other.subtitles) {
          if (other.usedSubtitles.has(toPathKey(subtitle.path))) continue;
          const match = classifyMatch(audio.base, subtitle.base);
          if (!match) continue;
          const lrcBonus = subtitle.ext === 'lrc' ? 0.05 : 0;
          candidates.push({
            file: subtitle,
            kind: match.kind,
            score: match.score,
            weighted: rankOf(match.kind) + match.score + lrcBonus - distance * 0.01,
            distance,
            owner: other
          });
        }
      }
      if (candidates.length === 0) continue;
      candidates.sort(
        (left, right) =>
          right.weighted - left.weighted || compareNames(left.file.name, right.file.name)
      );
      const best = candidates[0];
      const runnerUp = candidates.length > 1 ? candidates[1] : null;
      const warnings: PlanWarning[] = [
        {
          code: 'match-cross-folder',
          severity: 'info',
          message:
            '字幕来自相近文件夹：' +
            (best.owner.folder.relativePath || best.owner.folder.name) +
            '（匹配方式：' +
            best.kind +
            '）'
        }
      ];
      if (runnerUp && Math.abs(runnerUp.weighted - best.weighted) < AMBIGUITY_MARGIN) {
        warnings.push({
          code: 'match-ambiguous',
          severity: 'warning',
          message: '存在多个相近的跨文件夹字幕，已选择「' + best.file.name + '」'
        });
      }
      best.owner.usedSubtitles.add(toPathKey(best.file.path));
      matchedAudios.add(audioKey);
      context.pairs.push({
        audio,
        subtitle: best.file,
        match: best.kind,
        score: best.score,
        warnings
      });
    }
  }

  // Pass 3: single-audio/single-subtitle fallback per folder.
  for (const context of orderedContexts) {
    const remainingAudios = context.audios.filter((audio) => !matchedAudios.has(toPathKey(audio.path)));
    const remainingSubtitles = context.subtitles.filter(
      (subtitle) => !context.usedSubtitles.has(toPathKey(subtitle.path))
    );
    if (remainingAudios.length === 1 && remainingSubtitles.length === 1) {
      const audio = remainingAudios[0];
      const subtitle = remainingSubtitles[0];
      context.usedSubtitles.add(toPathKey(subtitle.path));
      matchedAudios.add(toPathKey(audio.path));
      context.pairs.push({
        audio,
        subtitle,
        match: 'single',
        score: 0.5,
        warnings: [
          {
            code: 'match-single',
            severity: 'info',
            message: '同文件夹内仅有一个音频和一个字幕，已自动配对'
          }
        ]
      });
    } else if (remainingAudios.length > 0 && remainingSubtitles.length > 0) {
      context.warnings.push({
        code: 'match-ambiguous',
        severity: 'warning',
        message:
          '文件夹内有 ' +
          remainingAudios.length +
          ' 个音频和 ' +
          remainingSubtitles.length +
          ' 个字幕无法确定对应关系，已保留为未配对'
      });
    }
  }

  // Remaining audio: either audio-only pairs (opt-in) or orphans.
  for (const context of orderedContexts) {
    for (const audio of context.audios) {
      const audioKey = toPathKey(audio.path);
      if (matchedAudios.has(audioKey)) continue;
      if (settings.naming.renameAudioWithoutSubtitle) {
        matchedAudios.add(audioKey);
        context.pairs.push({
          audio,
          subtitle: null,
          match: 'single',
          score: 0,
          warnings: [
            {
              code: 'audio-only',
              severity: 'info',
              message: '未找到匹配字幕，按设置仅处理音频文件名'
            }
          ]
        });
      } else {
        context.orphanAudios.push(audio);
      }
    }
    context.orphanSubtitles = context.subtitles.filter(
      (subtitle) => !context.usedSubtitles.has(toPathKey(subtitle.path))
    );
  }

  // Cover selections are explicit; validate each against the scanned tree.
  const preparedCovers = new Map<string, PreparedCover>();
  const coverChoices = Array.isArray(request.coverChoices) ? request.coverChoices : [];
  for (const choice of coverChoices) {
    if (!choice || typeof choice.folder !== 'string' || typeof choice.imagePath !== 'string') {
      continue;
    }
    const context = contexts.get(toPathKey(choice.folder));
    if (!context) {
      looseWarnings.push({
        code: 'cover-folder-missing',
        severity: 'warning',
        message: '封面所在文件夹不在扫描结果中：' + choice.folder
      });
      continue;
    }
    const image = await ensureFileInfo(choice.imagePath);
    if (!image || image.kind !== 'image') {
      context.warnings.push({
        code: 'cover-invalid',
        severity: 'warning',
        message: '封面文件不存在或不是图片：' + path.basename(choice.imagePath)
      });
      continue;
    }
    if (!isPathInside(context.folder.path, image.path)) {
      context.warnings.push({
        code: 'cover-invalid',
        severity: 'warning',
        message: '封面文件不在所选文件夹内：' + image.name
      });
      continue;
    }
    preparedCovers.set(toPathKey(context.folder.path), {
      context,
      image,
      convertToJpeg: choice.convertToJpeg
    });
  }

  if (settings.cover.enabled && settings.cover.autoPick) {
    for (const context of orderedContexts) {
      if (context.pairs.length === 0) continue;
      if (preparedCovers.has(toPathKey(context.folder.path))) continue;
      const candidates = collectCoverCandidates(context, orderedContexts);
      if (candidates.length === 0) continue;
      const coverName = (settings.cover.name || 'cover').replace(/[\\/:*?"<>|]/g, '').trim() || 'cover';
      const picked = pickAutoCover(candidates, context.folder.path, coverName);
      if (picked) {
        preparedCovers.set(toPathKey(context.folder.path), {
          context,
          image: picked,
          convertToJpeg: undefined
        });
      } else if (candidates.length > 1) {
        context.warnings.push({
          code: 'cover-auto-skipped',
          severity: 'info',
          message: '自动封面已跳过：候选图片较多且没有明显的封面命名，请手动选择'
        });
      }
    }
  }

  const claimedSubtitles = new Set<string>();
  for (const context of orderedContexts) {
    for (const pair of context.pairs) {
      if (pair.subtitle) claimedSubtitles.add(toPathKey(pair.subtitle.path));
    }
  }

  let folderPlans: FolderPlan[] = [];
  for (const context of orderedContexts) {
    context.pairs.sort((left, right) => compareNames(left.audio.name, right.audio.name));
    const pairs = context.pairs.map((raw) =>
      buildPairPlan(raw, context, settings, ffmpeg, claimedSubtitles, contexts)
    );
    const coverCandidates = collectCoverCandidates(context, orderedContexts);
    let cover: CoverPlan | null = null;
    const preparedCover = preparedCovers.get(toPathKey(context.folder.path));
    if (preparedCover) {
      cover = buildCoverPlan(preparedCover, settings, ffmpeg);
    }
    folderPlans.push({
      folder: context.folder.path,
      folderName: context.folder.name,
      relativePath: context.folder.relativePath,
      pairs,
      orphanAudios: [...context.orphanAudios],
      orphanSubtitles: [...context.orphanSubtitles],
      coverCandidates,
      cover,
      // Cover warnings live on the cover plan; mirror them on the folder so the UI's
      // folder-level warning collection shows them too.
      warnings: [...context.warnings, ...(cover ? cover.warnings : [])]
    });
  }

  folderPlans.sort((left, right) => compareNames(left.relativePath, right.relativePath));
  // Folders that contain nothing actionable (e.g. a subtitle-only folder whose cues were
  // matched cross-folder) are omitted so the UI shows only meaningful rows.
  folderPlans = folderPlans.filter(
    (folder) =>
      folder.pairs.length > 0 ||
      folder.orphanAudios.length > 0 ||
      folder.orphanSubtitles.length > 0 ||
      folder.cover !== null ||
      folder.coverCandidates.length > 0 ||
      folder.warnings.length > 0
  );

  if (scan.truncated) {
    looseWarnings.push({
      code: 'scan-truncated',
      severity: 'warning',
      message: '扫描结果不完整，计划可能遗漏部分文件'
    });
  }
  const extraWarnings = [...attachedWarnings, ...looseWarnings];
  if (extraWarnings.length > 0) {
    if (folderPlans.length > 0) folderPlans[0].warnings.push(...extraWarnings);
    else if (extraWarnings.length > 0) {
      folderPlans.push({
        folder: resolvedRoot,
        folderName: scan.rootName,
        relativePath: '',
        pairs: [],
        orphanAudios: [],
        orphanSubtitles: [],
        coverCandidates: [],
        cover: null,
        warnings: extraWarnings
      });
    }
  }

  const allPairs = folderPlans.flatMap((folder) => folder.pairs);
  const allWarnings = folderPlans.flatMap((folder) => folder.warnings);
  const pairWarningsAll = allPairs.flatMap((pair) => pair.warnings);
  const combinedWarnings = [...allWarnings, ...pairWarningsAll];

  const renamedPaths = new Set<string>();
  let renamedBytes = 0;
  const addRenamedBytes = (file: FileInfo): void => {
    const key = toPathKey(file.path);
    if (renamedPaths.has(key)) return;
    renamedPaths.add(key);
    renamedBytes += file.size;
  };
  for (const pair of allPairs) {
    if (pair.audioRenameNeeded) addRenamedBytes(pair.audio);
    if (pair.subtitle && pair.subtitleRenameName && pair.subtitleRenameName !== pair.subtitle.name) {
      addRenamedBytes(pair.subtitle);
    }
  }

  const summary: PlanSummary = {
    folders: folderPlans.length,
    pairs: allPairs.length,
    renames: allPairs.reduce(
      (total, pair) =>
        total + (pair.audioRenameNeeded ? 1 : 0) + (pair.subtitleRenameName ? 1 : 0),
      0
    ),
    subtitleConversions: allPairs.filter((pair) => pair.subtitleConvert).length,
    audioConversions: allPairs.filter(
      (pair) => pair.audioConversion !== null && pair.audioConversion.skipReason === null
    ).length,
    covers: folderPlans.filter((folder) => folder.cover !== null && folder.cover.action !== 'none')
      .length,
    warnings: combinedWarnings.filter(
      (warning) => warning.severity === 'warning' || warning.severity === 'error'
    ).length,
    errors: combinedWarnings.filter((warning) => warning.severity === 'error').length,
    renamedBytes
  };

  return {
    planId: crypto.randomUUID(),
    root: resolvedRoot,
    rootName: scan.rootName,
    folders: folderPlans,
    summary,
    settingsSnapshot: cloneSettings(settings),
    ffmpeg,
    createdAt: Date.now()
  };
}