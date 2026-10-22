import { describe, expect, it } from 'vitest';
import { buildConverterArgs } from '@core/converter-engines';

function args(format: 'mp3' | 'aac' | 'm4a' | 'ogg', rate = 192): string[] {
  return buildConverterArgs('input.wav', 'output.' + format, format, rate);
}

describe('buildConverterArgs', () => {
  it('keeps OpenConverter MP3 args and strips video', () => {
    const value = args('mp3');
    expect(value).toContain('libmp3lame');
    expect(value).toContain('192k');
    expect(value).toContain('-vn');
    expect(value).toContain('-id3v2_version');
  });

  it('uses ADTS for raw AAC and clamps OpenConverter OGG to 256k', () => {
    expect(args('aac')).toEqual(expect.arrayContaining(['-f', 'adts']));
    const ogg = args('ogg', 320);
    expect(ogg).toContain('libopus');
    expect(ogg).toContain('256k');
  });
});
