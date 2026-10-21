import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanLibrary } from '@core/scan';
import { createTempDir, removeDir, writeText } from './helpers';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await removeDir(directory);
  }
});

async function tempDir(): Promise<string> {
  const directory = await createTempDir('sotto-scan-');
  temporaryDirectories.push(directory);
  return directory;
}

describe('scanLibrary', () => {
  it('classifies media recursively and skips hidden/system entries', async () => {
    const root = await tempDir();
    await writeText(path.join(root, '00 intro.mp3'), 'x');
    await writeText(path.join(root, 'album1', 'track1.wav'), 'x');
    await writeText(path.join(root, 'album1', 'track1.vtt'), 'WEBVTT');
    await writeText(path.join(root, 'album1', 'cover.png'), 'png');
    await writeText(path.join(root, 'album1', '.hidden.mp3'), 'x');
    await writeText(path.join(root, 'album1', 'readme.txt'), 'x');
    await writeText(path.join(root, 'album2', 'disc', 'track2.flac'), 'x');
    await writeText(path.join(root, 'album2', 'track3.srt'), '1');
    await writeText(path.join(root, 'album2', 'TRACK4.MP3'), 'x');
    await writeText(path.join(root, 'node_modules', 'pkg', 'bad.wav'), 'x');
    await writeText(path.join(root, '.git', 'config'), 'x');
    await writeText(path.join(root, 'System Volume Information', 'sys.wav'), 'x');
    await writeText(path.join(root, '$RECYCLE.BIN', 'old.mp3'), 'x');

    const messages: string[] = [];
    const result = await scanLibrary(root, (message) => messages.push(message));

    expect(result.root).toBe(path.resolve(root));
    expect(result.rootName).toBe(path.basename(root));
    expect(result.truncated).toBe(false);

    const relativePaths = result.folders.map((folder) => folder.relativePath).sort();
    expect(relativePaths).toEqual(
      ['', 'album1', 'album2', path.join('album2', 'disc')].sort()
    );

    expect(result.stats.audio).toBe(4);
    expect(result.stats.subtitle).toBe(2);
    expect(result.stats.image).toBe(1);
    expect(result.stats.text).toBe(1);
    expect(result.stats.totalFiles).toBe(8);
    expect(result.stats.bytes).toBe(1 + 1 + 6 + 3 + 1 + 1 + 1 + 1);

    const album1 = result.folders.find((folder) => folder.relativePath === 'album1');
    expect(album1).toBeDefined();
    const track = album1?.files.find((file) => file.name === 'track1.wav');
    expect(track).toMatchObject({ base: 'track1', ext: 'wav', kind: 'audio' });
    expect(track?.size).toBe(1);
    expect(track?.mtimeMs).toBeGreaterThan(0);
    expect(album1?.files.some((file) => file.name === '.hidden.mp3')).toBe(false);
    const readme = album1?.files.find((file) => file.name === 'readme.txt');
    expect(readme?.kind).toBe('text');

    const upper = result.folders
      .find((folder) => folder.relativePath === 'album2')
      ?.files.find((file) => file.name === 'TRACK4.MP3');
    expect(upper?.ext).toBe('mp3');
    expect(upper?.base).toBe('TRACK4');

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toContain(path.basename(root));
  });

  it('skips directory links', async () => {
    const root = await tempDir();
    await writeText(path.join(root, 'real', 'a.wav'), 'x');
    let linked = false;
    try {
      await fs.symlink(path.join(root, 'real'), path.join(root, 'linked-real'), 'junction');
      linked = true;
    } catch {
      linked = false;
    }
    const result = await scanLibrary(root);
    expect(result.folders.map((folder) => folder.relativePath)).toContain('real');
    if (linked) {
      expect(result.folders.map((folder) => folder.relativePath)).not.toContain('linked-real');
      expect(result.warnings.some((warning) => warning.includes('符号链接'))).toBe(true);
    }
  });

  it('rejects roots that are not directories', async () => {
    const root = await tempDir();
    const file = path.join(root, 'file.txt');
    await writeText(file, 'x');
    await expect(scanLibrary(file)).rejects.toThrow();
    await expect(scanLibrary(path.join(root, 'missing'))).rejects.toThrow();
  });

  it('returns empty stats for an empty folder', async () => {
    const root = await tempDir();
    const result = await scanLibrary(root);
    expect(result.folders).toEqual([]);
    expect(result.stats.totalFiles).toBe(0);
    expect(result.stats.bytes).toBe(0);
  });
});