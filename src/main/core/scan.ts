import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, SUBTITLE_EXTENSIONS, TEXT_EXTENSIONS } from '@shared/defaults';
import type { FileInfo, FileKind, ScanFolder, ScanResult, ScanStats } from '@shared/types';

const AUDIO_EXTENSION_SET = new Set(AUDIO_EXTENSIONS.map((value) => value.toLowerCase()));
const SUBTITLE_EXTENSION_SET = new Set(SUBTITLE_EXTENSIONS.map((value) => value.toLowerCase()));
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS.map((value) => value.toLowerCase()));
const TEXT_EXTENSION_SET = new Set(TEXT_EXTENSIONS.map((value) => value.toLowerCase()));

const MAX_DEPTH = 32;
const MAX_FILES = 100000;
const MAX_FOLDERS = 20000;
const MAX_WARNINGS = 60;
const MESSAGE_INTERVAL_MS = 120;

const SKIP_DIRECTORY_NAMES = new Set([
  'node_modules',
  'system volume information',
  '$recycle.bin',
  '$windows.~bt',
  '$windows.~ws',
  'recycler',
  'lost+found',
  '__macosx',
  '.git',
  '.svn',
  '.hg'
]);

interface CodedError extends Error {
  code?: string;
}

interface ScanState {
  root: string;
  rootName: string;
  folders: ScanFolder[];
  stats: ScanStats;
  warnings: string[];
  omittedWarnings: number;
  truncated: boolean;
  visitedFiles: number;
  visitedFolders: number;
  onMessage: ((message: string) => void) | undefined;
  lastMessageAt: number;
}

interface ChildDirectory {
  path: string;
  relativePath: string;
}

function classifyExtension(extension: string): FileKind | null {
  if (AUDIO_EXTENSION_SET.has(extension)) return 'audio';
  if (SUBTITLE_EXTENSION_SET.has(extension)) return 'subtitle';
  if (IMAGE_EXTENSION_SET.has(extension)) return 'image';
  if (TEXT_EXTENSION_SET.has(extension)) return 'text';
  return null;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index + 1).toLowerCase();
}

function baseOf(fileName: string, extension: string): string {
  if (!extension) return fileName;
  return fileName.slice(0, fileName.length - extension.length - 1);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const coded = error as CodedError;
    return coded.code ? coded.code + ': ' + error.message : error.message;
  }
  return String(error);
}

function addWarning(state: ScanState, message: string): void {
  if (state.warnings.includes(message)) return;
  if (state.warnings.length >= MAX_WARNINGS) {
    state.omittedWarnings += 1;
    return;
  }
  state.warnings.push(message);
}

function notify(state: ScanState, message: string): void {
  if (!state.onMessage) return;
  const now = Date.now();
  if (now - state.lastMessageAt < MESSAGE_INTERVAL_MS) return;
  state.lastMessageAt = now;
  try {
    state.onMessage(message);
  } catch {
    // Progress listeners must never break a scan.
  }
}

async function scanDirectory(
  state: ScanState,
  directory: string,
  relativePath: string,
  depth: number
): Promise<void> {
  if (state.visitedFolders >= MAX_FOLDERS) {
    state.truncated = true;
    addWarning(state, '已达到文件夹数量上限（' + MAX_FOLDERS + '），扫描结果不完整');
    return;
  }
  if (depth > MAX_DEPTH) {
    state.truncated = true;
    addWarning(state, '已达到最大扫描深度（' + MAX_DEPTH + ' 层），部分文件夹未扫描');
    return;
  }
  state.visitedFolders += 1;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    addWarning(state, '无法读取文件夹：' + (relativePath || state.rootName) + '（' + describeError(error) + '）');
    return;
  }

  entries.sort((left, right) =>
    left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  );

  const files: FileInfo[] = [];
  const childDirectories: ChildDirectory[] = [];

  for (const entry of entries) {
    if (state.visitedFiles >= MAX_FILES) {
      state.truncated = true;
      addWarning(state, '已达到文件数量上限（' + MAX_FILES + '），扫描结果不完整');
      break;
    }
    const name = entry.name;
    if (!name || name === '.' || name === '..') continue;
    if (entry.isSymbolicLink()) {
      addWarning(state, '已跳过符号链接：' + (relativePath ? path.join(relativePath, name) : name));
      continue;
    }
    if (name.startsWith('.')) continue;

    const fullPath = path.join(directory, name);

    if (entry.isDirectory()) {
      if (SKIP_DIRECTORY_NAMES.has(name.toLowerCase())) continue;
      childDirectories.push({
        path: fullPath,
        relativePath: relativePath ? path.join(relativePath, name) : name
      });
      continue;
    }

    if (!entry.isFile()) continue;
    state.visitedFiles += 1;

    const extension = extensionOf(name);
    const kind = classifyExtension(extension);
    if (!kind) continue;

    try {
      const stat = await fs.stat(fullPath);
      files.push({
        path: fullPath,
        name,
        base: baseOf(name, extension),
        ext: extension,
        kind,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      });
      state.stats[kind] += 1;
      state.stats.totalFiles += 1;
      state.stats.bytes += stat.size;
    } catch (error) {
      addWarning(state, '无法读取文件：' + name + '（' + describeError(error) + '）');
    }
  }

  if (files.length > 0) {
    files.sort((left, right) =>
      left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    );
    state.folders.push({
      path: directory,
      name: path.basename(directory) || state.rootName,
      relativePath,
      files
    });
    notify(state, '已扫描 ' + (relativePath || state.rootName) + '：' + files.length + ' 个媒体文件');
  }

  for (const child of childDirectories) {
    if (state.visitedFolders >= MAX_FOLDERS) {
      state.truncated = true;
      addWarning(state, '已达到文件夹数量上限（' + MAX_FOLDERS + '），扫描结果不完整');
      break;
    }
    await scanDirectory(state, child.path, child.relativePath, depth + 1);
  }
}

/**
 * Recursively scans a library root for audio, subtitle and image files.
 * Hidden entries, symlinks and known system folders are skipped; the scan is bounded in
 * depth and item counts so a huge or looping tree can never hang the main process.
 */
export async function scanLibrary(
  root: string,
  onMessage?: (message: string) => void
): Promise<ScanResult> {
  const resolved = path.resolve(root);

  let stat: import('node:fs').Stats;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    const failure = new Error('无法访问文件夹：' + resolved) as CodedError;
    failure.code = 'E_SCAN_ROOT_UNAVAILABLE';
    failure.message = failure.message + '（' + describeError(error) + '）';
    throw failure;
  }
  if (!stat.isDirectory()) {
    const failure = new Error('不是文件夹：' + resolved) as CodedError;
    failure.code = 'E_SCAN_ROOT_NOT_DIRECTORY';
    throw failure;
  }

  const state: ScanState = {
    root: resolved,
    rootName: path.basename(resolved) || resolved,
    folders: [],
    stats: { audio: 0, subtitle: 0, image: 0, text: 0, totalFiles: 0, bytes: 0 },
    warnings: [],
    omittedWarnings: 0,
    truncated: false,
    visitedFiles: 0,
    visitedFolders: 0,
    onMessage,
    lastMessageAt: 0
  };

  await scanDirectory(state, resolved, '', 0);

  state.folders.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  );

  if (state.omittedWarnings > 0) {
    state.warnings.push('另有 ' + state.omittedWarnings + ' 条警告未显示');
  }

  return {
    root: resolved,
    rootName: state.rootName,
    folders: state.folders,
    stats: state.stats,
    warnings: state.warnings,
    truncated: state.truncated,
    scannedAt: Date.now()
  };
}