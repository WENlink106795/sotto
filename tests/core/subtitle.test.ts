import { promises as fs } from 'node:fs';
import path from 'node:path';
import { encode as iconvEncode, decode as iconvDecode } from 'iconv-lite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  convertSubtitleFile,
  cuesToLrc,
  decodeSubtitleBuffer,
  detectSubtitleKind,
  encodeSubtitleText,
  parseCues,
  parseTimestamp,
  previewSubtitle
} from '@core/subtitle';
import type { Cue } from '@core/subtitle';
import { createTempDir, makeSettings, removeDir, writeText } from './helpers';

const temporaryDirectories: string[] = [];
const VTT = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\n';

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await removeDir(directory);
  }
});

async function tempDir(): Promise<string> {
  const directory = await createTempDir('sotto-subtitle-');
  temporaryDirectories.push(directory);
  return directory;
}

function cue(startMs: number, endMs: number, text: string): Cue {
  return {
    id: null,
    startMs,
    endMs,
    text,
    lines: text.split('\n')
  };
}

describe('parseTimestamp', () => {
  it('accepts dot, comma and hour-less timestamps', () => {
    expect(parseTimestamp('00:00:01.500')).toBe(1500);
    expect(parseTimestamp('00:01:02,250')).toBe(62250);
    expect(parseTimestamp('01:02.5')).toBe(62500);
    expect(parseTimestamp('123:00:00.000')).toBe(123 * 3600000);
    expect(parseTimestamp('not a timestamp')).toBeNull();
  });
});

describe('parseCues VTT', () => {
  const vtt = [
    'WEBVTT - 测试字幕',
    '',
    'NOTE 这是注释',
    '',
    'STYLE',
    '::cue { color: red }',
    '',
    'REGION',
    'id:r1',
    '',
    'cue-1',
    '00:00:01.000 --> 00:00:03.500 align:start position:0%',
    '<c.yellow>Hello</c> &amp; welcome',
    '<v Narrator>Second line</v>',
    '',
    '00:01:04.250 --> 00:01:05.000',
    'Karaoke <00:01:04.500>mid<00:01:04.900>end &#39;quote&#39;'
  ].join('\r\n');

  it('skips headers, notes, styles and regions', () => {
    const result = parseCues(vtt, 'vtt');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].id).toBe('cue-1');
    expect(result.cues[0].text).toBe('Hello & welcome\nSecond line');
  });

  it('strips karaoke timestamps and decodes entities', () => {
    const result = parseCues(vtt, 'vtt');
    expect(result.cues[1].startMs).toBe(64250);
    expect(result.cues[1].text).toBe("Karaoke midend 'quote'");
  });

  it('handles a header block without a blank separator', () => {
    const result = parseCues('WEBVTT\n00:00:01.000 --> 00:00:02.000\nHi', 'vtt');
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe('Hi');
  });

  it('ignores metadata-only header blocks without warnings', () => {
    const result = parseCues('WEBVTT\nKind: captions\nLanguage: zh\n\n00:00:01.000 --> 00:00:02.000\nHi', 'vtt');
    expect(result.cues).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('handles BOM and bare LF', () => {
    const result = parseCues('\uFEFFWEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi', 'vtt');
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].startMs).toBe(1000);
  });
});

describe('parseCues SRT', () => {
  it('parses comma timestamps, cue indexes and sorts out-of-order cues', () => {
    const srt = [
      '2',
      '00:00:05,000 --> 00:00:06,000',
      'Second',
      '',
      '1',
      '00:00:01.000 --> 00:00:02.000',
      'First',
      '',
      '3',
      '00:00:01.500 --> 00:00:03.000',
      'Overlapping <i>third</i>'
    ].join('\n');
    const result = parseCues(srt, 'srt');
    expect(result.cues.map((item) => item.text)).toEqual(['First', 'Overlapping third', 'Second']);
    expect(result.warnings.some((warning) => warning.includes('乱序'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('重叠'))).toBe(true);
  });

  it('tolerates malformed blocks and reports warnings', () => {
    const result = parseCues('garbage without timing\n\n00:00:01,000 --> broken\nText', 'srt');
    expect(result.cues).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('decodes named and numeric entities', () => {
    const srt = [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      'A &amp; B &lt;3 &nbsp; C &#x1F600; &#20320;'
    ].join('\n');
    const result = parseCues(srt, 'srt');
    expect(result.cues[0].text).toBe('A & B <3 C 😀 你');
  });

  it('fixes end times before start times', () => {
    const result = parseCues('1\n00:00:05,000 --> 00:00:01,000\nBad range', 'srt');
    expect(result.cues[0].startMs).toBe(5000);
    expect(result.cues[0].endMs).toBe(5000);
    expect(result.warnings.some((warning) => warning.includes('结束时间'))).toBe(true);
  });
});

describe('encoding detection', () => {
  it('detects UTF-8 BOM', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('字幕', 'utf8')]);
    const decoded = decodeSubtitleBuffer(buffer);
    expect(decoded.encoding).toBe('utf-8-bom');
    expect(decoded.text).toBe('字幕');
  });

  it('detects UTF-16LE BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconvEncode('字幕测试', 'utf16le')
    ]);
    const decoded = decodeSubtitleBuffer(buffer);
    expect(decoded.encoding).toBe('utf-16le');
    expect(decoded.text).toBe('字幕测试');
  });

  it('detects UTF-16BE BOM', () => {
    const buffer = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      iconvEncode('字幕测试', 'utf16be')
    ]);
    const decoded = decodeSubtitleBuffer(buffer);
    expect(decoded.encoding).toBe('utf-16be');
    expect(decoded.text).toBe('字幕测试');
  });

  it('falls back to GB18030 for invalid UTF-8', () => {
    const original = '简体字幕：雨夜与翻书声';
    const buffer = iconvEncode(original, 'gb18030');
    const decoded = decodeSubtitleBuffer(buffer);
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text).toBe(original);
    expect(decoded.warnings.some((warning) => warning.includes('GB18030'))).toBe(true);
  });

  it('detects BOM-less UTF-16LE ASCII text', () => {
    const buffer = iconvEncode('Hello subtitle', 'utf16le');
    const decoded = decodeSubtitleBuffer(buffer);
    expect(decoded.encoding).toBe('utf-16le');
    expect(decoded.text).toBe('Hello subtitle');
  });
});

describe('cuesToLrc', () => {
  it('formats timestamps with minutes above 59 and centisecond rounding', () => {
    const result = cuesToLrc([cue(75 * 60000 + 3456, 0, 'Long')], {
      includeMetadata: false,
      mergeLines: true,
      offsetMs: 0,
      encoding: 'utf-8'
    });
    expect(result.lrc).toBe('[75:03.46]Long\r\n');
  });

  it('merges cue lines with mergeLines and keeps one entry per line otherwise', () => {
    const target = [cue(1000, 2000, 'Line one\nLine two')];
    const merged = cuesToLrc(target, {
      includeMetadata: false,
      mergeLines: true,
      offsetMs: 0,
      encoding: 'utf-8'
    });
    expect(merged.lrc).toBe('[00:01.00]Line one Line two\r\n');
    const separate = cuesToLrc(target, {
      includeMetadata: false,
      mergeLines: false,
      offsetMs: 0,
      encoding: 'utf-8'
    });
    expect(separate.lrc).toBe('[00:01.00]Line one\r\n[00:01.00]Line two\r\n');
  });

  it('applies offset and clamps negative timestamps', () => {
    const result = cuesToLrc([cue(1000, 2000, 'Shifted')], {
      includeMetadata: false,
      mergeLines: true,
      offsetMs: -5000,
      encoding: 'utf-8'
    });
    expect(result.lrc).toBe('[00:00.00]Shifted\r\n');
    expect(result.warnings.some((warning) => warning.includes('偏移'))).toBe(true);
  });

  it('emits metadata and CRLF line endings', () => {
    const result = cuesToLrc([cue(1000, 2000, 'Hi')], {
      includeMetadata: true,
      mergeLines: true,
      offsetMs: 0,
      encoding: 'utf-8',
      metadata: { title: '标题', artist: '作者' }
    });
    expect(result.lrc).toContain('[ti:标题]\r\n');
    expect(result.lrc).toContain('[ar:作者]\r\n');
    expect(result.lrc).toContain('[by:Sotto]\r\n');
    expect(result.lrc.endsWith('\r\n')).toBe(true);
  });

  it('encodes UTF-8 BOM and GB18030 correctly', () => {
    const bom = encodeSubtitleText('abc', 'utf-8-bom');
    expect(Array.from(bom.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(bom.subarray(3).toString('utf8')).toBe('abc');
    const gb = encodeSubtitleText('字幕', 'gb18030');
    expect(iconvDecode(gb, 'gb18030')).toBe('字幕');
  });
});

describe('previewSubtitle and convertSubtitleFile', () => {
  it('previews a GB18030 SRT file', async () => {
    const directory = await tempDir();
    const source = path.join(directory, '雨夜.srt');
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:02,500',
      '你好，雨夜。',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,000',
      '晚安。'
    ].join('\r\n');
    await writeText(source, iconvEncode(srt, 'gb18030'));

    const preview = await previewSubtitle(source, makeSettings());
    expect(preview.sourceEncoding).toBe('gb18030');
    expect(preview.cueCount).toBe(2);
    expect(preview.durationMs).toBe(4000);
    expect(preview.lrc).toContain('[00:01.00]你好，雨夜。');
    expect(preview.lrcBytes).toBeGreaterThan(0);
  });

  it('converts to an LRC file with BOM and CRLF', async () => {
    const directory = await tempDir();
    const source = path.join(directory, 'episode.vtt');
    const output = path.join(directory, 'out', 'episode.lrc');
    await writeText(
      source,
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n'
    );
    const settings = makeSettings((value) => {
      value.subtitle.encoding = 'utf-8-bom';
      value.subtitle.includeMetadata = false;
    });
    const result = await convertSubtitleFile(source, output, settings);
    expect(result.cueCount).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);
    const raw = await fs.readFile(output);
    expect(Array.from(raw.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const text = raw.subarray(3).toString('utf8');
    expect(text).toBe('[00:01.00]Hello\r\n');
  });

  it('previews an existing LRC file', async () => {
    const directory = await tempDir();
    const source = path.join(directory, 'existing.lrc');
    await writeText(source, '[ti:Demo]\r\n[00:01.00]Hello\r\n[01:02.50]World\r\n');
    const preview = await previewSubtitle(source, makeSettings());
    expect(preview.cueCount).toBe(2);
    expect(preview.durationMs).toBe(62500);
    expect(preview.lrc).toContain('[01:02.50]World');
  });
});
describe('content-based subtitle detection', () => {
  it('detects WEBVTT, SRT and LRC content regardless of extension', () => {
    expect(detectSubtitleKind('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi')).toBe('vtt');
    expect(detectSubtitleKind('1\n00:00:01,000 --> 00:00:02,000\nHi')).toBe('srt');
    expect(detectSubtitleKind('[00:01.00]Hello\n[00:02.50]World')).toBe('lrc');
    expect(detectSubtitleKind('这是一个普通剧本，没有时间轴。\n第二行。')).toBeNull();
    expect(detectSubtitleKind('DLsite: https://example.com')).toBeNull();
  });
});

describe('TXT-as-subtitle conversion', () => {
  it('converts a .txt containing WebVTT content into LRC', async () => {
    const directory = await tempDir();
    const source = path.join(directory, 'script.txt');
    const output = path.join(directory, 'script.lrc');
    await writeText(source, VTT);
    const settings = await makeSettings();
    const result = await convertSubtitleFile(source, output, settings);
    expect(result.cueCount).toBe(1);
    const text = await fs.readFile(output, 'utf8');
    expect(text).toContain('[00:01.00]Hello');
    expect(text).toContain('\r\n');
  });

  it('rejects a plain-text script without timestamps', async () => {
    const directory = await tempDir();
    const source = path.join(directory, 'readme.txt');
    await writeText(source, '只是说明文字。\n没有时间轴。');
    const settings = await makeSettings();
    await expect(
      convertSubtitleFile(source, path.join(directory, 'readme.lrc'), settings)
    ).rejects.toThrow(/时间轴/);
  });
});