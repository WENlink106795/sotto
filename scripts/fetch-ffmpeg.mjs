#!/usr/bin/env node
/**
 * Download ffmpeg binaries for Windows packaging.
 *
 *   node scripts/fetch-ffmpeg.mjs             # both x64 and ia32
 *   node scripts/fetch-ffmpeg.mjs --arch x64
 *   node scripts/fetch-ffmpeg.mjs --force
 *
 * x64  : BtbN FFmpeg-Builds (latest win64-lgpl static, includes ffmpeg + ffprobe)
 * ia32 : @ffmpeg-installer/win32-ia32 npm tarball (legacy ffmpeg 4.x, compatible build)
 */
import { createWriteStream, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'resources', 'ffmpeg');
const args = process.argv.slice(2);
const force = args.includes('--force');
const archArgIndex = args.indexOf('--arch');
const archFilter = archArgIndex >= 0 ? args[archArgIndex + 1] : null;
const arches = archFilter ? [archFilter] : ['x64', 'ia32'];

if (archFilter && !['x64', 'ia32'].includes(archFilter)) {
  console.error('Unknown arch: ' + archFilter + ' (use x64 or ia32)');
  process.exit(1);
}

function log(message) {
  console.log('[ffmpeg] ' + message);
}

async function download(url, target) {
  log('downloading ' + url);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error('Download failed: HTTP ' + response.status);
  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;
  const file = createWriteStream(target);
  const reader = response.body.getReader();
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    file.write(Buffer.from(value));
    const now = Date.now();
    if (now - lastReport > 1500) {
      lastReport = now;
      const pct = total ? ' (' + Math.round((received / total) * 100) + '%)' : '';
      log('  ' + (received / 1024 / 1024).toFixed(1) + ' MiB' + pct);
    }
  }
  await new Promise((resolve, reject) => {
    file.end((error) => (error ? reject(error) : resolve()));
  });
  log('saved ' + path.relative(ROOT, target));
}

function run(command, commandArgs, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(command + ' exited with ' + code + '\n' + stderr));
    });
  });
}

async function extractZip(zipPath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  try {
    await run('tar', ['-xf', zipPath, '-C', outDir]);
    return;
  } catch {
    const command = 'Expand-Archive -LiteralPath ' + JSON.stringify(zipPath) + ' -DestinationPath ' + JSON.stringify(outDir) + ' -Force';
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]);
  }
}

async function extractTarGz(tgzPath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  await run('tar', ['-xzf', tgzPath, '-C', outDir]);
}

async function findFile(rootDir, name) {
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.shift();
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

async function verify(exePath) {
  return new Promise((resolve) => {
    const child = spawn(exePath, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk.toString()));
    child.stderr.on('data', (chunk) => (out += chunk.toString()));
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code === 0) log(exePath.replace(ROOT + path.sep, '') + ' -> ' + out.split('\n')[0].trim());
      resolve(code === 0);
    });
  });
}

async function fetchX64() {
  const targetDir = path.join(RES, 'x64');
  const exe = path.join(targetDir, 'ffmpeg.exe');
  if (!force && existsSync(exe)) {
    log('x64 already present (use --force to refresh)');
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sotto-ffmpeg-x64-'));
  const zip = path.join(tmp, 'ffmpeg.zip');
  const assetUrl =
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip';
  log('downloading latest BtbN win64 LGPL build');
  await fs.mkdir(targetDir, { recursive: true });
  await download(assetUrl, zip);
  await extractZip(zip, path.join(tmp, 'out'));
  const ffmpeg = await findFile(path.join(tmp, 'out'), 'ffmpeg.exe');
  if (!ffmpeg) throw new Error('ffmpeg.exe not found in archive');
  const ffprobe = await findFile(path.join(tmp, 'out'), 'ffprobe.exe');
  await fs.copyFile(ffmpeg, exe);
  if (ffprobe) await fs.copyFile(ffprobe, path.join(targetDir, 'ffprobe.exe'));
  const license = await findFile(path.join(tmp, 'out'), 'LICENSE.txt');
  if (license) await fs.copyFile(license, path.join(targetDir, 'LICENSE.txt'));
  await fs.rm(tmp, { recursive: true, force: true });
  if (!(await verify(exe))) throw new Error('Downloaded x64 ffmpeg failed to run');
}

async function fetchIa32() {
  const targetDir = path.join(RES, 'ia32');
  const exe = path.join(targetDir, 'ffmpeg.exe');
  if (!force && existsSync(exe)) {
    log('ia32 already present (use --force to refresh)');
    return;
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sotto-ffmpeg-ia32-'));
  log('resolving @ffmpeg-installer/win32-ia32');
  const meta = await (await fetch('https://registry.npmjs.org/@ffmpeg-installer/win32-ia32', { headers: { 'User-Agent': 'sotto-build' } })).json();
  const version = meta['dist-tags'].latest;
  const tarball = meta.versions[version].dist.tarball;
  const tgz = path.join(tmp, 'ffmpeg.tgz');
  await fs.mkdir(targetDir, { recursive: true });
  await download(tarball, tgz);
  await extractTarGz(tgz, path.join(tmp, 'out'));
  const ffmpeg = await findFile(path.join(tmp, 'out'), 'ffmpeg.exe');
  if (!ffmpeg) throw new Error('ffmpeg.exe not found in npm tarball');
  await fs.copyFile(ffmpeg, exe);
  const license = await findFile(path.join(tmp, 'out'), 'LICENSE');
  if (license) await fs.copyFile(license, path.join(targetDir, 'LICENSE.txt'));
  await fs.rm(tmp, { recursive: true, force: true });
  if (!(await verify(exe))) throw new Error('Downloaded ia32 ffmpeg failed to run');
}

async function main() {
  await fs.mkdir(RES, { recursive: true });
  for (const arch of arches) {
    if (arch === 'x64') await fetchX64();
    else await fetchIa32();
  }
  log('done. binaries live under resources/ffmpeg/<arch>/');
}

main().catch((error) => {
  console.error('[ffmpeg] failed:', error.message);
  process.exit(1);
});