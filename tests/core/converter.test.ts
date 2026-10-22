import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { convertWithFfmpeg, scanConverter } from '@core/converter';
import { detectFfmpeg, runFfmpeg } from '@core/ffmpeg';
import { createTempDir, removeDir } from './helpers';

let ffmpegPath = '';

let temporaryDirectory: string | null = null;

beforeAll(async () => {
  const detected = await detectFfmpeg();
  ffmpegPath = detected.available ? detected.path : '';
});

afterEach(async () => {
  if (temporaryDirectory) {
    await removeDir(temporaryDirectory);
    temporaryDirectory = null;
  }
});

const request = (source: string, recursive = true): Parameters<typeof scanConverter>[0] => ({
  source,
  outputDir: null,
  format: 'mp3',
  bitrateKbps: 192,
  recursive
});

describe('scanConverter', () => {
  it('scans a folder recursively and defaults output to Sotto-converted', async () => {
    temporaryDirectory = await createTempDir('sotto-converter-');
    await fs.mkdir(path.join(temporaryDirectory, 'sub'));
    await fs.writeFile(path.join(temporaryDirectory, 'one.wav'), 'audio');
    await fs.writeFile(path.join(temporaryDirectory, 'sub', 'two.flac'), 'audio');
    await fs.writeFile(path.join(temporaryDirectory, 'notes.txt'), 'not audio');
    const scan = await scanConverter(request(temporaryDirectory));
    expect(scan.sourceKind).toBe('folder');
    expect(scan.recursive).toBe(true);
    expect(scan.files.map((file) => file.name).sort()).toEqual(['one.wav', 'two.flac']);
    expect(scan.outputDir).toBe(path.join(temporaryDirectory, 'Sotto-converted'));
    expect(scan.files.every((file) => file.targetPath.endsWith('.mp3'))).toBe(true);
    expect(scan.totalBytes).toBeGreaterThan(0);
  });

  it('only scans the top level when recursive is false', async () => {
    temporaryDirectory = await createTempDir('sotto-converter-');
    await fs.mkdir(path.join(temporaryDirectory, 'sub'));
    await fs.writeFile(path.join(temporaryDirectory, 'one.wav'), 'audio');
    await fs.writeFile(path.join(temporaryDirectory, 'sub', 'two.wav'), 'audio');
    const scan = await scanConverter(request(temporaryDirectory, false));
    expect(scan.files.map((file) => file.name)).toEqual(['one.wav']);
  });

  it('converts a generated WAV to MP3 with ffmpeg', async () => {
    if (!ffmpegPath) return;
    temporaryDirectory = await createTempDir('sotto-converter-');
    const wav = path.join(temporaryDirectory, 'tone.wav');
    const generated = await runFfmpeg(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
      '-c:a', 'pcm_s16le', wav
    ]);
    expect(generated.ok).toBe(true);
    const progress: number[] = [];
    const result = await convertWithFfmpeg(
      { source: wav, outputDir: null, format: 'mp3', bitrateKbps: 128, recursive: false, threads: 1 },
      'converter-test',
      (event) => progress.push(event.overallPercent),
      ffmpegPath
    );
    expect(result.success).toBe(1);
    expect(result.outputDir).toBe(path.join(temporaryDirectory, 'Sotto-converted'));
    expect(await fs.stat(path.join(temporaryDirectory, 'Sotto-converted', 'tone.mp3')).then((s) => s.size)).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
  });

  it('converts multiple files with the requested file-level parallelism', async () => {
    if (!ffmpegPath) return;
    temporaryDirectory = await createTempDir('sotto-converter-');
    for (const name of ['a', 'b']) {
      const generated = await runFfmpeg(ffmpegPath, [
        '-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4',
        '-c:a', 'pcm_s16le', path.join(temporaryDirectory, name + '.wav')
      ]);
      expect(generated.ok).toBe(true);
    }
    const details: string[] = [];
    const result = await convertWithFfmpeg(
      { source: temporaryDirectory, outputDir: null, format: 'mp3', bitrateKbps: 128, recursive: false, parallelism: 2 },
      'converter-parallel-test',
      (event) => details.push(event.detail),
      ffmpegPath
    );
    expect(result.success).toBe(2);
    expect(details.some((detail) => detail.includes('并发 2'))).toBe(true);
    for (const name of ['a.mp3', 'b.mp3']) {
      const stat = await fs.stat(path.join(temporaryDirectory, 'Sotto-converted', name));
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it('uses the source parent for a single file', async () => {
    temporaryDirectory = await createTempDir('sotto-converter-');
    const file = path.join(temporaryDirectory, 'single.flac');
    await fs.writeFile(file, 'audio');
    const scan = await scanConverter(request(file));
    expect(scan.sourceKind).toBe('file');
    expect(scan.files).toHaveLength(1);
    expect(scan.outputDir).toBe(path.join(temporaryDirectory, 'Sotto-converted'));
    expect(scan.files[0].targetPath).toBe(path.join(temporaryDirectory, 'Sotto-converted', 'single.mp3'));
  });
});