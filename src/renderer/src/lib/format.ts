const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const power = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, power);
  const digits = power === 0 || value >= 100 ? 0 : 1;
  return value.toFixed(digits) + ' ' + BYTE_UNITS[power];
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes + ':' + String(seconds).padStart(2, '0');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTime(ts: number): string {
  const date = new Date(ts);
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

export function formatDay(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return '今天 ' + formatTime(ts);
  if (sameDay(date, yesterday)) return '昨天 ' + formatTime(ts);
  if (date.getFullYear() === today.getFullYear()) {
    return date.getMonth() + 1 + ' 月 ' + date.getDate() + ' 日 ' + formatTime(ts);
  }
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + formatTime(ts);
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (!Number.isFinite(diff)) return '';
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
  return formatDay(ts);
}

export function formatDateOnly(ts: number): string {
  const date = new Date(ts);
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate());
}

export interface SplitName {
  base: string;
  ext: string;
}

export function splitFileName(name: string): SplitName {
  const index = name.lastIndexOf('.');
  if (index <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, index), ext: name.slice(index) };
}

export function truncateMiddle(text: string, max = 44): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
}

export function lastName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function dirName(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index > 0 ? path.slice(0, index) : path;
}

export function percentOf(current: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

export function shortPath(path: string, max = 58): string {
  return truncateMiddle(path, max);
}
