import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlan } from '@core/plan';
import type { FfmpegInfo, PairPlan, PlanResult, Settings } from '@shared/types';
import { createTempDir, fakeFfmpeg, removeDir, writeText } from './helpers';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await removeDir(directory);
  }
});

async function tempDir(): Promise<string> {
  const directory = await createTempDir('sotto-plan-');
  temporaryDirectories.push(directory);
  return directory;
}

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
const SRT = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n';

function baseNameOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

function expectPairInvariants(plan: PlanResult): void {
  for (const folder of plan.folders) {
    for (const pair of folder.pairs) {
      expect(pair.targetBase.length).toBeGreaterThan(0);
      expect(pair.renamedAudioName.length).toBeGreaterThan(0);
      expect(baseNameOf(pair.renamedAudioName).toLowerCase()).toBe(pair.targetBase.toLowerCase());
      if (pair.subtitleOutputName) {
        expect(baseNameOf(pair.subtitleOutputName).toLowerCase()).toBe(
          pair.targetBase.toLowerCase()
        );
      }
      if (pair.subtitleRenameName) {
        expect(baseNameOf(pair.subtitleRenameName).toLowerCase()).toBe(
          pair.targetBase.toLowerCase()
        );
      }
    }
  }
}

function findPair(plan: PlanResult, audioName: string): PairPlan {
  for (const folder of plan.folders) {
    for (const pair of folder.pairs) {
      if (pair.audio.name === audioName) return pair;
    }
  }
  throw new Error('pair not found: ' + audioName);
}

describe('buildPlan matching', () => {
  it('matches exact, normalized and fuzzy names and keeps target invariants', async () => {
    const root = await tempDir();
    const album = path.join(root, '专辑A');
    await writeText(path.join(album, '01 雨夜.wav'), 'a1');
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    await writeText(path.join(album, '02 - 壁炉.wav'), 'a2');
    await writeText(path.join(album, '02 壁炉.srt'), SRT);
    await writeText(path.join(album, '03 花房♡.wav'), 'a3');
    await writeText(path.join(album, '花房.vtt'), VTT);

    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));

    expect(plan.rootName).toBe(path.basename(root));
    expect(plan.folders).toHaveLength(1);
    expect(plan.folders[0].pairs).toHaveLength(3);
    expectPairInvariants(plan);

    const exact = findPair(plan, '01 雨夜.wav');
    expect(exact.match).toBe('exact');
    expect(exact.audioRenameNeeded).toBe(false);
    expect(exact.subtitleConvert).toBe(true);
    expect(exact.subtitleOutputName).toBe('01 雨夜.lrc');
    expect(exact.id).toMatch(/^[0-9a-f]{16}$/);

    const normalized = findPair(plan, '02 - 壁炉.wav');
    expect(normalized.match).toBe('normalized');
    expect(normalized.subtitleConvert).toBe(true);
    expect(normalized.subtitleOutputName).toBe('02 - 壁炉.lrc');
    expect(normalized.subtitleRenameName).toBe('02 - 壁炉.srt');

    const fuzzy = findPair(plan, '03 花房♡.wav');
    expect(fuzzy.match).toBe('fuzzy');
    expect(fuzzy.targetBase).toBe('03 花房');
    expect(fuzzy.renamedAudioName).toBe('03 花房.wav');
    expect(fuzzy.audioRenameNeeded).toBe(true);
    expect(fuzzy.subtitleConvert).toBe(true);
    expect(fuzzy.subtitleOutputName).toBe('03 花房.lrc');
    expect(fuzzy.subtitleRenameName).toBe('03 花房.vtt');
    expect(exact.subtitleRenameName).toBeNull();
    expect(fuzzy.removedChars.length).toBeGreaterThan(0);

    expect(plan.summary.pairs).toBe(3);
    expect(plan.summary.subtitleConversions).toBe(3);
    expect(plan.summary.renames).toBe(3);
    expect(plan.summary.errors).toBe(0);
  });

  it('prefers an existing LRC over VTT/SRT', async () => {
    const root = await tempDir();
    await writeText(path.join(root, '05.wav'), 'audio');
    await writeText(path.join(root, '05.lrc'), '[00:01.00]Existing\r\n');
    await writeText(path.join(root, '05.vtt'), VTT);
    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const pair = findPair(plan, '05.wav');
    expect(pair.subtitle?.ext).toBe('lrc');
    expect(pair.subtitleConvert).toBe(false);
    expect(pair.subtitleRenameName).toBeNull();
    expect(plan.folders[0].orphanSubtitles.map((file) => file.ext)).toContain('vtt');
  });

  it('keeps fuzzy matching when the title itself contains a number', async () => {
    const root = await tempDir();
    const album = path.join(root, '深海电台');
    await writeText(path.join(album, '05 深海电台 第1夜.wav'), 'audio');
    await writeText(path.join(album, '字幕', '深海电台 第1夜.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, '05 深海电台 第1夜.wav');
    expect(pair.match).toBe('fuzzy');
    expect(pair.subtitle?.name).toBe('深海电台 第1夜.vtt');
  });

  it('matches subtitles from close child folders and ignores distant folders', async () => {
    const root = await tempDir();
    const near = path.join(root, '专辑B');
    await writeText(path.join(near, '04 深海.wav'), 'audio');
    await writeText(path.join(near, '字幕', '深海.vtt'), VTT);
    const distant = path.join(root, '专辑C');
    await writeText(path.join(distant, 'solo.wav'), 'audio');
    await writeText(path.join(root, 'other', 'deep', 'sub', 'solo.vtt'), VTT);

    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const nearPair = findPair(plan, '04 深海.wav');
    expect(nearPair.match).toBe('fuzzy');
    expect(nearPair.subtitle?.name).toBe('深海.vtt');
    expect(nearPair.warnings.some((warning) => warning.code === 'match-cross-folder')).toBe(true);

    const nearFolder = plan.folders.find((folder) => folder.folderName === '专辑B');
    expect(nearFolder?.pairs).toHaveLength(1);
    expect(plan.folders.some((folder) => folder.relativePath === path.join('专辑B', '字幕'))).toBe(
      false
    );
    const distantFolder = plan.folders.find((folder) => folder.folderName === '专辑C');
    expect(distantFolder?.orphanAudios.map((file) => file.name)).toContain('solo.wav');
  });

  it('resolves target collisions with a shared suffix', async () => {
    const root = await tempDir();
    await writeText(path.join(root, '01 雨夜♡.wav'), 'audio');
    await writeText(path.join(root, '01 雨夜.vtt'), VTT);
    await writeText(path.join(root, '01 雨夜.wav'), 'other audio');

    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [
          {
            audioPath: path.join(root, '01 雨夜♡.wav'),
            subtitlePath: path.join(root, '01 雨夜.vtt')
          }
        ],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, '01 雨夜♡.wav');
    expect(pair.targetBase).toBe('01 雨夜 (2)');
    expect(pair.renamedAudioName).toBe('01 雨夜 (2).wav');
    expect(pair.subtitleOutputName).toBe('01 雨夜 (2).lrc');
    expect(pair.warnings.some((warning) => warning.code === 'target-collision')).toBe(true);
    expectPairInvariants(plan);
  });

  it('honours manual pairs over automatic matching', async () => {
    const root = await tempDir();
    const audioA = path.join(root, 'a.wav');
    const audioB = path.join(root, 'b.wav');
    const subtitleX = path.join(root, 'x.vtt');
    const subtitleY = path.join(root, 'y.srt');
    await writeText(audioA, 'a');
    await writeText(audioB, 'b');
    await writeText(subtitleX, VTT);
    await writeText(subtitleY, SRT);
    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [
          { audioPath: audioA, subtitlePath: subtitleY },
          { audioPath: audioB, subtitlePath: subtitleX }
        ],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    expect(plan.folders[0].pairs).toHaveLength(2);
    expect(plan.folders[0].pairs.every((pair) => pair.match === 'manual')).toBe(true);
    expect(findPair(plan, 'a.wav').subtitle?.name).toBe('y.srt');
    expect(findPair(plan, 'b.wav').subtitle?.name).toBe('x.vtt');
    expect(findPair(plan, 'a.wav').subtitleOutputName).toBe('a.lrc');
  });

  it('reports ambiguity for equally matching subtitles', async () => {
    const root = await tempDir();
    await writeText(path.join(root, 'ep.wav'), 'audio');
    await writeText(path.join(root, 'ep.vtt'), VTT);
    await writeText(path.join(root, 'ep.srt'), SRT);
    const settings = (await import('@shared/defaults')).cloneSettings(
      (await import('@shared/defaults')).DEFAULT_SETTINGS
    );
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const pair = findPair(plan, 'ep.wav');
    // Same base name but different formats: VTT wins by format priority,
    // so this is not treated as ambiguous any more.
    expect(pair.subtitle?.name).toBe('ep.vtt');
    expect(pair.warnings.some((warning) => warning.code === 'match-ambiguous')).toBe(false);
    expect(plan.folders[0].orphanSubtitles).toHaveLength(1);
  });
});

describe('buildPlan orphans and conversions', () => {
  it('keeps audio-only files as orphans unless enabled', async () => {
    const root = await tempDir();
    await writeText(path.join(root, 'solo.wav'), 'audio');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    let plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    expect(plan.folders[0].pairs).toHaveLength(0);
    expect(plan.folders[0].orphanAudios.map((file) => file.name)).toEqual(['solo.wav']);

    const renameSettings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    renameSettings.naming.renameAudioWithoutSubtitle = true;
    plan = await buildPlan(
      { root, settings: renameSettings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    expect(plan.folders[0].pairs).toHaveLength(1);
    expect(plan.folders[0].pairs[0].subtitle).toBeNull();
    expect(plan.folders[0].pairs[0].match).toBe('single');
    expect(plan.folders[0].orphanAudios).toHaveLength(0);
  });

  it('plans audio conversion when enabled and ffmpeg is present', async () => {
    const root = await tempDir();
    await writeText(path.join(root, 'track.wav'), 'audio');
    await writeText(path.join(root, 'track.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(true)
    );
    const pair = plan.folders[0].pairs[0];
    expect(pair.audioConversion).not.toBeNull();
    expect(pair.audioConversion?.skipReason).toBeNull();
    expect(pair.audioConversion?.outputName).toBe('track.mp3');
    expect(pair.renamedAudioName).toBe('track.wav');
    expect(pair.audioRenameNeeded).toBe(false);
    expect(plan.summary.audioConversions).toBe(1);
  });

  it('keeps the audio rename independent from the conversion output', async () => {
    const root = await tempDir();
    await writeText(path.join(root, '01 雨夜♡.wav'), 'audio');
    await writeText(path.join(root, '01 雨夜.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(true)
    );
    const pair = plan.folders[0].pairs[0];
    expect(pair.targetBase).toBe('01 雨夜');
    expect(pair.renamedAudioName).toBe('01 雨夜.wav');
    expect(pair.audioRenameNeeded).toBe(true);
    expect(pair.audioConversion?.outputName).toBe('01 雨夜.mp3');
    expect(pair.audioConversion?.skipReason).toBeNull();
    expect(plan.summary.renames).toBe(1);
    expect(plan.summary.audioConversions).toBe(1);
    expectPairInvariants(plan);
  });

  it('still renames the original when the conversion output already exists', async () => {
    const root = await tempDir();
    await writeText(path.join(root, '01 雨夜♡.wav'), 'audio');
    await writeText(path.join(root, '01 雨夜.vtt'), VTT);
    await writeText(path.join(root, '01 雨夜.mp3'), 'existing');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [
          {
            audioPath: path.join(root, '01 雨夜♡.wav'),
            subtitlePath: path.join(root, '01 雨夜.vtt')
          }
        ],
        coverChoices: []
      },
      fakeFfmpeg(true)
    );
    const pair = findPair(plan, '01 雨夜♡.wav');
    expect(pair.audioConversion?.skipReason).toBe('目标音频文件已存在');
    expect(pair.renamedAudioName).toBe('01 雨夜.wav');
    expect(pair.audioRenameNeeded).toBe(true);
    expect(plan.summary.audioConversions).toBe(0);
    expect(plan.summary.renames).toBe(1);
  });

  it('skips audio conversion when ffmpeg is missing or output exists', async () => {
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];

    const missingRoot = await tempDir();
    await writeText(path.join(missingRoot, 'track.wav'), 'audio');
    await writeText(path.join(missingRoot, 'track.vtt'), VTT);
    const missingPlan = await buildPlan(
      { root: missingRoot, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    const missingPair = missingPlan.folders[0].pairs[0];
    expect(missingPair.audioConversion?.skipReason).not.toBeNull();
    expect(missingPair.warnings.some((warning) => warning.code === 'ffmpeg-missing')).toBe(true);
    expect(missingPair.renamedAudioName).toBe('track.wav');

    const existingRoot = await tempDir();
    await writeText(path.join(existingRoot, 'track.wav'), 'audio');
    await writeText(path.join(existingRoot, 'track.vtt'), VTT);
    await writeText(path.join(existingRoot, 'track.mp3'), 'existing');
    const existingPlan = await buildPlan(
      {
        root: existingRoot,
        settings,
        manualPairs: [
          {
            audioPath: path.join(existingRoot, 'track.wav'),
            subtitlePath: path.join(existingRoot, 'track.vtt')
          }
        ],
        coverChoices: []
      },
      fakeFfmpeg(true)
    );
    const existingPair = findPair(existingPlan, 'track.wav');
    expect(existingPair.audioConversion?.skipReason).toBe('目标音频文件已存在');
    expect(existingPair.warnings.some((warning) => warning.code === 'convert-skipped')).toBe(true);
    expect(existingPlan.summary.audioConversions).toBe(0);
  });
});

describe('buildPlan kept source subtitle renames', () => {
  it('renames the kept cross-folder VTT in place to the shared target base', async () => {
    const root = await tempDir();
    const album = path.join(root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    await writeText(path.join(album, '【简体】01 雨夜♡.wav'), 'audio');
    await writeText(path.join(subtitleFolder, '01 雨夜 原版.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, '【简体】01 雨夜♡.wav');
    expect(pair.match).toBe('fuzzy');
    expect(pair.subtitleConvert).toBe(true);
    expect(pair.subtitleDeleteSource).toBe(false);
    expect(pair.targetBase).toBe('【简体】01 雨夜');
    expect(pair.subtitleOutputName).toBe('【简体】01 雨夜.lrc');
    expect(pair.subtitleRenameName).toBe('【简体】01 雨夜.vtt');
    expect(pair.renamedAudioName).toBe('【简体】01 雨夜.wav');
    expectPairInvariants(plan);
    expect(plan.summary.renames).toBe(2);
  });

  it('skips the kept source rename when its own directory already has the target name', async () => {
    const root = await tempDir();
    const album = path.join(root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    const audio = path.join(album, '01 雨夜.wav');
    const source = path.join(subtitleFolder, '01 雨夜 原版.vtt');
    const occupied = path.join(subtitleFolder, '01 雨夜.vtt');
    await writeText(audio, 'audio');
    await writeText(source, VTT);
    await writeText(occupied, 'WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nOther\n');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [{ audioPath: audio, subtitlePath: source }],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, '01 雨夜.wav');
    expect(pair.targetBase).toBe('01 雨夜');
    expect(pair.subtitleOutputName).toBe('01 雨夜.lrc');
    expect(pair.subtitleRenameName).toBeNull();
    expect(pair.warnings.some((warning) => warning.code === 'source-rename-skipped')).toBe(true);
    expectPairInvariants(plan);
  });

  it('does not plan a kept source rename when the source is deleted after conversion', async () => {
    const root = await tempDir();
    const album = path.join(root, '专辑');
    await writeText(path.join(album, '01 雨夜.wav'), 'audio');
    await writeText(path.join(album, '字幕', '01 雨夜 原版.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.subtitle.deleteSource = true;
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, '01 雨夜.wav');
    expect(pair.subtitleConvert).toBe(true);
    expect(pair.subtitleDeleteSource).toBe(true);
    expect(pair.subtitleRenameName).toBeNull();
  });

  it('renames a kept source in place even when naming normalization is disabled', async () => {
    const root = await tempDir();
    const album = path.join(root, '专辑');
    await writeText(path.join(album, 'track.wav'), 'audio');
    await writeText(path.join(album, '字幕', 'old-name.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.naming.enabled = false;
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [
          {
            audioPath: path.join(album, 'track.wav'),
            subtitlePath: path.join(album, '字幕', 'old-name.vtt')
          }
        ],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = findPair(plan, 'track.wav');
    expect(pair.targetBase).toBe('track');
    expect(pair.subtitleRenameName).toBe('track.vtt');
    expect(pair.audioRenameNeeded).toBe(false);
  });
});

describe('buildPlan covers', () => {
  it('plans a JPEG cover from an explicit choice and lists descendant images', async () => {
    const root = await tempDir();
    const folder = path.join(root, 'album');
    await writeText(path.join(folder, 'track.wav'), 'audio');
    const chosen = path.join(folder, 'cover-art.png');
    await writeText(chosen, 'png');
    await writeText(path.join(folder, 'Scans', 'page1.jpg'), 'jpg');
    await writeText(path.join(folder, 'Scans', 'page2.png'), 'png');

    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan(
      {
        root,
        settings,
        manualPairs: [],
        coverChoices: [{ folder, imagePath: chosen }]
      },
      fakeFfmpeg(false)
    );
    const folderPlan = plan.folders.find((item) => item.folder === folder);
    expect(folderPlan?.coverCandidates.map((file) => file.name).sort()).toEqual([
      'cover-art.png',
      'page1.jpg',
      'page2.png'
    ]);
    expect(folderPlan?.cover?.action).toBe('convert');
    expect(folderPlan?.cover?.targetName).toBe('cover.jpg');
    expect(folderPlan?.cover?.targetPath).toBe(path.join(folder, 'cover.jpg'));
    expect(
      folderPlan?.cover?.warnings.some((warning) => warning.code === 'ffmpeg-missing')
    ).toBe(true);
    expect(plan.summary.covers).toBe(1);

    settings.cover.convertToJpeg = false;
    const movePlan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [{ folder, imagePath: chosen }] },
      fakeFfmpeg(false)
    );
    const moveFolder = movePlan.folders.find((item) => item.folder === folder);
    expect(moveFolder?.cover?.action).toBe('move');
    expect(moveFolder?.cover?.targetName).toBe('cover.png');
  });

  it('warns when the cover target already exists', async () => {
    const root = await tempDir();
    const folder = path.join(root, 'album');
    await writeText(path.join(folder, 'track.wav'), 'audio');
    const chosen = path.join(folder, 'art.png');
    await writeText(chosen, 'png');
    await writeText(path.join(folder, 'cover.jpg'), 'existing');

    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan(
      { root, settings, manualPairs: [], coverChoices: [{ folder, imagePath: chosen }] },
      fakeFfmpeg(true)
    );
    const folderPlan = plan.folders.find((item) => item.folder === folder);
    expect(folderPlan?.cover?.existingTarget?.name).toBe('cover.jpg');
    expect(folderPlan?.cover?.overwrite).toBe(false);
    expect(folderPlan?.cover?.warnings.some((warning) => warning.code === 'cover-exists')).toBe(
      true
    );
  });
});
describe('real-world subtitle naming', () => {
  it('matches a .mp3.vtt subtitle exactly and strips the media suffix from the target', async () => {
    const root = await tempDir();
    const album = path.join(root, 'RJ01197709', '购买特典', 'MP3');
    await writeText(path.join(album, 'e35_08_track.mp3'), 'audio');
    await writeText(path.join(album, 'e35_08_track.mp3.vtt'), VTT);
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const pair = findPair(plan, 'e35_08_track.mp3');
    expect(pair.match).toBe('exact');
    expect(pair.targetBase).toBe('e35_08_track');
    expect(pair.subtitleOutputName).toBe('e35_08_track.lrc');
    expect(pair.subtitleRenameName).toBe('e35_08_track.vtt');
    expectPairInvariants(plan);
  });

  it('treats a .txt containing VTT as a subtitle and ignores a plain txt', async () => {
    const root = await tempDir();
    const album = path.join(root, 'RJ_test');
    await writeText(path.join(album, '01 story.mp3'), 'audio');
    await writeText(path.join(album, '01 story.txt'), VTT);
    await writeText(path.join(album, 'readme.txt'), '购买说明\n不含时间轴');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const pair = findPair(plan, '01 story.mp3');
    expect(pair.subtitle?.ext).toBe('txt');
    expect(pair.subtitleConvert).toBe(true);
    expect(pair.subtitleOutputName).toBe('01 story.lrc');
    expect(pair.subtitleRenameName).toBeNull();
    expect(pair.warnings.some((warning) => warning.code === 'txt-not-lyrics')).toBe(false);
    const folder = plan.folders.find((item) => item.folder === album);
    expect(folder?.warnings.some((warning) => warning.code === 'txt-not-lyrics')).toBe(true);
    expectPairInvariants(plan);
  });
});
describe('automatic cover selection', () => {
  it('picks a clearly named cover when autoPick is enabled', async () => {
    const root = await tempDir();
    const album = path.join(root, 'RJ_auto');
    await writeText(path.join(album, '01.wav'), 'audio');
    await writeText(path.join(album, '01.vtt'), VTT);
    await writeText(path.join(album, 'cover.jpg'), 'cover');
    await writeText(path.join(album, 'scene1.png'), 'scene');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.cover.autoPick = true;
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const folder = plan.folders.find((item) => item.folder === album);
    expect(folder?.cover?.image.name).toBe('cover.jpg');
    expect(folder?.cover?.action).toBe('none');
  });

  it('does not guess when there are many unnamed images', async () => {
    const root = await tempDir();
    const album = path.join(root, 'RJ_auto');
    await writeText(path.join(album, '01.wav'), 'audio');
    await writeText(path.join(album, '01.vtt'), VTT);
    await writeText(path.join(album, 'scene1.png'), 'scene');
    await writeText(path.join(album, 'scene2.png'), 'scene');
    const defaults = await import('@shared/defaults');
    const settings = defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
    settings.cover.autoPick = true;
    const plan = await buildPlan({ root, settings, manualPairs: [], coverChoices: [] }, fakeFfmpeg(false));
    const folder = plan.folders.find((item) => item.folder === album);
    expect(folder?.cover).toBeNull();
    expect(folder?.warnings.some((warning) => warning.code === 'cover-auto-skipped')).toBe(true);
  });
});
