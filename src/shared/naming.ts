import type { NamingSettings } from './types';

export interface RemovedChar {
  char: string;
  count: number;
  label: string;
}

export interface SanitizeResult {
  value: string;
  removed: RemovedChar[];
  changed: boolean;
  fallback: boolean;
  truncated: boolean;
}

const WINDOWS_ILLEGAL = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const ASCII_EXTRA_KEEP = new Set([' ', '-', '_', '(', ')', '[', ']', '{', '}', '&', ',', '.', '!', '~', '@', '#', '%', '+']);

function isLetter(ch: string): boolean {
  return /\p{L}/u.test(ch);
}
function isNumber(ch: string): boolean {
  return /\p{N}/u.test(ch);
}
function isMark(ch: string): boolean {
  return /\p{M}/u.test(ch);
}
function isControlOrFormat(ch: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Cs}\p{Co}]/u.test(ch) || ch === '\uFEFF';
}
function isEmoji(ch: string): boolean {
  if (/\p{Extended_Pictographic}/u.test(ch)) return true;
  return /\p{So}/u.test(ch);
}
function labelFor(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = cp.toString(16).toUpperCase().padStart(4, '0');
  if (ch === ' ') return '空格';
  if (isEmoji(ch)) return '表情/符号 U+' + hex;
  if (isControlOrFormat(ch)) return '控制字符 U+' + hex;
  return 'U+' + hex;
}

export function sanitizeBaseName(input: string, options: NamingSettings): SanitizeResult {
  const original = input;
  let text = options.normalizeNfkc ? input.normalize('NFKC') : input;
  const keep = new Set(Array.from(options.keepPunctuation || ''));
  const extraRemove = new Set(Array.from(options.extraRemove || ''));
  const extraKeep = new Set(Array.from(options.extraKeep || ''));
  const removedMap = new Map<string, number>();
  let output = '';
  let truncated = false;

  const record = (ch: string): void => {
    removedMap.set(ch, (removedMap.get(ch) || 0) + 1);
  };

  for (const ch of text) {
    if (ch === '\r' || ch === '\n' || ch === '\t') {
      output += ' ';
      continue;
    }
    if (ch === '\uFEFF') {
      record(ch);
      continue;
    }
    if (extraKeep.has(ch)) {
      output += ch;
      continue;
    }
    if (extraRemove.has(ch)) {
      record(ch);
      continue;
    }
    if (isControlOrFormat(ch)) {
      record(ch);
      continue;
    }
    if (options.removeEmoji && isEmoji(ch)) {
      record(ch);
      continue;
    }
    if (ch === ' ') {
      output += ' ';
      continue;
    }
    if (WINDOWS_ILLEGAL.has(ch)) {
      record(ch);
      continue;
    }
    const ascii = ch.codePointAt(0)! < 128;
    if (isLetter(ch) || isNumber(ch) || isMark(ch)) {
      if (options.asciiOnly && !ascii) {
        record(ch);
        continue;
      }
      output += ch;
      continue;
    }
    if (keep.has(ch)) {
      output += ch;
      continue;
    }
    if (options.asciiOnly && ASCII_EXTRA_KEEP.has(ch)) {
      output += ch;
      continue;
    }
    record(ch);
  }

  if (options.collapseSpaces) {
    output = output.replace(/\s+/g, ' ');
  } else {
    output = output.replace(/[ \t]+/g, ' ');
  }
  output = output.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  if (output.length > 0 && !/[\p{L}\p{N}]/u.test(output)) {
    output = '';
  }

  let fallback = false;
  if (!output) {
    output = 'untitled';
    fallback = true;
  }
  if (RESERVED_NAMES.test(output)) {
    output = '_' + output;
  }

  const max = Math.max(1, Math.min(160, options.maxBaseLength || 100));
  if (Array.from(output).length > max) {
    output = Array.from(output).slice(0, max).join('').replace(/[\s.]+$/, '');
    truncated = true;
    if (!output) {
      output = 'untitled';
      fallback = true;
    }
  }

  const removed: RemovedChar[] = Array.from(removedMap.entries())
    .map(([char, count]) => ({ char, count, label: labelFor(char) }))
    .sort((a, b) => b.count - a.count || a.char.codePointAt(0)! - b.char.codePointAt(0)!);

  return {
    value: output,
    removed,
    changed: output !== original,
    fallback,
    truncated
  };
}

export function normalizeForMatch(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[\p{P}\p{S}]/gu, '');
}

export function matchKeyWithoutBrackets(input: string): string {
  return normalizeForMatch(input.replace(/[\(\[【（].{0,40}?[\)\]】）]/g, ''));
}

export function stripExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return fileName;
  return fileName.slice(0, index);
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index + 1).toLowerCase();
}

export function joinBaseAndExt(base: string, ext: string): string {
  return base + '.' + ext.replace(/^\./, '').toLowerCase();
}

export const SAMPLE_NAMES = [
  '【简体】01 耳边轻语♡.wav',
  '02 - 雨夜助眠 ☆.flac',
  'Track 03： whispered story.mp3',
  '04 晚安，好梦… (Full Ver.).m4a'
];
