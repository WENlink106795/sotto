import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

/** Stable identity for a path: case-insensitive on Windows, exact elsewhere. */
export function toPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function samePath(a: string, b: string): boolean {
  return toPathKey(a) === toPathKey(b);
}

export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === '') return true;
  if (relative === '..') return false;
  if (relative.startsWith('..' + path.sep)) return false;
  return !path.isAbsolute(relative);
}

export function relativeSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0);
}

export function isSameOrDescendantRelative(parentRelative: string, childRelative: string): boolean {
  const parent = relativeSegments(parentRelative).map((segment) => segment.toLowerCase());
  const child = relativeSegments(childRelative).map((segment) => segment.toLowerCase());
  if (parent.length > child.length) return false;
  for (let index = 0; index < parent.length; index += 1) {
    if (parent[index] !== child[index]) return false;
  }
  return true;
}

/** Number of parent/child hops between two folders (0 = same folder). */
export function relativeDirectoryDistance(a: string, b: string): number {
  const left = relativeSegments(a).map((segment) => segment.toLowerCase());
  const right = relativeSegments(b).map((segment) => segment.toLowerCase());
  let common = 0;
  const limit = Math.min(left.length, right.length);
  while (common < limit && left[common] === right[common]) common += 1;
  return left.length - common + (right.length - common);
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(target: string): Promise<number | null> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

/** Returns candidate itself when free, otherwise a " (2)" style suffixed sibling. */
export async function nextAvailablePath(candidate: string): Promise<string> {
  if (!(await pathExists(candidate))) return candidate;
  const directory = path.dirname(candidate);
  const extension = path.extname(candidate);
  const base = path.basename(candidate, extension);
  for (let index = 2; index < 1000; index += 1) {
    const next = path.join(directory, base + ' (' + index + ')' + extension);
    if (!(await pathExists(next))) return next;
  }
  return path.join(directory, base + '-' + crypto.randomUUID().slice(0, 8) + extension);
}

export function uniqueTempPath(directory: string, prefix: string, extension: string): string {
  const safeExtension = extension.length > 0 && !extension.startsWith('.') ? '.' + extension : extension;
  return path.join(directory, '.' + prefix + '-' + crypto.randomUUID() + safeExtension);
}

/** Rename with a copy/unlink fallback for cross-volume moves. Caller owns overwrite policy. */
export async function moveFile(source: string, target: string): Promise<void> {
  await ensureDir(path.dirname(target));
  try {
    await fs.rename(source, target);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV') throw error;
  }
  await fs.copyFile(source, target);
  await fs.unlink(source);
}

export async function writeFileAtomic(target: string, data: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(target));
  const directory = path.dirname(target);
  const temporary = uniqueTempPath(directory, 'sotto-write', '.tmp');
  try {
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + ' ' + units[unit];
}
