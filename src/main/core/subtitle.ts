import { promises as fs } from 'node:fs';
import path from 'node:path';
import { decode as iconvDecode, encode as iconvEncode } from 'iconv-lite';
import type { Settings, SubtitleEncoding, SubtitlePreview } from '@shared/types';
import { writeFileAtomic } from './util';

export interface Cue {
  id: string | null;
  startMs: number;
  endMs: number;
  text: string;
  lines: string[];
}

export interface DecodedSubtitle {
  text: string;
  encoding: string;
  warnings: string[];
}

export interface LrcMetadata {
  title?: string;
  artist?: string;
  album?: string;
  by?: string;
}

export interface LrcOptions {
  includeMetadata: boolean;
  mergeLines: boolean;
  offsetMs: number;
  encoding: SubtitleEncoding;
  metadata?: LrcMetadata;
}

export interface LrcBuildResult {
  lrc: string;
  warnings: string[];
}

export interface ConvertedSubtitle {
  cueCount: number;
  durationMs: number | null;
  warnings: string[];
  sourceEncoding: string;
  bytes: number;
}

const TIMESTAMP_PATTERN = /^(?:(\d{1,4}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™'
};

/** Parses VTT/SRT style timestamps (comma or dot fractions, optional hours). */
export function parseTimestamp(raw: string): number | null {
  const value = (raw || '').trim();
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  const fraction = match[4] ? Number.parseInt(match[4].padEnd(3, '0'), 10) : 0;
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + fraction;
}

function startsWithBytes(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (buffer[index] !== bytes[index]) return false;
  }
  return true;
}

function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function guessBomlessUtf16(buffer: Buffer): 'utf16le' | 'utf16be' | null {
  if (buffer.length < 8 || buffer.length % 2 !== 0) return null;
  const sampleLength = Math.min(buffer.length, 8192);
  const pairCount = Math.floor(sampleLength / 2);
  if (pairCount < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < pairCount * 2; index += 2) {
    if (buffer[index] === 0) evenZeros += 1;
    if (buffer[index + 1] === 0) oddZeros += 1;
  }
  const evenRatio = evenZeros / pairCount;
  const oddRatio = oddZeros / pairCount;
  if (oddRatio > 0.25 && oddRatio > evenRatio * 4) return 'utf16le';
  if (evenRatio > 0.25 && evenRatio > oddRatio * 4) return 'utf16be';
  return null;
}

function tryDecodeUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Decodes subtitle bytes with BOM detection, a BOM-less UTF-16 heuristic,
 * strict UTF-8 validation and a GB18030 fallback.
 */
export function decodeSubtitleBuffer(buffer: Buffer): DecodedSubtitle {
  const warnings: string[] = [];
  if (buffer.length === 0) {
    return { text: '', encoding: 'utf-8', warnings };
  }

  if (startsWithBytes(buffer, [0xef, 0xbb, 0xbf])) {
    return {
      text: stripBomChar(buffer.subarray(3).toString('utf8')),
      encoding: 'utf-8-bom',
      warnings
    };
  }
  if (startsWithBytes(buffer, [0xff, 0xfe])) {
    return {
      text: stripBomChar(iconvDecode(buffer.subarray(2), 'utf16le')),
      encoding: 'utf-16le',
      warnings
    };
  }
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    return {
      text: stripBomChar(iconvDecode(buffer.subarray(2), 'utf16be')),
      encoding: 'utf-16be',
      warnings
    };
  }

  const bomless = guessBomlessUtf16(buffer);
  if (bomless) {
    warnings.push('检测到无 BOM 的 UTF-16 编码，已自动识别');
    return {
      text: stripBomChar(iconvDecode(buffer, bomless)),
      encoding: bomless === 'utf16le' ? 'utf-16le' : 'utf-16be',
      warnings
    };
  }

  const utf8 = tryDecodeUtf8(buffer);
  if (utf8 !== null) {
    return { text: stripBomChar(utf8), encoding: 'utf-8', warnings };
  }

  const gb18030 = stripBomChar(iconvDecode(buffer, 'gb18030'));
  warnings.push('检测到非 UTF-8 编码，已按 GB18030 解码');
  if (gb18030.includes('\uFFFD')) {
    warnings.push('解码过程中出现无法识别的字符，字幕可能包含乱码');
  }
  if (gb18030.includes('\u0000')) {
    warnings.push('解码结果包含空字符，源文件编码可能无法可靠识别');
  }
  return {
    text: gb18030,
    encoding: 'gb18030',
    warnings
  };
}

export type DetectedSubtitleKind = 'vtt' | 'srt' | 'lrc';

/**
 * Content-based detection for ambiguous inputs such as .txt files: some ASMR
 * downloads ship WebVTT/SRT/LRC content with a .txt extension. Plain scripts,
 * readmes and untimed lyrics intentionally return null so they are not treated
 * as subtitles.
 */
export function detectSubtitleKind(text: string): DetectedSubtitleKind | null {
  const normalized = stripBomChar(text).replace(/\r\n?/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) return null;
  const arrowCount = (trimmed.match(/-->/g) || []).length;
  const lrcCount = (trimmed.match(/^\s*\[\d{1,2}:\d{2}(?:[.,:]\d{1,3})?\]/gm) || []).length;
  if (/^WEBVTT(?:\s|$)/im.test(trimmed)) {
    return arrowCount > 0 ? 'vtt' : null;
  }
  if (arrowCount >= 1) {
    const looksSrt = /\d{1,2}:\d{2},\d{1,3}\s*-->/.test(trimmed);
    return looksSrt ? 'srt' : 'vtt';
  }
  if (lrcCount >= 2) return 'lrc';
  return null;
}

export async function readSubtitleFile(filePath: string): Promise<DecodedSubtitle> {
  const buffer = await fs.readFile(filePath);
  return decodeSubtitleBuffer(buffer);
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.charAt(0) === '#') {
      const hexadecimal = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const digits = hexadecimal ? body.slice(2) : body.slice(1);
      const value = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (Number.isFinite(value) && value > 0 && value <= 0x10ffff) {
        try {
          return String.fromCodePoint(value);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return typeof named === 'string' ? named : whole;
  });
}

function cleanCueText(raw: string): string {
  const withBreaks = raw.replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n');
  const withoutKaraoke = withBreaks.replace(/<\d{1,4}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, '');
  const withoutTags = withoutKaraoke.replace(/<[^>]*>/g, '');
  const withoutAss = withoutTags.replace(/\{\\[^}]*\}/g, '');
  return decodeEntities(withoutAss)
    .split('\n')
    .map((line) => line.replace(/\u00A0/g, ' ').replace(/[\t ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

interface ParsedTiming {
  startMs: number;
  endMs: number;
  invalidOrder: boolean;
}

function parseTimingLine(line: string): ParsedTiming | null {
  const parts = line.split('-->');
  if (parts.length < 2) return null;
  const startMs = parseTimestamp(parts[0]);
  if (startMs === null) return null;
  const rest = (parts[1] || '').trim().split(/\s+/)[0] || '';
  let endMs = parseTimestamp(rest);
  if (endMs === null) return null;
  let invalidOrder = false;
  if (endMs < startMs) {
    endMs = startMs;
    invalidOrder = true;
  }
  return { startMs, endMs, invalidOrder };
}

function splitBlocks(text: string): string[][] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.split('\n').filter((line) => line.length > 0))
    .filter((lines) => lines.length > 0);
}

/** Parses WEBVTT or SRT text into cues. Tolerates cue ids, tags, entities and bad timing. */
export function parseCues(text: string, kind: 'vtt' | 'srt'): { cues: Cue[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalized = stripBomChar(text).replace(/\r\n?/g, '\n');
  const blocks = splitBlocks(normalized);
  const cues: Cue[] = [];
  let unparsed = 0;
  let emptyCues = 0;
  let invalidOrder = 0;

  for (const block of blocks) {
    let lines = block;
    let fromHeader = false;
    if (kind === 'vtt') {
      if (/^WEBVTT(?:\s|$)/i.test((lines[0] || '').trim())) {
        // Tolerate a header block that was not separated from its cues by a blank line.
        lines = lines.slice(1).filter((line) => line.trim().length > 0);
        fromHeader = true;
        if (lines.length === 0) continue;
      }
      const header = (lines[0] || '').trim();
      if (/^NOTE(?:\s|$)/i.test(header)) continue;
      if (/^STYLE(?:\s|$)/i.test(header)) continue;
      if (/^REGION(?:\s|$)/i.test(header)) continue;
    } else if (/^WEBVTT(?:\s|$)/i.test((lines[0] || '').trim())) {
      continue;
    }

    const firstLine = (lines[0] || '').trim();
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) {
      if (!fromHeader && firstLine.length > 0) unparsed += 1;
      continue;
    }
    const timing = parseTimingLine(lines[timingIndex] || '');
    if (!timing) {
      unparsed += 1;
      continue;
    }
    if (timing.invalidOrder) invalidOrder += 1;

    const id = timingIndex > 0 ? (lines[0] || '').trim() || null : null;
    const cueText = cleanCueText(lines.slice(timingIndex + 1).join('\n'));
    if (!cueText) {
      emptyCues += 1;
      continue;
    }
    cues.push({
      id,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text: cueText,
      lines: cueText.split('\n')
    });
  }

  let outOfOrder = 0;
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startMs + 1 < cues[index - 1].startMs) outOfOrder += 1;
  }

  cues.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

  let overlaps = 0;
  let previousEnd = -1;
  for (const cue of cues) {
    if (cue.startMs < previousEnd) overlaps += 1;
    previousEnd = Math.max(previousEnd, cue.endMs);
  }

  if (unparsed > 0) warnings.push('忽略 ' + unparsed + ' 个无法解析的字幕块');
  if (emptyCues > 0) warnings.push('忽略 ' + emptyCues + ' 个空白字幕块');
  if (invalidOrder > 0) warnings.push('修正 ' + invalidOrder + ' 处结束时间早于开始时间的字幕');
  if (outOfOrder > 0) warnings.push('检测到 ' + outOfOrder + ' 处乱序字幕，已按开始时间排序');
  if (overlaps > 0) warnings.push('检测到 ' + overlaps + ' 处时间轴重叠');
  if (cues.length === 0 && normalized.trim().length > 0) {
    warnings.push('未解析到有效字幕，请确认文件格式');
  }

  return { cues, warnings };
}

export function formatLrcTimestamp(milliseconds: number): string {
  const totalCentiseconds = Math.max(0, Math.round(milliseconds / 10));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return (
    '[' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    '.' +
    String(centiseconds).padStart(2, '0') +
    ']'
  );
}

function sanitizeMetadataValue(value: string): string {
  return value.replace(/[\r\n\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Converts cues to LRC text with CRLF line endings (LRC only stores start times).
 * mergeLines=true joins a cue's text lines into one entry; false keeps one entry per
 * source line (all sharing the cue timestamp) so no text is silently lost.
 */
export function cuesToLrc(cues: Cue[], options: LrcOptions): LrcBuildResult {
  const warnings: string[] = [];
  const ordered = cues
    .map((cue, index) => ({ cue, index }))
    .sort(
      (left, right) =>
        left.cue.startMs - right.cue.startMs ||
        left.cue.endMs - right.cue.endMs ||
        left.index - right.index
    )
    .map((entry) => entry.cue);

  const lines: string[] = [];
  if (options.includeMetadata) {
    const metadata = options.metadata || {};
    if (metadata.title) lines.push('[ti:' + sanitizeMetadataValue(metadata.title) + ']');
    if (metadata.artist) lines.push('[ar:' + sanitizeMetadataValue(metadata.artist) + ']');
    if (metadata.album) lines.push('[al:' + sanitizeMetadataValue(metadata.album) + ']');
    lines.push('[by:' + sanitizeMetadataValue(metadata.by || 'Sotto') + ']');
  }

  let clamped = 0;
  let empty = 0;
  let entries = 0;
  const offset = Number.isFinite(options.offsetMs) ? options.offsetMs : 0;

  for (const cue of ordered) {
    const shifted = cue.startMs + offset;
    if (shifted < 0) clamped += 1;
    const start = Math.max(0, shifted);
    const displayLines = cue.lines
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0);
    if (displayLines.length === 0) {
      empty += 1;
      continue;
    }
    const groups = options.mergeLines ? [displayLines.join(' ').trim()] : displayLines;
    for (const group of groups) {
      const value = group.replace(/\s+/g, ' ').trim();
      if (!value) continue;
      lines.push(formatLrcTimestamp(start) + value);
      entries += 1;
    }
  }

  if (clamped > 0) {
    warnings.push('有 ' + clamped + ' 条字幕因时间偏移小于 0 被调整为 00:00.00');
  }
  if (empty > 0) warnings.push('忽略 ' + empty + ' 条空白字幕');
  if (entries === 0) warnings.push('没有可输出的字幕内容');

  const lrc = lines.length === 0 ? '' : lines.join('\r\n') + '\r\n';
  return { lrc, warnings };
}

export function encodeSubtitleText(text: string, encoding: SubtitleEncoding): Buffer {
  if (encoding === 'utf-8-bom') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  }
  if (encoding === 'gb18030') {
    return iconvEncode(text, 'gb18030');
  }
  return Buffer.from(text, 'utf8');
}

function toCrlf(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
}

function parseLrc(text: string): { cueCount: number; durationMs: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const lines = stripBomChar(text).replace(/\r\n?/g, '\n').split('\n');
  const tagPattern = /\[(\d{1,4}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  let cueCount = 0;
  let durationMs: number | null = null;
  for (const line of lines) {
    tagPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(line)) !== null) {
      cueCount += 1;
      const minutes = Number.parseInt(match[1], 10);
      const seconds = Number.parseInt(match[2], 10);
      const fraction = match[3] ? Number.parseInt(match[3].padEnd(3, '0'), 10) : 0;
      const ms = minutes * 60000 + seconds * 1000 + fraction;
      durationMs = durationMs === null ? ms : Math.max(durationMs, ms);
    }
  }
  if (cueCount === 0) warnings.push('未找到有效的 LRC 时间标签');
  return { cueCount, durationMs, warnings };
}

function baseTitle(sourcePath: string): string {
  return path.basename(sourcePath, path.extname(sourcePath));
}

/** Builds the LRC preview shown in the UI without touching the filesystem. */
export async function previewSubtitle(
  sourcePath: string,
  settings: Settings
): Promise<SubtitlePreview> {
  const resolved = path.resolve(sourcePath);
  const extension = path.extname(resolved).slice(1).toLowerCase();
  const decoded = await readSubtitleFile(resolved);
  const warnings = [...decoded.warnings];
  const subtitleSettings = settings.subtitle;
  const detectedKind = extension === 'txt' ? detectSubtitleKind(decoded.text) : null;
  const kind =
    extension === 'vtt' || extension === 'srt' || extension === 'lrc' ? extension : detectedKind;
  if (!kind) {
    throw new Error('TXT 文件没有检测到带时间轴的字幕内容');
  }

  let cueCount = 0;
  let durationMs: number | null = null;
  let lrc = '';

  if (kind === 'lrc') {
    const parsed = parseLrc(decoded.text);
    cueCount = parsed.cueCount;
    durationMs = parsed.durationMs;
    warnings.push(...parsed.warnings);
    lrc = toCrlf(stripBomChar(decoded.text));
  } else {
    const parsed = parseCues(decoded.text, kind);
    cueCount = parsed.cues.length;
    warnings.push(...parsed.warnings);
    durationMs =
      parsed.cues.length > 0
        ? Math.max(...parsed.cues.map((cue) => cue.endMs))
        : null;
    const built = cuesToLrc(parsed.cues, {
      includeMetadata: subtitleSettings.includeMetadata,
      mergeLines: subtitleSettings.mergeLines,
      offsetMs: subtitleSettings.offsetMs,
      encoding: subtitleSettings.encoding,
      metadata: { title: baseTitle(resolved) }
    });
    lrc = built.lrc;
    warnings.push(...built.warnings);
  }

  const lrcBytes = encodeSubtitleText(lrc, subtitleSettings.encoding).length;
  return {
    sourcePath: resolved,
    sourceEncoding: decoded.encoding,
    cueCount,
    durationMs,
    lrc,
    lrcBytes,
    warnings
  };
}

/** Converts a VTT/SRT (or normalizes an LRC) file into an LRC file on disk. */
export async function convertSubtitleFile(
  sourcePath: string,
  outputPath: string,
  settings: Settings
): Promise<ConvertedSubtitle> {
  const resolvedSource = path.resolve(sourcePath);
  const resolvedOutput = path.resolve(outputPath);
  const extension = path.extname(resolvedSource).slice(1).toLowerCase();
  const decoded = await readSubtitleFile(resolvedSource);
  const warnings = [...decoded.warnings];
  const subtitleSettings = settings.subtitle;
  const detectedKind = extension === 'txt' ? detectSubtitleKind(decoded.text) : null;
  const kind =
    extension === 'vtt' || extension === 'srt' || extension === 'lrc' ? extension : detectedKind;
  if (!kind) {
    throw new Error('TXT 文件没有检测到带时间轴的字幕内容');
  }

  let cueCount = 0;
  let durationMs: number | null = null;
  let lrc = '';

  if (kind === 'lrc') {
    const parsed = parseLrc(decoded.text);
    cueCount = parsed.cueCount;
    durationMs = parsed.durationMs;
    warnings.push(...parsed.warnings);
    lrc = toCrlf(stripBomChar(decoded.text));
  } else {
    const parsed = parseCues(decoded.text, kind);
    cueCount = parsed.cues.length;
    warnings.push(...parsed.warnings);
    durationMs =
      parsed.cues.length > 0
        ? Math.max(...parsed.cues.map((cue) => cue.endMs))
        : null;
    const built = cuesToLrc(parsed.cues, {
      includeMetadata: subtitleSettings.includeMetadata,
      mergeLines: subtitleSettings.mergeLines,
      offsetMs: subtitleSettings.offsetMs,
      encoding: subtitleSettings.encoding,
      metadata: { title: baseTitle(resolvedSource) }
    });
    lrc = built.lrc;
    warnings.push(...built.warnings);
  }

  const buffer = encodeSubtitleText(lrc, subtitleSettings.encoding);
  await writeFileAtomic(resolvedOutput, buffer);
  return {
    cueCount,
    durationMs,
    warnings,
    sourceEncoding: decoded.encoding,
    bytes: buffer.length
  };
}

/** Exposed for tests and diagnostics: raw byte length of an encoded string. */
export function encodedByteLength(text: string, encoding: SubtitleEncoding): number {
  return encodeSubtitleText(text, encoding).length;
}