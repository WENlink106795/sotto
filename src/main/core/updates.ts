import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UpdateInfo, UpdateProgress } from '@shared/types';

const REPO = 'WENlink106795/sotto';
const RELEASES_API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const RELEASES_PAGE = 'https://github.com/' + REPO + '/releases/latest';
const CHECK_TIMEOUT_MS = 15000;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

export function compareVersions(left: string, right: string): number {
  const normalize = (value: string): (number | string)[] => {
    const stripped = value.replace(/^v/i, '');
    const revision = /^(\d+(?:\.\d+)*)([a-z])$/i.exec(stripped);
    if (revision) {
      return [...revision[1].split('.').map(Number), revision[2].toLowerCase().charCodeAt(0) - 96];
    }
    return stripped.split(/[.+-]/).map((part) => {
      const number = Number(part);
      return Number.isFinite(number) ? number : part;
    });
  };
  const a = normalize(left);
  const b = normalize(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const one = a[index] ?? 0;
    const two = b[index] ?? 0;
    if (typeof one === 'number' && typeof two === 'number') {
      if (one !== two) return one > two ? 1 : -1;
    } else if (typeof one === 'number' && typeof two === 'string') {
      return 1;
    } else if (typeof one === 'string' && typeof two === 'number') {
      return -1;
    } else {
      const result = String(one).localeCompare(String(two));
      if (result !== 0) return result > 0 ? 1 : -1;
    }
  }
  return 0;
}

function preferredAssetName(version: string): string {
  const arch = process.arch === 'ia32' ? 'ia32' : 'x64';
  return 'Sotto-Setup-' + version.replace(/^v/i, '') + '-' + arch + '.exe';
}

function chooseAsset(release: GitHubRelease): GitHubAsset | null {
  const preferred = preferredAssetName(release.tag_name);
  const exact = release.assets.find((asset) => asset.name === preferred);
  if (exact) return exact;
  const arch = process.arch === 'ia32' ? 'ia32' : 'x64';
  return (
    release.assets.find(
      (asset) =>
        /^Sotto-Setup-.*\.exe$/i.test(asset.name) &&
        asset.name.toLowerCase().includes(arch) &&
        !/portable/i.test(asset.name)
    ) || null
  );
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Sotto-Updater'
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const release = (await response.json()) as GitHubRelease;
    if (!release || release.prerelease || !release.tag_name) return null;
    const latestVersion = release.tag_name.replace(/^v/i, '');
    const asset = chooseAsset(release);
    const checksum = release.assets.find((item) => item.name === 'SHA256SUMS.txt');
    return {
      currentVersion,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: release.html_url || RELEASES_PAGE,
      assetName: asset?.name ?? null,
      assetUrl: asset?.browser_download_url ?? null,
      assetSize: asset?.size ?? null,
      checksumUrl: checksum?.browser_download_url ?? null,
      publishedAt: release.published_at,
      notes: String(release.body || '').slice(0, 5000)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match) result.set(match[2].trim().toLowerCase(), match[1].toLowerCase());
  }
  return result;
}

export async function downloadUpdate(
  info: UpdateInfo,
  directory: string,
  onProgress: (progress: UpdateProgress) => void
): Promise<string> {
  if (!info.assetUrl || !info.assetName) throw new Error('这个发行版没有可用的安装包');
  if (!info.checksumUrl) throw new Error('发行版缺少 SHA256SUMS.txt，出于安全考虑已取消下载');

  const safeName = path.basename(info.assetName).replace(/[^a-zA-Z0-9._-]/g, '_');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, safeName);
  const temporary = target + '.part';
  await fs.rm(temporary, { force: true });

  const checksumText = await (await fetch(info.checksumUrl, { headers: { 'User-Agent': 'Sotto-Updater' } })).text();
  const expected = parseChecksums(checksumText).get(safeName.toLowerCase()) || parseChecksums(checksumText).get(info.assetName.toLowerCase());
  if (!expected) throw new Error('校验文件中找不到安装包，出于安全考虑已取消下载');

  const response = await fetch(info.assetUrl, { headers: { 'User-Agent': 'Sotto-Updater' } });
  if (!response.ok || !response.body) throw new Error('下载更新失败：HTTP ' + response.status);

  const total = Number(response.headers.get('content-length') || info.assetSize || 0) || 0;
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(temporary, 'w');
  let downloaded = 0;
  let lastEmit = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      downloaded += buffer.length;
      hash.update(buffer);
      await handle.write(buffer);
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        onProgress({
          phase: 'downloading',
          downloaded,
          total,
          percent: total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : 0,
          message: '正在下载更新…'
        });
      }
    }
  } finally {
    await handle.close();
  }

  const actual = hash.digest('hex');
  if (actual !== expected) {
    await fs.rm(temporary, { force: true });
    throw new Error('安装包 SHA-256 校验失败，已删除下载文件');
  }
  onProgress({ phase: 'verifying', downloaded, total, percent: 100, message: '校验通过，正在准备安装…' });
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
  onProgress({ phase: 'ready', downloaded, total, percent: 100, message: '更新已下载，可以安装' });
  return target;
}

export { RELEASES_PAGE };