import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPlan, listHistory, undoRunById, type ApplyContext } from '@core/apply';
import { detectFfmpeg, runFfmpeg } from '@core/ffmpeg';
import { buildPlan } from '@core/plan';
import type {
  ApplySelection,
  FfmpegInfo,
  PlanResult,
  ProgressEvent,
  Settings
} from '@shared/types';
import { createTempDir, fakeFfmpeg, fileExists, removeDir, writeText } from './helpers';

const temporaryDirectories: string[] = [];
const VTT = 'WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHello\r\n';

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) await removeDir(directory);
  }
});

interface Environment {
  base: string;
  root: string;
  dataDir: string;
  logsDir: string;
}

async function createEnvironment(): Promise<Environment> {
  const base = await createTempDir('sotto-apply-');
  temporaryDirectories.push(base);
  const root = path.join(base, 'library');
  const dataDir = path.join(base, 'data');
  const logsDir = path.join(base, 'logs');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });
  return { base, root, dataDir, logsDir };
}

async function defaultSettings(): Promise<Settings> {
  const defaults = await import('@shared/defaults');
  return defaults.cloneSettings(defaults.DEFAULT_SETTINGS);
}

function selectAll(): ApplySelection {
  return {
    pairIds: null,
    coverFolders: null,
    renameAudio: true,
    renameSubtitle: true,
    convertSubtitles: true,
    convertAudio: true,
    applyCovers: true
  };
}

interface RunOptions {
  ffmpeg?: FfmpegInfo;
  trashFile?: (target: string) => Promise<void>;
}

async function runApply(
  plan: PlanResult,
  selection: ApplySelection,
  environment: Environment,
  options: RunOptions = {}
): Promise<{ result: Awaited<ReturnType<typeof applyPlan>>; events: ProgressEvent[]; runId: string }> {
  const events: ProgressEvent[] = [];
  const runId = crypto.randomUUID();
  const ffmpeg = options.ffmpeg || fakeFfmpeg(false);
  const context: ApplyContext = {
    runId,
    ffmpeg,
    dataDir: environment.dataDir,
    logsDir: environment.logsDir,
    onProgress: (event) => events.push(event),
    trashFile: options.trashFile
  };
  const result = await applyPlan({ plan, selection }, context);
  return { result, events, runId };
}

async function buildFor(
  environment: Environment,
  settings: Settings,
  ffmpeg: FfmpegInfo = fakeFfmpeg(false),
  coverChoices: { folder: string; imagePath: string; convertToJpeg?: boolean }[] = []
): Promise<PlanResult> {
  return buildPlan(
    { root: environment.root, settings, manualPairs: [], coverChoices },
    ffmpeg
  );
}

describe('applyPlan rename and subtitle conversion', () => {
  it('renames, converts, journals and undoes a run', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    const subtitle = path.join(album, '01 雨夜.vtt');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(subtitle, VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    const pair = plan.folders[0].pairs[0];
    expect(pair.audioRenameNeeded).toBe(true);

    const { result, events, runId } = await runApply(plan, selectAll(), environment);

    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(1);
    expect(result.stats.subtitlesConverted).toBe(1);
    expect(result.stats.failed).toBe(0);
    expect(result.undoAvailable).toBe(true);
    expect(result.logPath).not.toBeNull();
    expect(await fileExists(result.logPath as string)).toBe(true);
    expect(await fileExists(originalAudio)).toBe(false);
    const renamedAudio = path.join(album, pair.renamedAudioName);
    expect(await fileExists(renamedAudio)).toBe(true);
    const lrc = path.join(album, pair.subtitleOutputName as string);
    expect(await fileExists(lrc)).toBe(true);
    const lrcText = await fs.readFile(lrc, 'utf8');
    expect(lrcText).toContain('[00:01.00]Hello');
    expect(lrcText).toContain('\r\n');

    expect(events.length).toBeGreaterThan(0);
    const finish = events[events.length - 1];
    expect(finish.phase).toBe('finish');
    expect(finish.overallPercent).toBe(100);

    const journalFile = path.join(environment.dataDir, 'runs', runId + '.json');
    const journal = JSON.parse(await fs.readFile(journalFile, 'utf8')) as {
      operations: { kind: string }[];
      status: string;
      undoAvailable: boolean;
    };
    expect(journal.status).toBe('success');
    expect(journal.undoAvailable).toBe(true);
    expect(journal.operations.map((operation) => operation.kind).sort()).toEqual([
      'create',
      'rename'
    ]);

    const history = await listHistory(environment.dataDir);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ runId, undoAvailable: true, status: 'success' });
    expect(history[0].undoneAt).toBeNull();

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(2);
    expect(undo.failed).toBe(0);
    expect(await fileExists(originalAudio)).toBe(true);
    expect(await fs.readFile(originalAudio, 'utf8')).toBe('audio-bytes');
    expect(await fileExists(lrc)).toBe(false);

    const afterUndo = await listHistory(environment.dataDir);
    expect(afterUndo[0].undoAvailable).toBe(false);
    expect(typeof afterUndo[0].undoneAt).toBe('number');

    const secondUndo = await undoRunById(runId, environment.dataDir);
    expect(secondUndo.status).toBe('failed');
    expect(secondUndo.message).toContain('已经撤销');
  });

  it('uses the system trash callback and marks undo unavailable', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    const subtitle = path.join(album, '01 雨夜.vtt');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(subtitle, VTT);
    const settings = await defaultSettings();
    settings.subtitle.deleteSource = true;
    const plan = await buildFor(environment, settings);
    const trashed: string[] = [];
    const { result, runId } = await runApply(plan, selectAll(), environment, {
      trashFile: async (target: string) => {
        trashed.push(target);
        await fs.unlink(target);
      }
    });

    expect(result.status).toBe('success');
    expect(trashed).toContain(subtitle);
    expect(result.undoAvailable).toBe(false);
    const history = await listHistory(environment.dataDir);
    expect(history[0].undoAvailable).toBe(false);

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('partial');
    expect(undo.failed).toBe(1);
    expect(undo.restored).toBe(2);
    expect(undo.items.some((item) => item.message.includes('无法恢复'))).toBe(true);
    expect(await fileExists(subtitle)).toBe(false);
  });

  it('falls back to a local trash directory that undo can restore', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    const subtitle = path.join(album, '01 雨夜.vtt');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(subtitle, VTT);
    const settings = await defaultSettings();
    settings.subtitle.deleteSource = true;
    const plan = await buildFor(environment, settings);
    const { result, runId } = await runApply(plan, selectAll(), environment);

    expect(result.undoAvailable).toBe(true);
    expect(await fileExists(subtitle)).toBe(false);
    const trashDirectory = path.join(environment.dataDir, 'trash', runId);
    const trashEntries = await fs.readdir(trashDirectory);
    expect(trashEntries).toHaveLength(1);

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(3);
    expect(await fileExists(subtitle)).toBe(true);
    expect(await fs.readFile(subtitle, 'utf8')).toBe(VTT);
  });

  it('never overwrites an unrelated file created after planning', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    const pair = plan.folders[0].pairs[0];
    const targetAudio = path.join(album, pair.renamedAudioName);
    await writeText(targetAudio, 'unrelated-content');

    const { result } = await runApply(plan, selectAll(), environment);
    const renameItem = result.items.find((item) => item.kind === 'rename-audio');
    expect(renameItem?.status).toBe('skipped');
    expect(renameItem?.message).toContain('已存在');
    expect(await fs.readFile(targetAudio, 'utf8')).toBe('unrelated-content');
    expect(await fileExists(originalAudio)).toBe(true);
    expect(result.status).toBe('success');

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fs.readFile(targetAudio, 'utf8')).toBe('unrelated-content');
    expect(await fileExists(originalAudio)).toBe(true);
  });

  it('backs up an existing LRC before overwriting and restores it on undo', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const audio = path.join(album, 'ep.wav');
    const subtitle = path.join(album, 'ep.vtt');
    const existingLrc = path.join(album, 'ep.lrc');
    await writeText(audio, 'audio');
    await writeText(subtitle, VTT);
    await writeText(existingLrc, '[00:00.00]OLD\r\n');
    const settings = await defaultSettings();
    const plan = await buildPlan(
      {
        root: environment.root,
        settings,
        manualPairs: [{ audioPath: audio, subtitlePath: subtitle }],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = plan.folders[0].pairs[0];
    expect(pair.subtitle?.name).toBe('ep.vtt');
    expect(pair.lrcWillOverwrite).toBe(true);
    expect(pair.existingLrc?.name).toBe('ep.lrc');

    const { result, runId } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(await fs.readFile(existingLrc, 'utf8')).toContain('[00:01.00]Hello');
    const backupDir = path.join(environment.dataDir, 'backups', runId);
    const backups = await fs.readdir(backupDir);
    expect(backups).toContain('ep.lrc');

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(2);
    expect(await fs.readFile(existingLrc, 'utf8')).toBe('[00:00.00]OLD\r\n');
  });

  it('renames a subtitle when conversion is disabled', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    await writeText(path.join(album, 'track.wav'), 'audio');
    const subtitle = path.join(album, 'weird-name.vtt');
    await writeText(subtitle, VTT);
    const settings = await defaultSettings();
    settings.subtitle.convertVtt = false;
    const plan = await buildFor(environment, settings);
    const pair = plan.folders[0].pairs[0];
    expect(pair.subtitleConvert).toBe(false);
    expect(pair.subtitleRenameName).toBe('track.vtt');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.items.some((item) => item.kind === 'rename-subtitle')).toBe(true);
    expect(await fileExists(subtitle)).toBe(false);
    const renamed = path.join(album, 'track.vtt');
    expect(await fileExists(renamed)).toBe(true);

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(subtitle)).toBe(true);
    expect(await fileExists(renamed)).toBe(false);
  });

  it('honours pair selection and operation flags', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    await writeText(path.join(album, 'a.wav'), 'a');
    await writeText(path.join(album, 'a.vtt'), VTT);
    await writeText(path.join(album, 'b.wav'), 'b');
    await writeText(path.join(album, 'b.vtt'), VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    expect(plan.folders[0].pairs).toHaveLength(2);
    const target = plan.folders[0].pairs[0];

    const { result } = await runApply(
      plan,
      {
        pairIds: [target.id],
        coverFolders: null,
        renameAudio: false,
        renameSubtitle: false,
        convertSubtitles: true,
        convertAudio: false,
        applyCovers: false
      },
      environment
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe('convert-subtitle');
    expect(await fileExists(path.join(album, 'a.lrc'))).toBe(true);
    expect(await fileExists(path.join(album, 'b.lrc'))).toBe(false);
  });
});

describe('applyPlan kept source subtitle renames', () => {
  function pairByAudioName(plan: PlanResult, audioName: string) {
    for (const folder of plan.folders) {
      for (const pair of folder.pairs) {
        if (pair.audio.name === audioName) return pair;
      }
    }
    throw new Error('pair not found: ' + audioName);
  }

  it('renames the kept source VTT in place while the LRC goes next to the audio', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    const originalAudio = path.join(album, '【简体】01 雨夜♡.wav');
    const originalSource = path.join(subtitleFolder, '01 雨夜 原版.vtt');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(originalSource, VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    const pair = pairByAudioName(plan, '【简体】01 雨夜♡.wav');
    expect(pair.subtitleRenameName).toBe('【简体】01 雨夜.vtt');
    expect(pair.renamedAudioName).toBe('【简体】01 雨夜.wav');
    expect(pair.subtitleOutputName).toBe('【简体】01 雨夜.lrc');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(2);
    expect(result.stats.subtitlesConverted).toBe(1);
    expect(result.items.map((item) => item.kind).sort()).toEqual([
      'convert-subtitle',
      'rename-audio',
      'rename-subtitle'
    ]);

    const renamedAudio = path.join(album, pair.renamedAudioName);
    const lrc = path.join(album, pair.subtitleOutputName as string);
    const renamedSource = path.join(subtitleFolder, pair.subtitleRenameName as string);
    expect(await fileExists(renamedAudio)).toBe(true);
    expect(await fileExists(lrc)).toBe(true);
    expect(await fileExists(renamedSource)).toBe(true);
    expect(await fileExists(originalSource)).toBe(false);
    expect(await fileExists(path.join(album, pair.subtitleRenameName as string))).toBe(false);
    expect(await fs.readFile(renamedSource, 'utf8')).toContain('Hello');

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(3);
    expect(await fileExists(originalAudio)).toBe(true);
    expect(await fileExists(originalSource)).toBe(true);
    expect(await fileExists(lrc)).toBe(false);
    expect(await fileExists(renamedSource)).toBe(false);
  });

  it('skips the kept source rename on a directory collision and still produces the LRC', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    const audio = path.join(album, '01 雨夜.wav');
    const source = path.join(subtitleFolder, '01 雨夜 原版.vtt');
    const occupied = path.join(subtitleFolder, '01 雨夜.vtt');
    await writeText(audio, 'audio');
    await writeText(source, VTT);
    await writeText(occupied, 'unrelated-vtt');
    const settings = await defaultSettings();
    const plan = await buildPlan(
      {
        root: environment.root,
        settings,
        manualPairs: [{ audioPath: audio, subtitlePath: source }],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = pairByAudioName(plan, '01 雨夜.wav');
    expect(pair.subtitleRenameName).toBeNull();
    expect(pair.warnings.some((warning) => warning.code === 'source-rename-skipped')).toBe(true);

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.items.map((item) => item.kind)).toEqual(['convert-subtitle']);
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
    expect(await fileExists(source)).toBe(true);
    expect(await fs.readFile(occupied, 'utf8')).toBe('unrelated-vtt');

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(false);
    expect(await fileExists(source)).toBe(true);
    expect(await fs.readFile(occupied, 'utf8')).toBe('unrelated-vtt');
  });

  it('skips the source rename if the target appears after planning', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    await writeText(path.join(album, '01 雨夜.wav'), 'audio');
    const source = path.join(subtitleFolder, '01 雨夜 原版.vtt');
    await writeText(source, VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    const pair = pairByAudioName(plan, '01 雨夜.wav');
    expect(pair.subtitleRenameName).toBe('01 雨夜.vtt');

    const racedTarget = path.join(subtitleFolder, '01 雨夜.vtt');
    await writeText(racedTarget, 'late-unrelated-vtt');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.stats.skipped).toBe(1);
    const renameItem = result.items.find((item) => item.kind === 'rename-subtitle');
    expect(renameItem?.status).toBe('skipped');
    expect(renameItem?.message).toContain('已存在');
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
    expect(await fileExists(source)).toBe(true);
    expect(await fs.readFile(racedTarget, 'utf8')).toBe('late-unrelated-vtt');
  });

  it('renames a cross-folder VTT in place when conversion is disabled', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    const audio = path.join(album, 'track.wav');
    const source = path.join(subtitleFolder, 'old-name.vtt');
    await writeText(audio, 'audio');
    await writeText(source, VTT);
    const settings = await defaultSettings();
    settings.subtitle.convertVtt = false;
    const plan = await buildPlan(
      {
        root: environment.root,
        settings,
        manualPairs: [{ audioPath: audio, subtitlePath: source }],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = pairByAudioName(plan, 'track.wav');
    expect(pair.subtitleConvert).toBe(false);
    expect(pair.subtitleRenameName).toBe('track.vtt');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.items.some((item) => item.kind === 'rename-subtitle')).toBe(true);
    const renamed = path.join(subtitleFolder, 'track.vtt');
    expect(await fileExists(renamed)).toBe(true);
    expect(await fileExists(path.join(album, 'track.vtt'))).toBe(false);

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(source)).toBe(true);
    expect(await fileExists(renamed)).toBe(false);
  });

  it('renames a kept cross-folder LRC in place instead of moving it', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const subtitleFolder = path.join(album, '字幕');
    const audio = path.join(album, 'track.wav');
    const source = path.join(subtitleFolder, 'old-name.lrc');
    await writeText(audio, 'audio');
    await writeText(source, '[00:01.00]Hello\r\n');
    const settings = await defaultSettings();
    const plan = await buildPlan(
      {
        root: environment.root,
        settings,
        manualPairs: [{ audioPath: audio, subtitlePath: source }],
        coverChoices: []
      },
      fakeFfmpeg(false)
    );
    const pair = pairByAudioName(plan, 'track.wav');
    expect(pair.subtitleConvert).toBe(false);
    expect(pair.subtitleRenameName).toBe('track.lrc');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    const renamed = path.join(subtitleFolder, 'track.lrc');
    expect(await fileExists(renamed)).toBe(true);
    expect(await fileExists(path.join(album, 'track.lrc'))).toBe(false);

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(source)).toBe(true);
  });
});

describe('applyPlan covers and audio', () => {
  it('moves a cover and restores it on undo', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    await writeText(path.join(album, 'track.wav'), 'audio');
    const image = path.join(album, 'art.png');
    await writeText(image, 'png');
    const settings = await defaultSettings();
    settings.cover.convertToJpeg = false;
    const plan = await buildFor(environment, settings, fakeFfmpeg(false), [
      { folder: album, imagePath: image }
    ]);
    expect(plan.folders[0].cover?.action).toBe('move');

    const { result } = await runApply(
      plan,
      {
        pairIds: null,
        coverFolders: null,
        renameAudio: false,
        renameSubtitle: false,
        convertSubtitles: false,
        convertAudio: false,
        applyCovers: true
      },
      environment
    );
    expect(result.stats.covers).toBe(1);
    expect(await fileExists(image)).toBe(false);
    expect(await fileExists(path.join(album, 'cover.png'))).toBe(true);

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(image)).toBe(true);
    expect(await fileExists(path.join(album, 'cover.png'))).toBe(false);
  });

  it('skips cover actions when the target exists and overwrite is off', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    await writeText(path.join(album, 'track.wav'), 'audio');
    const image = path.join(album, 'art.png');
    await writeText(image, 'png');
    await writeText(path.join(album, 'cover.png'), 'existing-cover');
    const settings = await defaultSettings();
    settings.cover.convertToJpeg = false;
    settings.cover.overwrite = false;
    const plan = await buildFor(environment, settings, fakeFfmpeg(false), [
      { folder: album, imagePath: image }
    ]);
    expect(plan.folders[0].cover?.existingTarget?.name).toBe('cover.png');

    const { result } = await runApply(
      plan,
      {
        pairIds: null,
        coverFolders: null,
        renameAudio: false,
        renameSubtitle: false,
        convertSubtitles: false,
        convertAudio: false,
        applyCovers: true
      },
      environment
    );
    expect(result.stats.skipped).toBe(1);
    expect(result.undoAvailable).toBe(false);
    expect(await fs.readFile(path.join(album, 'cover.png'), 'utf8')).toBe('existing-cover');
    expect(await fileExists(image)).toBe(true);
  });

  it('backs up and overwrites an existing cover when overwrite is enabled', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    await writeText(path.join(album, 'track.wav'), 'audio');
    const image = path.join(album, 'art.png');
    await writeText(image, 'new-cover');
    const existing = path.join(album, 'cover.png');
    await writeText(existing, 'old-cover');
    const settings = await defaultSettings();
    settings.cover.convertToJpeg = false;
    settings.cover.overwrite = true;
    const plan = await buildFor(environment, settings, fakeFfmpeg(false), [
      { folder: album, imagePath: image }
    ]);
    expect(plan.folders[0].cover?.overwrite).toBe(true);

    const { result } = await runApply(
      plan,
      {
        pairIds: null,
        coverFolders: null,
        renameAudio: false,
        renameSubtitle: false,
        convertSubtitles: false,
        convertAudio: false,
        applyCovers: true
      },
      environment
    );
    expect(result.stats.covers).toBe(1);
    expect(await fs.readFile(existing, 'utf8')).toBe('new-cover');
    expect(await fileExists(image)).toBe(false);

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(2);
    expect(await fs.readFile(existing, 'utf8')).toBe('old-cover');
    expect(await fs.readFile(image, 'utf8')).toBe('new-cover');
  });

  it('converts audio and covers with ffmpeg when available', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const source = path.join(album, 'tone.wav');
    const generated = await runFfmpeg(detected.path, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.4',
      '-c:a',
      'pcm_s16le',
      source
    ]);
    if (!generated.ok) return;

    const coverSource = path.join(album, 'art.png');
    const coverGenerated = await runFfmpeg(detected.path, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=32x32:d=1',
      '-frames:v',
      '1',
      coverSource
    ]);
    if (!coverGenerated.ok) return;

    const settings = await defaultSettings();
    settings.naming.renameAudioWithoutSubtitle = true;
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    settings.convert.bitrateKbps = 128;
    const plan = await buildFor(environment, settings, detected, [
      { folder: album, imagePath: coverSource }
    ]);
    const pair = plan.folders[0].pairs[0];
    expect(pair.audioConversion?.skipReason).toBeNull();
    expect(plan.folders[0].cover?.action).toBe('convert');

    const { result, runId } = await runApply(plan, selectAll(), environment, {
      ffmpeg: detected
    });
    expect(result.status).toBe('success');
    expect(result.stats.audioConverted).toBe(1);
    expect(result.stats.covers).toBe(1);
    const converted = path.join(album, pair.audioConversion?.outputName as string);
    expect(await fileExists(converted)).toBe(true);
    const stat = await fs.stat(converted);
    expect(stat.size).toBeGreaterThan(0);
    expect(await fileExists(source)).toBe(true);
    const coverJpeg = path.join(album, 'cover.jpg');
    expect(await fileExists(coverJpeg)).toBe(true);
    expect((await fs.stat(coverJpeg)).size).toBeGreaterThan(0);

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(converted)).toBe(false);
    expect(await fileExists(coverJpeg)).toBe(false);
    expect(await fileExists(source)).toBe(true);
    expect(await fileExists(coverSource)).toBe(true);
  });
});

describe('applyPlan audio deleteOriginal', () => {
  it('trashes the original only after a successful conversion and disables undo', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const source = path.join(album, 'tone.wav');
    const generated = await runFfmpeg(detected.path, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.3',
      '-c:a',
      'pcm_s16le',
      source
    ]);
    if (!generated.ok) return;

    const settings = await defaultSettings();
    settings.naming.renameAudioWithoutSubtitle = true;
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    settings.convert.deleteOriginal = true;
    const plan = await buildFor(environment, settings, detected);
    const pair = plan.folders[0].pairs[0];
    expect(pair.audioConversion?.deleteOriginal).toBe(true);

    const trashed: string[] = [];
    const { result, runId } = await runApply(plan, selectAll(), environment, {
      ffmpeg: detected,
      trashFile: async (target: string) => {
        trashed.push(target);
        await fs.unlink(target);
      }
    });

    expect(result.status).toBe('success');
    expect(result.stats.audioConverted).toBe(1);
    expect(trashed).toContain(source);
    expect(await fileExists(source)).toBe(false);
    expect(result.undoAvailable).toBe(false);
    const converted = path.join(album, pair.audioConversion?.outputName as string);
    expect(await fileExists(converted)).toBe(true);

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('partial');
    expect(undo.failed).toBe(1);
    expect(await fileExists(converted)).toBe(false);
    expect(await fileExists(source)).toBe(false);
  });
});

describe('applyPlan audio rename vs conversion', () => {
  function pairForAudio(plan: PlanResult, audioName: string) {
    for (const folder of plan.folders) {
      for (const pair of folder.pairs) {
        if (pair.audio.name === audioName) return pair;
      }
    }
    throw new Error('pair not found: ' + audioName);
  }

  async function generateTone(target: string, ffmpegPath: string, duration = 0.3): Promise<boolean> {
    const result = await runFfmpeg(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=' + duration,
      '-c:a',
      'pcm_s16le',
      target
    ]);
    return result.ok;
  }

  it('renames the original and keeps it alongside the converted output', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    if (!(await generateTone(originalAudio, detected.path))) return;
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    settings.convert.bitrateKbps = 128;
    const plan = await buildFor(environment, settings, detected);
    const pair = pairForAudio(plan, '01 雨夜♡.wav');
    expect(pair.renamedAudioName).toBe('01 雨夜.wav');
    expect(pair.audioRenameNeeded).toBe(true);
    expect(pair.audioConversion?.outputName).toBe('01 雨夜.mp3');

    const { result, runId } = await runApply(plan, selectAll(), environment, {
      ffmpeg: detected
    });
    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(1);
    expect(result.stats.audioConverted).toBe(1);
    expect(result.stats.subtitlesConverted).toBe(1);

    const renamedOriginal = path.join(album, '01 雨夜.wav');
    const converted = path.join(album, '01 雨夜.mp3');
    const lrc = path.join(album, '01 雨夜.lrc');
    expect(await fileExists(renamedOriginal)).toBe(true);
    expect(await fileExists(converted)).toBe(true);
    expect(await fileExists(lrc)).toBe(true);
    expect(await fileExists(originalAudio)).toBe(false);

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(undo.restored).toBe(3);
    expect(await fileExists(originalAudio)).toBe(true);
    expect(await fileExists(renamedOriginal)).toBe(false);
    expect(await fileExists(converted)).toBe(false);
    expect(await fileExists(lrc)).toBe(false);
  });

  it('trashes the renamed original after conversion when deleteOriginal is on', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    if (!(await generateTone(originalAudio, detected.path))) return;
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    settings.convert.deleteOriginal = true;
    const plan = await buildFor(environment, settings, detected);
    const pair = pairForAudio(plan, '01 雨夜♡.wav');

    const trashed: string[] = [];
    const { result, runId } = await runApply(plan, selectAll(), environment, {
      ffmpeg: detected,
      trashFile: async (target: string) => {
        trashed.push(target);
        await fs.unlink(target);
      }
    });
    expect(result.status).toBe('success');
    expect(result.stats.audioConverted).toBe(1);
    expect(result.undoAvailable).toBe(false);
    const renamedOriginal = path.join(album, pair.renamedAudioName);
    expect(trashed).toContain(renamedOriginal);
    expect(await fileExists(renamedOriginal)).toBe(false);
    expect(await fileExists(originalAudio)).toBe(false);
    expect(await fileExists(path.join(album, pair.audioConversion?.outputName as string))).toBe(
      true
    );

    // The system trash cannot be reversed: removing the created outputs succeeds, but the
    // renamed (then trashed) original cannot be restored, so undo is partial.
    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('partial');
    expect(undo.failed).toBe(2);
    expect(undo.restored).toBe(2);
    expect(await fileExists(originalAudio)).toBe(false);
  });

  it('renames the original without converting when convertAudio is off', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildFor(environment, settings, fakeFfmpeg(true));
    const pair = pairForAudio(plan, '01 雨夜♡.wav');
    expect(pair.audioConversion).not.toBeNull();

    const { result } = await runApply(
      plan,
      {
        pairIds: null,
        coverFolders: null,
        renameAudio: true,
        renameSubtitle: true,
        convertSubtitles: true,
        convertAudio: false,
        applyCovers: false
      },
      environment
    );
    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(1);
    expect(result.stats.subtitlesConverted).toBe(1);
    expect(result.stats.audioConverted).toBe(0);
    expect(await fileExists(path.join(album, '01 雨夜.wav'))).toBe(true);
    expect(await fileExists(originalAudio)).toBe(false);
    expect(await fileExists(path.join(album, '01 雨夜.mp3'))).toBe(false);
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
  });

  it('converts from the original when renameAudio is off', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    if (!(await generateTone(originalAudio, detected.path))) return;
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildFor(environment, settings, detected);

    const { result } = await runApply(
      plan,
      {
        pairIds: null,
        coverFolders: null,
        renameAudio: false,
        renameSubtitle: true,
        convertSubtitles: true,
        convertAudio: true,
        applyCovers: false
      },
      environment
    );
    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(0);
    expect(result.stats.audioConverted).toBe(1);
    expect(await fileExists(originalAudio)).toBe(true);
    expect(await fileExists(path.join(album, '01 雨夜.wav'))).toBe(false);
    expect(await fileExists(path.join(album, '01 雨夜.mp3'))).toBe(true);
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
  });

  it('still renames the original when the conversion output is skipped', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    const existingOutput = path.join(album, '01 雨夜.mp3');
    await writeText(originalAudio, 'audio-bytes');
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    await writeText(existingOutput, 'existing-mp3');
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildPlan(
      {
        root: environment.root,
        settings,
        manualPairs: [
          {
            audioPath: originalAudio,
            subtitlePath: path.join(album, '01 雨夜.vtt')
          }
        ],
        coverChoices: []
      },
      fakeFfmpeg(true)
    );
    const pair = pairForAudio(plan, '01 雨夜♡.wav');
    expect(pair.audioConversion?.skipReason).toBe('目标音频文件已存在');
    expect(pair.renamedAudioName).toBe('01 雨夜.wav');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(result.stats.renamed).toBe(1);
    expect(result.stats.audioConverted).toBe(0);
    expect(await fileExists(path.join(album, '01 雨夜.wav'))).toBe(true);
    expect(await fileExists(originalAudio)).toBe(false);
    expect(await fs.readFile(existingOutput, 'utf8')).toBe('existing-mp3');
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
  });

  it('leaves the renamed original when the conversion fails', async () => {
    const detected = await detectFfmpeg();
    if (!detected.available) return;
    const environment = await createEnvironment();
    const album = path.join(environment.root, 'album');
    const originalAudio = path.join(album, '01 雨夜♡.wav');
    await writeText(originalAudio, 'not-really-audio');
    await writeText(path.join(album, '01 雨夜.vtt'), VTT);
    const settings = await defaultSettings();
    settings.convert.enabled = true;
    settings.convert.format = 'mp3';
    settings.convert.formats = ['wav'];
    const plan = await buildFor(environment, settings, detected);
    const pair = pairForAudio(plan, '01 雨夜♡.wav');

    const { result } = await runApply(plan, selectAll(), environment, {
      ffmpeg: detected
    });
    expect(result.status).toBe('partial');
    expect(result.stats.failed).toBe(1);
    expect(result.stats.audioConverted).toBe(0);
    expect(await fileExists(originalAudio)).toBe(false);
    const renamedOriginal = path.join(album, pair.renamedAudioName);
    expect(await fileExists(renamedOriginal)).toBe(true);
    expect(await fs.readFile(renamedOriginal, 'utf8')).toBe('not-really-audio');
    expect(await fileExists(path.join(album, '01 雨夜.mp3'))).toBe(false);
    expect(await fileExists(path.join(album, '01 雨夜.lrc'))).toBe(true);
  });
});

describe('undo edge cases', () => {
  it('keeps a run retryable when undo restores nothing', async () => {
    const environment = await createEnvironment();
    const runId = 'manual-run';
    const original = path.join(environment.root, 'original.wav');
    const renamed = path.join(environment.root, 'renamed.wav');
    await writeText(renamed, 'renamed');
    await writeText(original, 'conflict');
    const stats = {
      renamed: 1,
      subtitlesConverted: 0,
      audioConverted: 0,
      covers: 0,
      failed: 0,
      skipped: 0,
      bytesBefore: 0,
      bytesAfter: 0
    };
    const journal = {
      version: 1,
      runId,
      root: environment.root,
      rootName: 'library',
      startedAt: 1,
      finishedAt: 2,
      status: 'success',
      stats,
      undoAvailable: true,
      undoneAt: null,
      logPath: null,
      operations: [
        {
          kind: 'rename',
          item: 'rename-audio',
          from: original,
          to: renamed,
          undoable: true,
          at: 2,
          message: 'rename'
        }
      ],
      items: []
    };
    await writeText(
      path.join(environment.dataDir, 'runs', runId + '.json'),
      JSON.stringify(journal)
    );

    const undo = await undoRunById(runId, environment.dataDir);
    expect(undo.status).toBe('failed');
    expect(undo.message).toContain('重试');
    const afterFailure = JSON.parse(
      await fs.readFile(path.join(environment.dataDir, 'runs', runId + '.json'), 'utf8')
    ) as { undoneAt: number | null };
    expect(afterFailure.undoneAt).toBeNull();

    await fs.unlink(original);
    const retry = await undoRunById(runId, environment.dataDir);
    expect(retry.status).toBe('success');
    expect(await fileExists(original)).toBe(true);
    const history = await listHistory(environment.dataDir);
    expect(history[0].runId).toBe(runId);
    expect(typeof history[0].undoneAt).toBe('number');
  });
});

describe('history', () => {
  it('returns an empty list for missing or corrupt history', async () => {
    const environment = await createEnvironment();
    expect(await listHistory(environment.dataDir)).toEqual([]);
    await writeText(path.join(environment.dataDir, 'history.json'), '{not json');
    expect(await listHistory(environment.dataDir)).toEqual([]);
  });

  it('keeps newest runs first', async () => {
    const firstEnvironment = await createEnvironment();
    const secondEnvironment = await createEnvironment();
    const settings = await defaultSettings();

    const firstRoot = path.join(firstEnvironment.root, 'one');
    await writeText(path.join(firstRoot, 'a.wav'), 'a');
    await writeText(path.join(firstRoot, 'a.vtt'), VTT);
    const firstPlan = await buildFor(firstEnvironment, settings);
    const first = await runApply(firstPlan, selectAll(), firstEnvironment);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondRoot = path.join(secondEnvironment.root, 'two');
    await writeText(path.join(secondRoot, 'b.wav'), 'b');
    await writeText(path.join(secondRoot, 'b.vtt'), VTT);
    const secondPlan = await buildPlan(
      { root: secondEnvironment.root, settings, manualPairs: [], coverChoices: [] },
      fakeFfmpeg(false)
    );
    const second = await runApply(secondPlan, selectAll(), firstEnvironment);

    const history = await listHistory(firstEnvironment.dataDir);
    expect(history).toHaveLength(2);
    expect(history[0].runId).toBe(second.runId);
    expect(history[1].runId).toBe(first.runId);
  });
});
describe('applyPlan TXT subtitles', () => {
  it('converts a .txt with VTT content, renames it in place and undoes cleanly', async () => {
    const environment = await createEnvironment();
    const album = path.join(environment.root, '专辑');
    const audio = path.join(album, '01 story.mp3');
    const source = path.join(album, '01 story 原稿.txt');
    await writeText(audio, 'audio');
    await writeText(source, VTT);
    const settings = await defaultSettings();
    const plan = await buildFor(environment, settings);
    const pair = plan.folders[0].pairs[0];
    expect(pair.subtitle?.ext).toBe('txt');
    expect(pair.subtitleConvert).toBe(true);
    expect(pair.subtitleRenameName).toBe('01 story.txt');
    expect(pair.subtitleOutputName).toBe('01 story.lrc');

    const { result } = await runApply(plan, selectAll(), environment);
    expect(result.status).toBe('success');
    expect(await fileExists(source)).toBe(false);
    const renamed = path.join(album, '01 story.txt');
    expect(await fileExists(renamed)).toBe(true);
    const lrc = path.join(album, '01 story.lrc');
    expect(await fileExists(lrc)).toBe(true);
    expect(await fs.readFile(lrc, 'utf8')).toContain('[00:01.00]Hello');

    const undo = await undoRunById(undefined, environment.dataDir);
    expect(undo.status).toBe('success');
    expect(await fileExists(source)).toBe(true);
    expect(await fileExists(renamed)).toBe(false);
    expect(await fileExists(lrc)).toBe(false);
  });
});
