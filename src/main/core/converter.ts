import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AUDIO_EXTENSIONS } from '@shared/defaults';
import { buildConverterArgs, DEFAULT_CONVERTER_ENGINE } from './converter-engines';
import type {
  ConverterEngineId,
  ConverterItemResult,
  ConverterProgress,
  ConverterRequest,
  ConverterResult,
  ConverterScan,
  FileInfo
} from '@shared/types';
import { probeDurationMs, runFfmpeg } from './ffmpeg';
import { ensureDir, nextAvailablePath, uniqueTempPath } from './util';

const SUPPORTED = new Set(AUDIO_EXTENSIONS.map((ext) => ext.toLowerCase()));
const OUTPUT_FOLDER = 'Sotto-converted';

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return hours > 0 ? hours + ':' + minutes + ':' + seconds : minutes + ':' + seconds;
}

function targetExtension(format: ConverterRequest['format']): ConverterRequest['format'] {
  return format;
}

export function defaultOutputDir(source: string, isDirectory: boolean): string {
  return path.join(isDirectory ? source : path.dirname(source), OUTPUT_FOLDER);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function collectFiles(
  directory: string,
  recursive: boolean,
  outputDir: string,
  result: FileInfo[]
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!recursive) continue;
      if (entry.name.startsWith('.')) continue;
      if (path.resolve(full) === path.resolve(outputDir)) continue;
      await collectFiles(full, true, outputDir, result);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    if (!SUPPORTED.has(ext)) continue;
    try {
      const stat = await fs.stat(full);
      result.push({
        path: full,
        name: entry.name,
        ext,
        size: stat.size,
        base: path.basename(entry.name, path.extname(entry.name)),
        kind: 'audio',
        mtimeMs: stat.mtimeMs
      });
    } catch {
      // A file can disappear while scanning.
    }
  }
}

export async function scanConverter(request: ConverterRequest): Promise<ConverterScan> {
  if (!request.source || !request.source.trim()) throw new Error('请选择要转码的文件或文件夹');
  const source = path.resolve(request.source);
  const stat = await fs.stat(source);
  const sourceKind: ConverterScan['sourceKind'] = stat.isDirectory() ? 'folder' : 'file';
  const outputDir = path.resolve(request.outputDir?.trim() || defaultOutputDir(source, sourceKind === 'folder'));
  const files: FileInfo[] = [];
  if (sourceKind === 'file') {
    const ext = path.extname(source).slice(1).toLowerCase();
    if (!SUPPORTED.has(ext)) throw new Error('不支持这个音频格式：' + ext);
    files.push({
      path: source,
      name: path.basename(source),
      ext,
      size: stat.size,
      base: path.basename(source, path.extname(source)),
      kind: 'audio',
      mtimeMs: stat.mtimeMs
    });
  } else {
    await collectFiles(source, request.recursive, outputDir, files);
  }
  const ext = targetExtension(request.format);
  const converterFiles = files.map((file) => ({
    path: file.path,
    name: file.name,
    ext: file.ext,
    size: file.size,
    targetPath: path.join(outputDir, file.base + '.' + ext)
  }));
  return {
    source,
    sourceKind,
    outputDir,
    files: converterFiles,
    totalBytes: converterFiles.reduce((sum, file) => sum + file.size, 0),
    recursive: request.recursive
  };
}

export async function convertWithFfmpeg(
  request: ConverterRequest,
  runId: string,
  onProgress: (progress: ConverterProgress) => void,
  ffmpegPath: string
): Promise<ConverterResult> {
  const scan = await scanConverter(request);
  if (scan.files.length === 0) throw new Error('没有找到可转码的音频文件');
  await ensureDir(scan.outputDir);
  const format = targetExtension(request.format);
  const engine: ConverterEngineId = request.engine || DEFAULT_CONVERTER_ENGINE;
  const startedAt = Date.now();
  const items: ConverterItemResult[] = [];
  const total = scan.files.length;
  const emit = (progress: Omit<ConverterProgress, 'runId' | 'at'>): void => {
    onProgress({ ...progress, runId, at: Date.now() });
  };

  for (let index = 0; index < scan.files.length; index += 1) {
    const file = scan.files[index];
    const base = path.basename(file.name, path.extname(file.name));
    if (file.ext === format) {
      items.push({
        sourcePath: file.path,
        outputPath: file.targetPath,
        status: 'skipped',
        message: '已经是目标格式',
        bytes: 0
      });
      emit({
        current: index + 1,
        total,
        overallPercent: Math.round(((index + 1) / total) * 100),
        filePercent: null,
        message: '跳过：' + file.name,
        detail: '已经是 ' + format.toUpperCase() + ' 格式',
        level: 'info'
      });
      continue;
    }

    const target = await nextAvailablePath(path.join(scan.outputDir, base + '.' + format));
    const temporary = uniqueTempPath(scan.outputDir, 'sotto-convert', '.' + format);
    const durationMs = await probeDurationMs(file.path, ffmpegPath).catch(() => null);
    const args = ['-hide_banner', '-loglevel', 'error', ...buildConverterArgs(file.path, temporary, format, request.bitrateKbps)];
    try {
      emit({
        current: index,
        total,
        overallPercent: Math.round((index / total) * 100),
        filePercent: 0,
        message: '正在转码：' + file.name,
        detail: '已用 00:00 · 当前 ' + (index + 1) + ' / ' + total,
        level: 'info'
      });
      const result = await runFfmpeg(ffmpegPath, args, undefined, (progress) => {
        const fraction = durationMs && durationMs > 0 ? Math.min(0.99, progress.timeMs / durationMs) : 0;
        const filePercent = durationMs && durationMs > 0 ? Math.round(fraction * 100) : null;
        emit({
          current: index + fraction,
          total,
          overallPercent: Math.round(((index + fraction) / total) * 100),
          filePercent,
          message: '正在转码：' + file.name + (filePercent === null ? '' : '（' + filePercent + '%）'),
          detail: '已用 ' + formatElapsed(progress.timeMs) + ' · 当前 ' + (index + 1) + ' / ' + total,
          level: 'info'
        });
      });
      if (!result.ok) {
        await fs.unlink(temporary).catch(() => undefined);
        throw new Error((result.stderr || result.error || 'ffmpeg 失败').trim().slice(-500));
      }
      await fs.rename(temporary, target);
      const stat = await fs.stat(target);
      items.push({
        sourcePath: file.path,
        outputPath: target,
        status: 'success',
        message: '已转换为 ' + format.toUpperCase(),
        bytes: stat.size
      });
      emit({
        current: index + 1,
        total,
        overallPercent: Math.round(((index + 1) / total) * 100),
        filePercent: 100,
        message: '完成：' + file.name,
        detail: Math.round(stat.size / 1024 / 1024) + ' MB',
        level: 'info'
      });
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      items.push({ sourcePath: file.path, outputPath: target, status: 'failed', message, bytes: 0 });
      emit({
        current: index + 1,
        total,
        overallPercent: Math.round(((index + 1) / total) * 100),
        filePercent: null,
        message: '失败：' + file.name,
        detail: message.slice(0, 300),
        level: 'error'
      });
    }
  }

  const success = items.filter((item) => item.status === 'success').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  const skipped = items.filter((item) => item.status === 'skipped').length;
  emit({
    current: total,
    total,
    overallPercent: 100,
    filePercent: 100,
    message: '转码完成',
    detail: '成功 ' + success + ' · 失败 ' + failed + ' · 跳过 ' + skipped,
    level: failed > 0 ? 'warn' : 'info'
  });
  return {
    runId,
    engine,
    source: scan.source,
    outputDir: scan.outputDir,
    total,
    success,
    failed,
    skipped,
    items,
    startedAt,
    finishedAt: Date.now()
  };
}
