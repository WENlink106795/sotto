#!/usr/bin/env node
/**
 * Build a small throwaway ASMR library for manual testing and screenshots.
 * Output: <project>/demo-library
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'demo-library');

function writeWav(seconds, frequency) {
  const sampleRate = 8000;
  const count = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.12 * 32767;
    data.writeInt16LE(Math.round(sample), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x / width, y / height);
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw[offset] = Math.max(0, Math.min(255, Math.round(r)));
      raw[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const artworks = [
  ['cover-night.jpg', (u, v) => [20 + 60 * u, 28 + 40 * v, 70 + 100 * u]],
  ['cover-garden.jpg', (u, v) => [40 + 80 * v, 90 + 80 * u, 70 + 50 * v]],
  ['cover-sea.jpg', (u, v) => [10 + 30 * u, 40 + 70 * v, 90 + 90 * u]],
  ['room.jpg', (u, v) => [90 + 60 * u, 70 + 40 * v, 60 + 40 * u]]
];

const vtt = (lines) => 'WEBVTT\n\n' + lines.map((line, index) => {
  const start = 1 + index * 3;
  const end = start + 2.4;
  const stamp = (value) => '00:00:' + String(Math.floor(value)).padStart(2, '0') + '.' + String(Math.round((value % 1) * 1000)).padStart(3, '0');
  return (index + 1) + '\n' + stamp(start) + ' --> ' + stamp(end) + '\n' + line;
}).join('\n\n') + '\n';

const srt = (lines) => lines.map((line, index) => {
  const start = 1 + index * 3;
  const end = start + 2.4;
  const stamp = (value) => '00:00:' + String(Math.floor(value)).padStart(2, '0') + ',' + String(Math.round((value % 1) * 1000)).padStart(3, '0');
  return (index + 1) + '\n' + stamp(start) + ' --> ' + stamp(end) + '\n' + line;
}).join('\n\n') + '\n';

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  const folders = [
    {
      dir: '雨夜图书馆',
      audio: ['【简体】01 雨夜与翻书声♡.wav', '02 - 壁炉旁的耳语 ☆.wav'],
      subs: [
        { name: '01 雨夜与翻书声.vtt', text: vtt(['外面在下雨。', '把书翻到上次那一页吧。', '我就在这里，陪你一会儿。']) },
        { name: '壁炉旁的耳语.srt', text: srt(['火苗轻轻响着。', '靠过来一点。', '晚安。']) }
      ],
      images: ['cover-night.jpg', 'room.jpg']
    },
    {
      dir: '耳语花园',
      audio: ['03 花房里的悄悄话.flac', '04 午后庭院（完整版）.wav'],
      subs: [
        { name: '花房里的悄悄话.vtt', text: vtt(['你闻到栀子花了吗？', '风从玻璃顶棚吹下来。', '嘘——小声一点。']) },
        { name: '04 午后庭院.vtt', text: vtt(['阳光有点晃眼。', '把帽子戴上吧。', '睡一会儿也没关系。']) }
      ],
      images: ['cover-garden.jpg']
    },
    {
      dir: '深海电台',
      audio: ['05 深海电台 第1夜.wav'],
      subs: [{ name: '深海电台 第1夜.vtt', text: vtt(['这里是深海电台。', '今晚的水温是 18 度。', '信号会有点远。']) }],
      images: ['cover-sea.jpg']
    },
    {
      dir: '旧唱片店',
      audio: ['06 旧唱片店 - Side A.wav'],
      subs: [{ name: '另一张专辑的字幕.vtt', text: vtt(['这张唱片有一点划痕。', '但声音还是很好听。']) }],
      images: ['room.jpg']
    }
  ];

  for (const folder of folders) {
    const dir = path.join(OUT, folder.dir);
    await fs.mkdir(path.join(dir, '字幕'), { recursive: true });
    await fs.mkdir(path.join(dir, 'Scans'), { recursive: true });
    for (const audio of folder.audio) {
      await fs.writeFile(path.join(dir, audio), writeWav(1.2, 220 + Math.random() * 80));
    }
    for (const sub of folder.subs) {
      await fs.writeFile(path.join(dir, '字幕', sub.name), sub.text, 'utf8');
    }
    for (const image of folder.images) {
      const art = artworks.find(([name]) => name === image) || artworks[0];
      const png = writePng(320, 320, art[1]);
      const target = path.join(dir, image.replace(/\.jpg$/, '.png'));
      await fs.writeFile(target, png);
    }
  }
  await fs.writeFile(path.join(OUT, '说明.txt'), 'Sotto demo library. Safe to delete.\n', 'utf8');
  console.log('demo library created at ' + OUT);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
