import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ApplyItem,
  ApplyItemKind,
  ApplyRequest,
  ApplyResult,
  ApplyStats,
  FfmpegInfo,
  FolderPlan,
  PairPlan,
  ProgressEvent,
  ProgressPhase,
  RunRecord,
  UndoResult
} from '@shared/types';
import { runFfmpeg } from './ffmpeg';
import { convertSubtitleFile } from './subtitle';
import {
  ensureDir,
  fileSize,
  moveFile,
  nextAvailablePath,
  pathExists,
  samePath,
  toPathKey,
  uniqueTempPath,
  writeFileAtomic
} from './util';

export interface ApplyContext {
  runId: string;
  ffmpeg: FfmpegInfo;
  dataDir: string;
  logsDir: string;
  onProgress: (event: ProgressEvent) => void;
  trashFile?: (targetPath: string) => Promise<void>;
}

type JournalOperationKind = 'rename' | 'create' | 'backup' | 'trash';

interface JournalOperation {
  kind: JournalOperationKind;
  item: ApplyItemKind;
  from: string | null;
  to: string | null;
  undoable: boolean;
  at: number;
  message: string;
}

interface RunJournal {
  version: 1;
  runId: string;
  root: string;
  rootName: string;
  startedAt: number;
  finishedAt: number | null;
  status: ApplyResult['status'] | 'running';
  stats: ApplyStats;
  undoAvailable: boolean;
  undoneAt: number | null;
  logPath: string | null;
  operations: JournalOperation[];
  items: ApplyItem[];
}

type TaskType =
  | 'rename-audio'
  | 'rename-subtitle'
  | 'rename-subtitle-source'
  | 'convert-subtitle'
  | 'delete-subtitle-source'
  | 'convert-audio'
  | 'delete-audio-original'
  | 'cover';

interface ApplyTask {
  type: TaskType;
  pair: PairPlan | null;
  folder: FolderPlan | null;
  phase: ProgressPhase;
  label: string;
}

type TaskStatus = 'success' | 'failed' | 'skipped';

interface TaskOutcome {
  status: TaskStatus;
  itemKind: ApplyItemKind;
  message: string;
  from: string | null;
  to: string | null;
  bytesAdded: number;
  bytesRemoved: number;
  operations: JournalOperation[];
}

interface ExecutionState {
  ctx: ApplyContext;
  settings: ApplyRequest['plan']['settingsSnapshot'];
  operations: JournalOperation[];
  convertedSubtitles: Set<string>;
  renamedAudio: Set<string>;
  renameAudioSelected: boolean;
  convertedAudio: Map<string, string>;
}

const HISTORY_FILE = 'history.json';
const RUNS_DIRECTORY = 'runs';
const BACKUPS_DIRECTORY = 'backups';
const TRASH_DIRECTORY = 'trash';
const MAX_HISTORY_RECORDS = 200;

function emptyStats(): ApplyStats {
  return {
    renamed: 0,
    subtitlesConverted: 0,
    audioConverted: 0,
    covers: 0,
    failed: 0,
    skipped: 0,
    bytesBefore: 0,
    bytesAfter: 0
  };
}

function historyPath(dataDir: string): string {
  return path.join(dataDir, HISTORY_FILE);
}

function journalPath(dataDir: string, runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(dataDir, RUNS_DIRECTORY, safe + '.json');
}

function logPathFor(ctx: ApplyContext): string {
  const safe = ctx.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(ctx.logsDir, 'apply-' + safe + '.log');
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function tailText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(trimmed.length - maxLength);
}

async function loadJsonFile<T>(target: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(target, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function saveJournal(dataDir: string, journal: RunJournal): Promise<void> {
  try {
    await ensureDir(path.join(dataDir, RUNS_DIRECTORY));
    await writeFileAtomic(journalPath(dataDir, journal.runId), JSON.stringify(journal, null, 2));
  } catch {
    // Journal persistence is best-effort; the run still proceeds.
  }
}

async function loadJournal(dataDir: string, runId: string): Promise<RunJournal | null> {
  const parsed = await loadJsonFile<RunJournal>(journalPath(dataDir, runId));
  if (!parsed || parsed.runId !== runId || !Array.isArray(parsed.operations)) return null;
  return parsed;
}

function normalizeRecord(value: unknown): RunRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<RunRecord>;
  if (typeof record.runId !== 'string' || typeof record.root !== 'string') return null;
  const stats = record.stats && typeof record.stats === 'object' ? record.stats : emptyStats();
  return {
    runId: record.runId,
    root: record.root,
    rootName: typeof record.rootName === 'string' ? record.rootName : '',
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : 0,
    finishedAt: typeof record.finishedAt === 'number' ? record.finishedAt : 0,
    status:
      record.status === 'partial' || record.status === 'failed' ? record.status : 'success',
    stats: stats as ApplyStats,
    undoAvailable: Boolean(record.undoAvailable),
    undoneAt: typeof record.undoneAt === 'number' ? record.undoneAt : null
  };
}

async function readHistoryRecords(dataDir: string): Promise<RunRecord[]> {
  const parsed = await loadJsonFile<unknown>(historyPath(dataDir));
  if (!parsed) return [];
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { runs?: unknown }).runs)
      ? (parsed as { runs: unknown[] }).runs
      : [];
  const records: RunRecord[] = [];
  for (const value of list) {
    const record = normalizeRecord(value);
    if (record) records.push(record);
  }
  records.sort((left, right) => right.startedAt - left.startedAt);
  return records.slice(0, MAX_HISTORY_RECORDS);
}

async function writeHistoryRecords(dataDir: string, records: RunRecord[]): Promise<void> {
  try {
    await ensureDir(dataDir);
    const sorted = [...records].sort((left, right) => right.startedAt - left.startedAt);
    await writeFileAtomic(
      historyPath(dataDir),
      JSON.stringify(sorted.slice(0, MAX_HISTORY_RECORDS), null, 2)
    );
  } catch {
    // History failure must not fail a completed run.
  }
}

async function upsertHistoryRecord(dataDir: string, record: RunRecord): Promise<void> {
  const records = await readHistoryRecords(dataDir);
  const index = records.findIndex((item) => item.runId === record.runId);
  if (index >= 0) records[index] = record;
  else records.unshift(record);
  await writeHistoryRecords(dataDir, records);
}

function emitProgress(
  ctx: ApplyContext,
  phase: ProgressPhase,
  current: number,
  total: number,
  message: string,
  detail: string | null,
  level: 'info' | 'warn' | 'error'
): void {
  const percent = total > 0 ? Math.min(99, Math.max(0, Math.round((current / total) * 100))) : 0;
  const event: ProgressEvent = {
    runId: ctx.runId,
    phase,
    current,
    total,
    overallPercent: percent,
    message,
    detail,
    level,
    at: Date.now()
  };
  try {
    ctx.onProgress(event);
  } catch {
    // Progress listeners must never break an apply run.
  }
}

function emitFinish(
  ctx: ApplyContext,
  total: number,
  message: string,
  level: 'info' | 'warn' | 'error'
): void {
  const event: ProgressEvent = {
    runId: ctx.runId,
    phase: 'finish',
    current: total,
    total,
    overallPercent: 100,
    message,
    detail: null,
    level,
    at: Date.now()
  };
  try {
    ctx.onProgress(event);
  } catch {
    // Ignore listener failures.
  }
}

function taskLabel(task: ApplyTask): string {
  return task.label;
}

function buildTasks(plan: ApplyRequest['plan'], selection: ApplyRequest['selection']): ApplyTask[] {
  const tasks: ApplyTask[] = [];
  const pairIds = selection.pairIds == null ? null : new Set(selection.pairIds);
  const coverFolders =
    selection.coverFolders == null
      ? null
      : new Set(selection.coverFolders.map((value) => toPathKey(value)));
  const renameAudio = Boolean(selection.renameAudio);
  const renameSubtitle = Boolean(selection.renameSubtitle);
  const convertSubtitles = Boolean(selection.convertSubtitles);
  const convertAudio = Boolean(selection.convertAudio);
  const applyCovers = Boolean(selection.applyCovers);

  for (const folder of plan.folders) {
    for (const pair of folder.pairs) {
      if (pairIds && !pairIds.has(pair.id)) continue;
      if (renameAudio && pair.audioRenameNeeded) {
        tasks.push({
          type: 'rename-audio',
          pair,
          folder,
          phase: 'rename',
          label: '重命名音频：' + pair.audio.name + ' → ' + pair.renamedAudioName
        });
      }
      if (pair.subtitle) {
        if (convertSubtitles && pair.subtitleConvert) {
          tasks.push({
            type: 'convert-subtitle',
            pair,
            folder,
            phase: 'subtitle',
            label: '转换字幕：' + pair.subtitle.name + ' → ' + (pair.subtitleOutputName || '')
          });
          if (pair.subtitleDeleteSource) {
            tasks.push({
              type: 'delete-subtitle-source',
              pair,
              folder,
              phase: 'subtitle',
              label: '移走源字幕：' + pair.subtitle.name
            });
          } else if (pair.subtitleRenameName) {
            tasks.push({
              type: 'rename-subtitle-source',
              pair,
              folder,
              phase: 'subtitle',
              label: '就地重命名字幕源文件：' + pair.subtitle.name + ' → ' + pair.subtitleRenameName
            });
          }
        } else if (!pair.subtitleConvert && renameSubtitle && pair.subtitleRenameName) {
          tasks.push({
            type: 'rename-subtitle',
            pair,
            folder,
            phase: 'rename',
            label: '重命名字幕：' + pair.subtitle.name + ' → ' + pair.subtitleRenameName
          });
        }
      }
      if (convertAudio && pair.audioConversion && !pair.audioConversion.skipReason) {
        tasks.push({
          type: 'convert-audio',
          pair,
          folder,
          phase: 'audio',
          label: '转换音频：' + pair.audio.name + ' → ' + pair.audioConversion.outputName
        });
        if (pair.audioConversion.deleteOriginal) {
          tasks.push({
            type: 'delete-audio-original',
            pair,
            folder,
            phase: 'audio',
            label:
              '移走转换后的原始音频：' +
              (pair.audioRenameNeeded ? pair.renamedAudioName : pair.audio.name)
          });
        }
      }
    }
    if (applyCovers && folder.cover && folder.cover.action !== 'none') {
      if (coverFolders && !coverFolders.has(toPathKey(folder.folder))) continue;
      tasks.push({
        type: 'cover',
        pair: null,
        folder,
        phase: 'cover',
        label:
          folder.cover.action === 'convert'
            ? '转换封面：' + folder.cover.image.name + ' → ' + folder.cover.targetName
            : '移动封面：' + folder.cover.image.name + ' → ' + folder.cover.targetName
      });
    }
  }
  return tasks;
}

function taskSource(task: ApplyTask): { path: string; size: number } | null {
  if (task.type === 'cover' && task.folder && task.folder.cover) {
    return { path: task.folder.cover.image.path, size: task.folder.cover.image.size };
  }
  const pair = task.pair;
  if (!pair) return null;
  if (task.type === 'rename-audio' || task.type === 'convert-audio' || task.type === 'delete-audio-original') {
    return { path: pair.audio.path, size: pair.audio.size };
  }
  if (pair.subtitle) return { path: pair.subtitle.path, size: pair.subtitle.size };
  return null;
}

function makeOperation(
  kind: JournalOperationKind,
  item: ApplyItemKind,
  from: string | null,
  to: string | null,
  undoable: boolean,
  message: string
): JournalOperation {
  return { kind, item, from, to, undoable, at: Date.now(), message };
}

function outcome(
  status: TaskStatus,
  itemKind: ApplyItemKind,
  message: string,
  from: string | null,
  to: string | null,
  options?: {
    bytesAdded?: number;
    bytesRemoved?: number;
    operations?: JournalOperation[];
  }
): TaskOutcome {
  return {
    status,
    itemKind,
    message,
    from,
    to,
    bytesAdded: options && options.bytesAdded ? options.bytesAdded : 0,
    bytesRemoved: options && options.bytesRemoved ? options.bytesRemoved : 0,
    operations: options && options.operations ? options.operations : []
  };
}

async function twoPhaseRename(source: string, target: string): Promise<void> {
  if (source === target) return;
  await ensureDir(path.dirname(target));
  const temporary = uniqueTempPath(path.dirname(source), 'sotto-rename', path.extname(source));
  await fs.rename(source, temporary);
  try {
    await moveFile(temporary, target);
  } catch (error) {
    await fs.rename(temporary, source).catch(() => undefined);
    throw error;
  }
}

async function backupTarget(
  ctx: ApplyContext,
  target: string,
  item: ApplyItemKind
): Promise<JournalOperation> {
  const directory = path.join(ctx.dataDir, BACKUPS_DIRECTORY, ctx.runId);
  await ensureDir(directory);
  const destination = await nextAvailablePath(path.join(directory, path.basename(target)));
  await moveFile(target, destination);
  return makeOperation('backup', item, target, destination, true, '已备份现有文件');
}

async function trashTarget(
  ctx: ApplyContext,
  target: string
): Promise<{ undoable: boolean; destination: string | null; message: string; operation: JournalOperation }> {
  if (ctx.trashFile) {
    try {
      await ctx.trashFile(target);
      const operation = makeOperation('trash', 'delete-subtitle-source', target, null, false, '已移入系统回收站');
      return { undoable: false, destination: null, message: '已移入系统回收站', operation };
    } catch {
      // Fall through to the local trash directory.
    }
  }
  const directory = path.join(ctx.dataDir, TRASH_DIRECTORY, ctx.runId);
  await ensureDir(directory);
  const destination = await nextAvailablePath(path.join(directory, path.basename(target)));
  await moveFile(target, destination);
  const message = ctx.trashFile ? '系统回收站不可用，已移至本地回收区' : '已移至本地回收区';
  return {
    undoable: true,
    destination,
    message,
    operation: makeOperation('trash', 'delete-subtitle-source', target, destination, true, message)
  };
}

async function executeRenameAudio(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  if (!pair) return outcome('skipped', 'rename-audio', '缺少配对信息', null, null);
  const from = pair.audio.path;
  const to = path.join(pair.folder, pair.renamedAudioName);
  if (!(await pathExists(from))) {
    return outcome('skipped', 'rename-audio', '源音频不存在，已跳过', from, to);
  }
  if (from === to) {
    return outcome('skipped', 'rename-audio', '文件名已符合目标，无需重命名', from, to);
  }
  if (!samePath(from, to) && (await pathExists(to))) {
    return outcome('skipped', 'rename-audio', '目标文件已存在，未覆盖：' + path.basename(to), from, to);
  }
  await twoPhaseRename(from, to);
  state.renamedAudio.add(pair.id);
  return outcome('success', 'rename-audio', '已重命名音频', from, to, {
    operations: [makeOperation('rename', 'rename-audio', from, to, true, '重命名音频')]
  });
}

async function executeRenameSubtitle(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  if (!pair || !pair.subtitle || !pair.subtitleRenameName) {
    return outcome('skipped', 'rename-subtitle', '缺少字幕信息', null, null);
  }
  const from = pair.subtitle.path;
  const to = path.join(path.dirname(from), pair.subtitleRenameName);
  if (!(await pathExists(from))) {
    return outcome('skipped', 'rename-subtitle', '源字幕不存在，已跳过', from, to);
  }
  if (from === to) {
    return outcome('skipped', 'rename-subtitle', '文件名已符合目标，无需重命名', from, to);
  }
  if (!samePath(from, to) && (await pathExists(to))) {
    return outcome('skipped', 'rename-subtitle', '目标文件已存在，未覆盖：' + path.basename(to), from, to);
  }
  await twoPhaseRename(from, to);
  return outcome('success', 'rename-subtitle', '已重命名字幕', from, to, {
    operations: [makeOperation('rename', 'rename-subtitle', from, to, true, '重命名字幕')]
  });
}

async function executeRenameSubtitleSource(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  if (!pair || !pair.subtitle || !pair.subtitleRenameName) {
    return outcome('skipped', 'rename-subtitle', '缺少字幕信息', null, null);
  }
  const from = pair.subtitle.path;
  if (!state.convertedSubtitles.has(toPathKey(from))) {
    return outcome(
      'skipped',
      'rename-subtitle',
      '字幕转换未成功，已保留源字幕原文件名',
      from,
      null
    );
  }
  const to = path.join(path.dirname(from), pair.subtitleRenameName);
  if (!(await pathExists(from))) {
    return outcome('skipped', 'rename-subtitle', '源字幕不存在，已跳过', from, to);
  }
  if (from === to) {
    return outcome('skipped', 'rename-subtitle', '文件名已符合目标，无需重命名', from, to);
  }
  if (!samePath(from, to) && (await pathExists(to))) {
    return outcome(
      'skipped',
      'rename-subtitle',
      '同目录目标文件已存在，未覆盖：' + path.basename(to),
      from,
      to
    );
  }
  await twoPhaseRename(from, to);
  return outcome('success', 'rename-subtitle', '已就地重命名字幕源文件', from, to, {
    operations: [
      makeOperation('rename', 'rename-subtitle', from, to, true, '就地重命名字幕源文件')
    ]
  });
}

async function executeConvertSubtitle(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  if (!pair || !pair.subtitle || !pair.subtitleOutputName) {
    return outcome('skipped', 'convert-subtitle', '缺少字幕信息', null, null);
  }
  const from = pair.subtitle.path;
  const to = path.join(pair.folder, pair.subtitleOutputName);
  if (!(await pathExists(from))) {
    return outcome('skipped', 'convert-subtitle', '源字幕不存在，已跳过', from, to);
  }
  await ensureDir(path.dirname(to));
  const temporary = uniqueTempPath(path.dirname(to), 'sotto-subtitle', '.lrc.tmp');
  const operations: JournalOperation[] = [];
  try {
    const converted = await convertSubtitleFile(from, temporary, state.settings);
    if (await pathExists(to)) {
      operations.push(await backupTarget(state.ctx, to, 'convert-subtitle'));
    }
    await moveFile(temporary, to);
    operations.push(makeOperation('create', 'convert-subtitle', from, to, true, '生成 LRC'));
    state.convertedSubtitles.add(toPathKey(from));
    const bytesAdded = (await fileSize(to)) ?? converted.bytes;
    let message = '已生成 LRC（' + converted.cueCount + ' 条字幕）';
    if (converted.warnings.length > 0) {
      message += '，提示：' + converted.warnings.slice(0, 2).join('；');
    }
    return outcome('success', 'convert-subtitle', message, from, to, {
      bytesAdded,
      operations
    });
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function executeDeleteSubtitleSource(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  if (!pair || !pair.subtitle) {
    return outcome('skipped', 'delete-subtitle-source', '缺少字幕信息', null, null);
  }
  const source = pair.subtitle.path;
  if (!state.convertedSubtitles.has(toPathKey(source))) {
    return outcome(
      'skipped',
      'delete-subtitle-source',
      '字幕转换未成功，已保留源文件',
      source,
      null
    );
  }
  if (!(await pathExists(source))) {
    return outcome('skipped', 'delete-subtitle-source', '源字幕已不存在', source, null);
  }
  const size = (await fileSize(source)) ?? pair.subtitle.size;
  const result = await trashTarget(state.ctx, source);
  return outcome('success', 'delete-subtitle-source', result.message, source, result.destination, {
    bytesRemoved: size,
    operations: [result.operation]
  });
}

async function executeConvertAudio(task: ApplyTask, state: ExecutionState): Promise<TaskOutcome> {
  const pair = task.pair;
  const conversion = pair ? pair.audioConversion : null;
  if (!pair || !conversion || conversion.skipReason) {
    return outcome('skipped', 'convert-audio', '没有可执行的音频转换', null, null);
  }
  const renamedPath = path.join(pair.folder, pair.renamedAudioName);
  const renameWasApplied = state.renamedAudio.has(pair.id);
  let from = renameWasApplied ? renamedPath : pair.audio.path;
  if (!(await pathExists(from))) {
    if (renameWasApplied) {
      // The renamed file disappeared; fall back to the original only in that case.
      if (await pathExists(pair.audio.path)) from = pair.audio.path;
    } else if (
      state.renameAudioSelected &&
      pair.audioRenameNeeded &&
      !(await pathExists(pair.audio.path)) &&
      (await pathExists(renamedPath))
    ) {
      // A previous partial run already renamed the source; resume from the renamed path.
      from = renamedPath;
    }
  }
  const to = conversion.outputPath;
  if (!state.ctx.ffmpeg.available) {
    return outcome('skipped', 'convert-audio', '未检测到可用的 ffmpeg，已跳过音频转换', from, to);
  }
  if (!(await pathExists(from))) {
    return outcome('skipped', 'convert-audio', '源音频不存在，已跳过', from, to);
  }
  const format = conversion.format;
  const temporary = uniqueTempPath(path.dirname(to), 'sotto-audio', '.' + format);
  const codecArguments =
    format === 'm4a'
      ? ['-c:a', 'aac', '-b:a', conversion.bitrateKbps + 'k', '-movflags', '+faststart']
      : [
          '-c:a',
          'libmp3lame',
          '-b:a',
          conversion.bitrateKbps + 'k',
          '-id3v2_version',
          '3',
          '-write_id3v1',
          '1'
        ];
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    from,
    '-map',
    '0:a:0',
    '-vn',
    '-map_metadata',
    '0',
    ...codecArguments,
    temporary
  ];
  try {
    const result = await runFfmpeg(state.ctx.ffmpeg.path, args);
    if (!result.ok) {
      await fs.unlink(temporary).catch(() => undefined);
      const detail = tailText(result.stderr || result.error || '', 400);
      throw new Error('音频转换失败' + (detail ? '：' + detail : ''));
    }
    const operations: JournalOperation[] = [];
    if (!samePath(to, from) && (await pathExists(to))) {
      operations.push(await backupTarget(state.ctx, to, 'convert-audio'));
    }
    await ensureDir(path.dirname(to));
    await moveFile(temporary, to);
    operations.push(makeOperation('create', 'convert-audio', from, to, true, '转换音频'));
    state.convertedAudio.set(pair.id, from);
    const bytesAdded = (await fileSize(to)) ?? 0;
    return outcome('success', 'convert-audio', '已转换为 ' + format.toUpperCase(), from, to, {
      bytesAdded,
      operations
    });
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function executeDeleteAudioOriginal(
  task: ApplyTask,
  state: ExecutionState
): Promise<TaskOutcome> {
  const pair = task.pair;
  const conversion = pair ? pair.audioConversion : null;
  if (!pair || !conversion) {
    return outcome('skipped', 'trash-audio-original', '缺少转换信息', null, null);
  }
  const source = state.convertedAudio.get(pair.id);
  if (!source) {
    return outcome('skipped', 'trash-audio-original', '音频转换未成功，已保留原始文件', null, null);
  }
  if (!(await pathExists(source))) {
    return outcome('skipped', 'trash-audio-original', '转换后的源音频已不存在', source, null);
  }
  const size = (await fileSize(source)) ?? pair.audio.size;
  const result = await trashTarget(state.ctx, source);
  const operation: JournalOperation = {
    ...result.operation,
    item: 'trash-audio-original'
  };
  return outcome('success', 'trash-audio-original', result.message, source, result.destination, {
    bytesRemoved: size,
    operations: [operation]
  });
}

async function executeCover(task: ApplyTask, state: ExecutionState): Promise<TaskOutcome> {
  const folder = task.folder;
  const cover = folder ? folder.cover : null;
  if (!folder || !cover || cover.action === 'none') {
    return outcome('skipped', 'cover', '没有可执行的封面操作', null, null);
  }
  const from = cover.image.path;
  const to = cover.targetPath;
  if (!(await pathExists(from))) {
    return outcome('skipped', 'cover', '封面源文件不存在', from, to);
  }

  if (cover.action === 'convert') {
    if (!state.ctx.ffmpeg.available) {
      return outcome('skipped', 'cover-convert', '未检测到可用的 ffmpeg，无法转换封面', from, to);
    }
    if ((await pathExists(to)) && !cover.overwrite) {
      return outcome('skipped', 'cover-convert', '封面目标已存在且未开启覆盖', from, to);
    }
    const temporary = uniqueTempPath(path.dirname(to), 'sotto-cover', '.jpg');
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      from,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      temporary
    ];
    try {
      const result = await runFfmpeg(state.ctx.ffmpeg.path, args);
      if (!result.ok) {
        await fs.unlink(temporary).catch(() => undefined);
        const detail = tailText(result.stderr || result.error || '', 400);
        throw new Error('封面转换失败' + (detail ? '：' + detail : ''));
      }
      const operations: JournalOperation[] = [];
      if (await pathExists(to)) {
        operations.push(await backupTarget(state.ctx, to, 'cover-convert'));
      }
      await ensureDir(path.dirname(to));
      await moveFile(temporary, to);
      operations.push(makeOperation('create', 'cover-convert', from, to, true, '转换封面'));
      const bytesAdded = (await fileSize(to)) ?? 0;
      return outcome('success', 'cover-convert', '已转换封面为 JPEG', from, to, {
        bytesAdded,
        operations
      });
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  if (samePath(from, to)) {
    return outcome('skipped', 'cover', '封面已符合目标，无需移动', from, to);
  }
  if (await pathExists(to)) {
    if (!cover.overwrite) {
      return outcome('skipped', 'cover', '封面目标已存在且未开启覆盖', from, to);
    }
    const backup = await backupTarget(state.ctx, to, 'cover');
    await twoPhaseRename(from, to);
    return outcome('success', 'cover', '已备份并移动封面', from, to, {
      operations: [backup, makeOperation('rename', 'cover', from, to, true, '移动封面')]
    });
  }
  await twoPhaseRename(from, to);
  return outcome('success', 'cover', '已移动封面', from, to, {
    operations: [makeOperation('rename', 'cover', from, to, true, '移动封面')]
  });
}

function itemKindForTask(type: TaskType): ApplyItemKind {
  switch (type) {
    case 'delete-subtitle-source':
      return 'delete-subtitle-source';
    case 'delete-audio-original':
      return 'trash-audio-original';
    case 'cover':
      return 'cover';
    case 'rename-audio':
      return 'rename-audio';
    case 'rename-subtitle':
    case 'rename-subtitle-source':
      return 'rename-subtitle';
    case 'convert-subtitle':
      return 'convert-subtitle';
    case 'convert-audio':
      return 'convert-audio';
  }
}

function taskFailurePaths(task: ApplyTask): { from: string | null; to: string | null } {
  const pair = task.pair;
  if (pair) {
    switch (task.type) {
      case 'rename-audio':
        return {
          from: pair.audio.path,
          to: path.join(pair.folder, pair.renamedAudioName)
        };
      case 'rename-subtitle':
      case 'rename-subtitle-source':
        if (pair.subtitle && pair.subtitleRenameName) {
          return {
            from: pair.subtitle.path,
            to: path.join(path.dirname(pair.subtitle.path), pair.subtitleRenameName)
          };
        }
        break;
      case 'convert-subtitle':
        if (pair.subtitle && pair.subtitleOutputName) {
          return {
            from: pair.subtitle.path,
            to: path.join(pair.folder, pair.subtitleOutputName)
          };
        }
        break;
      case 'delete-subtitle-source':
        if (pair.subtitle) return { from: pair.subtitle.path, to: null };
        break;
      case 'convert-audio':
        if (pair.audioConversion) {
          return {
            from: pair.audioConversion.sourcePath,
            to: pair.audioConversion.outputPath
          };
        }
        break;
      case 'delete-audio-original':
        if (pair.audioConversion) {
          return { from: pair.audioConversion.sourcePath, to: null };
        }
        break;
    }
  }
  if (task.folder && task.folder.cover) {
    return { from: task.folder.cover.image.path, to: task.folder.cover.targetPath };
  }
  return { from: null, to: null };
}

function updateStats(stats: ApplyStats, outcomeValue: TaskOutcome): void {
  if (outcomeValue.status === 'failed') stats.failed += 1;
  else if (outcomeValue.status === 'skipped') stats.skipped += 1;
  else {
    if (outcomeValue.itemKind === 'rename-audio' || outcomeValue.itemKind === 'rename-subtitle') {
      stats.renamed += 1;
    } else if (outcomeValue.itemKind === 'convert-subtitle') {
      stats.subtitlesConverted += 1;
    } else if (outcomeValue.itemKind === 'convert-audio') {
      stats.audioConverted += 1;
    } else if (outcomeValue.itemKind === 'cover' || outcomeValue.itemKind === 'cover-convert') {
      stats.covers += 1;
    }
  }
}

/** Applies a plan with per-item isolation, a journal, history and progress events. */
export async function applyPlan(request: ApplyRequest, ctx: ApplyContext): Promise<ApplyResult> {
  const plan = request.plan;
  const startedAt = Date.now();
  const stats = emptyStats();
  const items: ApplyItem[] = [];
  const operations: JournalOperation[] = [];
  const logPath = logPathFor(ctx);
  let logAvailable = false;

  const journal: RunJournal = {
    version: 1,
    runId: ctx.runId,
    root: plan.root,
    rootName: plan.rootName,
    startedAt,
    finishedAt: null,
    status: 'running',
    stats,
    undoAvailable: false,
    undoneAt: null,
    logPath,
    operations,
    items
  };

  const appendLog = async (line: string): Promise<void> => {
    try {
      await ensureDir(ctx.logsDir);
      await fs.appendFile(logPath, line + '\r\n', 'utf8');
      logAvailable = true;
    } catch {
      logAvailable = false;
    }
  };

  await ensureDir(ctx.dataDir).catch(() => undefined);
  await ensureDir(ctx.logsDir).catch(() => undefined);
  await appendLog('[' + new Date(startedAt).toISOString() + '] run ' + ctx.runId + ' start');
  await appendLog('root: ' + plan.root);
  await saveJournal(ctx.dataDir, journal);

  const tasks = buildTasks(plan, request.selection);
  const state: ExecutionState = {
    ctx,
    settings: plan.settingsSnapshot,
    operations,
    convertedSubtitles: new Set<string>(),
    renamedAudio: new Set<string>(),
    renameAudioSelected: Boolean(request.selection.renameAudio),
    convertedAudio: new Map<string, string>()
  };

  const seenSources = new Set<string>();
  let bytesBefore = 0;
  for (const task of tasks) {
    const source = taskSource(task);
    if (!source) continue;
    const key = toPathKey(source.path);
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    bytesBefore += source.size;
  }
  stats.bytesBefore = bytesBefore;

  const total = tasks.length;
  emitProgress(ctx, tasks.length > 0 ? tasks[0].phase : 'finish', 0, total, '开始处理', null, 'info');
  await appendLog('tasks: ' + total);

  let removedBytes = 0;
  let addedBytes = 0;

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    let resolution: TaskOutcome;
    try {
      switch (task.type) {
        case 'rename-audio':
          resolution = await executeRenameAudio(task, state);
          break;
        case 'rename-subtitle':
          resolution = await executeRenameSubtitle(task, state);
          break;
        case 'rename-subtitle-source':
          resolution = await executeRenameSubtitleSource(task, state);
          break;
        case 'convert-subtitle':
          resolution = await executeConvertSubtitle(task, state);
          break;
        case 'delete-subtitle-source':
          resolution = await executeDeleteSubtitleSource(task, state);
          break;
        case 'convert-audio':
          resolution = await executeConvertAudio(task, state);
          break;
        case 'delete-audio-original':
          resolution = await executeDeleteAudioOriginal(task, state);
          break;
        case 'cover':
          resolution = await executeCover(task, state);
          break;
        default:
          resolution = outcome('skipped', 'cover', '未知操作', null, null);
      }
    } catch (error) {
      const failurePaths = taskFailurePaths(task);
      resolution = outcome(
        'failed',
        itemKindForTask(task.type),
        describeError(error),
        failurePaths.from,
        failurePaths.to
      );
    }

    for (const operation of resolution.operations) state.operations.push(operation);
    removedBytes += resolution.bytesRemoved;
    addedBytes += resolution.bytesAdded;
    updateStats(stats, resolution);

    const item: ApplyItem = {
      kind: resolution.itemKind,
      from: resolution.from,
      to: resolution.to,
      status: resolution.status,
      message: resolution.message
    };
    items.push(item);

    await appendLog(
      '[' +
        new Date().toISOString() +
        '] [' +
        resolution.status +
        '] [' +
        resolution.itemKind +
        '] ' +
        (resolution.from || '') +
        ' -> ' +
        (resolution.to || '') +
        ' | ' +
        resolution.message
    );

    emitProgress(
      ctx,
      task.phase,
      index + 1,
      total,
      taskLabel(task) + '：' + resolution.message,
      index + 1 + ' / ' + total,
      resolution.status === 'failed' ? 'error' : resolution.status === 'skipped' ? 'warn' : 'info'
    );

    stats.bytesAfter = Math.max(0, stats.bytesBefore - removedBytes + addedBytes);
    journal.stats = stats;
    journal.operations = state.operations;
    journal.items = items;
    await saveJournal(ctx.dataDir, journal);
  }

  const failedCount = items.filter((item) => item.status === 'failed').length;
  const successCount = items.filter((item) => item.status === 'success').length;
  const status: ApplyResult['status'] =
    failedCount === 0 ? 'success' : successCount > 0 ? 'partial' : 'failed';
  const undoAvailable =
    state.operations.length > 0 && state.operations.every((operation) => operation.undoable);
  const finishedAt = Date.now();

  journal.finishedAt = finishedAt;
  journal.status = status;
  journal.undoAvailable = undoAvailable;
  journal.stats = stats;
  journal.operations = state.operations;
  journal.items = items;
  journal.logPath = logAvailable ? logPath : null;
  await saveJournal(ctx.dataDir, journal);

  const record: RunRecord = {
    runId: ctx.runId,
    root: plan.root,
    rootName: plan.rootName,
    startedAt,
    finishedAt,
    status,
    stats,
    undoAvailable,
    undoneAt: null
  };
  await upsertHistoryRecord(ctx.dataDir, record);

  await appendLog(
    '[' +
      new Date(finishedAt).toISOString() +
      '] finish status=' +
      status +
      ' renamed=' +
      stats.renamed +
      ' subtitles=' +
      stats.subtitlesConverted +
      ' audio=' +
      stats.audioConverted +
      ' covers=' +
      stats.covers +
      ' skipped=' +
      stats.skipped +
      ' failed=' +
      stats.failed
  );

  emitFinish(
    ctx,
    total,
    '处理完成：成功 ' +
      successCount +
      ' 项，跳过 ' +
      stats.skipped +
      ' 项，失败 ' +
      stats.failed +
      ' 项',
    stats.failed > 0 ? 'warn' : 'info'
  );

  return {
    runId: ctx.runId,
    root: plan.root,
    status,
    startedAt,
    finishedAt,
    stats,
    items,
    undoAvailable,
    logPath: logAvailable ? logPath : null
  };
}

async function moveToUndoTrash(dataDir: string, runId: string, target: string): Promise<string> {
  const directory = path.join(
    dataDir,
    TRASH_DIRECTORY,
    'undo-' + runId.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + crypto.randomUUID().slice(0, 8)
  );
  await ensureDir(directory);
  const destination = await nextAvailablePath(path.join(directory, path.basename(target)));
  await moveFile(target, destination);
  return destination;
}

async function findLatestUndoableRunId(dataDir: string): Promise<string | null> {
  const records = await readHistoryRecords(dataDir);
  const record = records.find((item) => item.undoAvailable && item.undoneAt === null);
  if (record) return record.runId;
  try {
    const directory = path.join(dataDir, RUNS_DIRECTORY);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(directory, entry.name));
    const stats = await Promise.all(
      files.map(async (file) => {
        try {
          const stat = await fs.stat(file);
          return { file, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    const ordered = stats
      .filter((value): value is { file: string; mtimeMs: number } => value !== null)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    for (const entry of ordered) {
      const journal = await loadJsonFile<RunJournal>(entry.file);
      if (
        journal &&
        journal.undoAvailable === true &&
        journal.undoneAt === null &&
        Array.isArray(journal.operations) &&
        journal.operations.length > 0
      ) {
        return journal.runId;
      }
    }
  } catch {
    // No journals available.
  }
  return null;
}

/** Reverses the recorded operations of one run (or the latest undoable run). */
export async function undoRunById(runId: string | undefined, dataDir: string): Promise<UndoResult> {
  const targetRunId = runId && runId.trim().length > 0 ? runId : await findLatestUndoableRunId(dataDir);
  if (!targetRunId) {
    return {
      runId: runId || '',
      status: 'failed',
      restored: 0,
      failed: 0,
      items: [],
      message: '没有可撤销的运行记录'
    };
  }

  const journal = await loadJournal(dataDir, targetRunId);
  if (!journal) {
    return {
      runId: targetRunId,
      status: 'failed',
      restored: 0,
      failed: 0,
      items: [],
      message: '未找到该运行的操作记录（可能已被清理）'
    };
  }
  if (journal.undoneAt !== null) {
    return {
      runId: targetRunId,
      status: 'failed',
      restored: 0,
      failed: 0,
      items: [],
      message: '该运行已经撤销过'
    };
  }
  if (!Array.isArray(journal.operations) || journal.operations.length === 0) {
    return {
      runId: targetRunId,
      status: 'failed',
      restored: 0,
      failed: 0,
      items: [],
      message: '该运行没有可撤销的操作'
    };
  }

  const items: ApplyItem[] = [];
  let restored = 0;
  let failed = 0;

  const reversed = [...journal.operations].reverse();
  for (const operation of reversed) {
    const from = operation.to;
    const to = operation.from;
    const pushFailure = (message: string): void => {
      failed += 1;
      items.push({
        kind: operation.item,
        from,
        to,
        status: 'failed',
        message
      });
    };
    try {
      if (operation.kind === 'create') {
        if (!operation.to) {
          pushFailure('操作记录缺少目标路径');
          continue;
        }
        if (await pathExists(operation.to)) {
          await moveToUndoTrash(dataDir, targetRunId, operation.to);
          restored += 1;
          items.push({
            kind: operation.item,
            from: operation.to,
            to: null,
            status: 'success',
            message: '已移除本次运行创建的文件'
          });
        } else {
          items.push({
            kind: operation.item,
            from: operation.to,
            to: null,
            status: 'skipped',
            message: '文件已不存在，无需移除'
          });
        }
        continue;
      }

      if (operation.kind === 'rename') {
        if (!operation.from || !operation.to) {
          pushFailure('操作记录缺少路径');
          continue;
        }
        if (!(await pathExists(operation.to))) {
          pushFailure('文件不存在，无法改回原名');
          continue;
        }
        if (await pathExists(operation.from)) {
          pushFailure('原位置已被占用，未覆盖');
          continue;
        }
        await moveFile(operation.to, operation.from);
        restored += 1;
        items.push({
          kind: operation.item,
          from: operation.to,
          to: operation.from,
          status: 'success',
          message: '已恢复原文件名'
        });
        continue;
      }

      if (operation.kind === 'backup') {
        if (!operation.from || !operation.to) {
          pushFailure('操作记录缺少路径');
          continue;
        }
        if (!(await pathExists(operation.to))) {
          pushFailure('备份文件不存在，无法恢复');
          continue;
        }
        if (await pathExists(operation.from)) {
          pushFailure('原位置已被占用，未覆盖');
          continue;
        }
        await moveFile(operation.to, operation.from);
        restored += 1;
        items.push({
          kind: operation.item,
          from: operation.to,
          to: operation.from,
          status: 'success',
          message: '已恢复备份文件'
        });
        continue;
      }

      if (operation.kind === 'trash') {
        if (!operation.undoable) {
          pushFailure('文件已移入系统回收站或已被删除，无法恢复');
          continue;
        }
        if (!operation.from || !operation.to) {
          pushFailure('操作记录缺少路径');
          continue;
        }
        if (!(await pathExists(operation.to))) {
          pushFailure('本地回收区文件不存在，无法恢复');
          continue;
        }
        if (await pathExists(operation.from)) {
          pushFailure('原位置已被占用，未覆盖');
          continue;
        }
        await moveFile(operation.to, operation.from);
        restored += 1;
        items.push({
          kind: operation.item,
          from: operation.to,
          to: operation.from,
          status: 'success',
          message: '已从本地回收区恢复'
        });
      }
    } catch (error) {
      pushFailure(describeError(error));
    }
  }

  const status: UndoResult['status'] =
    failed === 0 ? 'success' : restored > 0 ? 'partial' : 'failed';
  const finalized = status !== 'failed';
  if (finalized) {
    const undoneAt = Date.now();
    journal.undoneAt = undoneAt;
    journal.undoAvailable = false;
    await saveJournal(dataDir, journal);

    const records = await readHistoryRecords(dataDir);
    const existing = records.find((record) => record.runId === targetRunId);
    const fallbackStatus: RunRecord['status'] =
      journal.status === 'running' ? 'failed' : journal.status;
    const updated: RunRecord = existing
      ? { ...existing, undoAvailable: false, undoneAt }
      : {
          runId: journal.runId,
          root: journal.root,
          rootName: journal.rootName,
          startedAt: journal.startedAt,
          finishedAt: journal.finishedAt || journal.startedAt,
          status: fallbackStatus,
          stats: journal.stats,
          undoAvailable: false,
          undoneAt
        };
    await upsertHistoryRecord(dataDir, updated);
  }

  let message: string;
  if (failed === 0) {
    message = '已撤销 ' + restored + ' 项操作';
  } else if (restored > 0) {
    message = '已撤销 ' + restored + ' 项操作，' + failed + ' 项无法恢复';
  } else {
    message = '撤销失败：' + failed + ' 项操作无法恢复，可修复冲突后重试';
  }
  return { runId: targetRunId, status, restored, failed, items, message };
}

/** Returns run history, newest first. Missing or corrupt history yields an empty list. */
export async function listHistory(dataDir: string): Promise<RunRecord[]> {
  return readHistoryRecords(dataDir);
}
