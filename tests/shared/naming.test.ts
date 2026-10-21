import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import {
  matchKeyWithoutBrackets,
  normalizeForMatch,
  sanitizeBaseName,
  stripExtension
} from '../../src/shared/naming';

const naming = DEFAULT_SETTINGS.naming;

describe('sanitizeBaseName', () => {
  it('removes emoji and keeps CJK text', () => {
    const result = sanitizeBaseName('01 雨夜与翻书声♡ ☆', naming);
    expect(result.value).toBe('01 雨夜与翻书声');
    expect(result.removed.map((item) => item.char)).toContain('♡');
    expect(result.changed).toBe(true);
  });

  it('normalizes full-width characters with NFKC', () => {
    const result = sanitizeBaseName('【简体】０１ Ｔｒａｃｋ：　测试', naming);
    expect(result.value).toBe('【简体】01 Track 测试');
  });

  it('removes Windows illegal characters', () => {
    const result = sanitizeBaseName('a<b>c:d"e/f\\g|h?i*j', naming);
    expect(result.value).toBe('abcdefghij');
  });

  it('keeps configured punctuation but removes unknown symbols', () => {
    const result = sanitizeBaseName('Track (01) [Full] - 晚安~ [测试]', naming);
    expect(result.value).toBe('Track (01) [Full] - 晚安~ [测试]');
    const symbol = sanitizeBaseName('Track ★ 01', naming);
    expect(symbol.value).toBe('Track 01');
  });

  it('collapses whitespace and trims trailing dots/spaces', () => {
    const result = sanitizeBaseName('  01   雨夜   ', naming);
    expect(result.value).toBe('01 雨夜');
  });

  it('falls back to untitled when nothing survives', () => {
    const result = sanitizeBaseName('♡☆♪', naming);
    expect(result.value).toBe('untitled');
    expect(result.fallback).toBe(true);
  });

  it('supports ASCII-only mode', () => {
    const result = sanitizeBaseName('雨夜 Rain 01', { ...naming, asciiOnly: true });
    expect(result.value).toBe('Rain 01');
  });

  it('protects Windows reserved device names', () => {
    const result = sanitizeBaseName('CON', naming);
    expect(result.value).toBe('_CON');
  });

  it('truncates by code points without breaking surrogate pairs', () => {
    const long = '😀'.repeat(20) + '雨'.repeat(40);
    const result = sanitizeBaseName(long, { ...naming, removeEmoji: false, maxBaseLength: 10 });
    expect(Array.from(result.value).length).toBeLessThanOrEqual(10);
    expect(result.truncated).toBe(true);
  });
});

describe('match normalization', () => {
  it('ignores case, whitespace, punctuation and brackets for secondary keys', () => {
    expect(normalizeForMatch('【简体】01 Rain Night.wav')).toBe('简体01rainnightwav');
    expect(matchKeyWithoutBrackets('【简体】01 Rain Night')).toBe('01rainnight');
  });

  it('strips extensions safely', () => {
    expect(stripExtension('01 雨夜.wav')).toBe('01 雨夜');
    expect(stripExtension('no-extension')).toBe('no-extension');
    expect(stripExtension('.hidden')).toBe('.hidden');
  });
});