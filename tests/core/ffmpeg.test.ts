import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectFfmpeg, findFfprobe, probeDurationMs, runFfmpeg } from '@core/ffmpeg';
import { createTempDir, removeDir } from './helpers';

let temporaryDirectory: string | null = null;
let available = false;
let ffmpegPath = '';

beforeAll(async () => {
  temporaryDirectory = await createTempDir('sotto-ffmpeg-');
  const detected = await detectFfmpeg();
  available = detected.available;
  ffmpegPath = detected.path;
});

afterAll(async () => {
  if (temporaryDirectory) await removeDir(temporaryDirectory);
});

describe('detectFfmpeg', () => {
  it('returns a well-formed result even when ffmpeg is missing', async () => {
    const detected = await detectFfmpeg('C:\\definitely\\not\\here\\ffmpeg.exe');
    expect(typeof detected.available).toBe('boolean');
    expect(typeof detected.checkedAt).toBe('number');
    if (detected.available) {
      expect(
        detected.source === 'path' ||
          detected.source === 'common' ||
          detected.source === 'custom' ||
          detected.source === 'bundled'
      ).toBe(true);
      expect(detected.path.length).toBeGreaterThan(0);
    } else {
      expect(detected.source).toBe('missing');
      expect(detected.path).toBe('');
    }
  });

  it('uses an explicit custom path when it is valid', async () => {
    if (!available) return;
    const detected = await detectFfmpeg(ffmpegPath);
    expect(detected.available).toBe(true);
    expect(detected.source).toBe('custom');
    expect(path.resolve(detected.path)).toBe(path.resolve(ffmpegPath));
  });
});

describe('probeDurationMs', () => {
  it('returns null for missing or invalid media', async () => {
    expect(await probeDurationMs(path.join(temporaryDirectory || '.', 'missing.wav'), ffmpegPath)).toBeNull();
    const bogus = path.join(temporaryDirectory || '.', 'bogus.wav');
    await fs.writeFile(bogus, 'not audio');
    expect(await probeDurationMs(bogus, ffmpegPath)).toBeNull();
  });

  it('reads a generated WAV duration', async () => {
    if (!available) return;
    const target = path.join(temporaryDirectory || '.', 'tone.wav');
    const generated = await runFfmpeg(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.5',
      '-c:a',
      'pcm_s16le',
      target
    ]);
    expect(generated.ok).toBe(true);
    const duration = await probeDurationMs(target, ffmpegPath);
    expect(duration).not.toBeNull();
    expect(duration || 0).toBeGreaterThan(300);
    expect(duration || 0).toBeLessThan(900);
    const probe = await findFfprobe(ffmpegPath);
    expect(probe).not.toBeNull();
  });
});
