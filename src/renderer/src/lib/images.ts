import { DEFAULT_SETTINGS } from '@shared/defaults';
import type { ThemePreset, ThemeSettings } from '@shared/types';

const PALETTES: string[][] = [
  ['#1a2233', '#31476b', '#8fb6d9'],
  ['#241a2b', '#4a3357', '#c9a3d8'],
  ['#0f1f24', '#1f4a52', '#79c6bd'],
  ['#241d16', '#4d3823', '#e0a76a'],
  ['#1c1c22', '#3d3d4a', '#b7b7cc'],
  ['#241a1f', '#553344', '#e3a2b4'],
  ['#161d1a', '#2f4038', '#9ac4ab'],
  ['#201a14', '#4b3524', '#d9a273']
];

function hash(input: string): number {
  let value = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function pick(value: number, max: number): number {
  return max <= 0 ? 0 : value % max;
}

export function coverArt(seed: string): string {
  const h = hash(seed || 'sotto');
  const palette = PALETTES[pick(h, PALETTES.length)];
  const x1 = 80 + pick(h >> 3, 440);
  const y1 = 70 + pick(h >> 7, 260);
  const x2 = 90 + pick(h >> 11, 420);
  const y2 = 300 + pick(h >> 15, 230);
  const radius = 150 + pick(h >> 19, 120);
  const rotation = pick(h >> 23, 60) - 30;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="' + palette[0] + '"/>',
    '<stop offset="1" stop-color="' + palette[1] + '"/>',
    '</linearGradient>',
    '<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">',
    '<stop offset="0" stop-color="' + palette[2] + '" stop-opacity="0.55"/>',
    '<stop offset="1" stop-color="' + palette[2] + '" stop-opacity="0"/>',
    '</radialGradient>',
    '<filter id="blur"><feGaussianBlur stdDeviation="46"/></filter>',
    '<filter id="grain">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>',
    '<feColorMatrix type="saturate" values="0"/>',
    '<feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer>',
    '</filter>',
    '</defs>',
    '<rect width="600" height="600" fill="url(#bg)"/>',
    '<circle cx="' + x1 + '" cy="' + y1 + '" r="' + radius + '" fill="url(#glow)" filter="url(#blur)"/>',
    '<circle cx="' + x2 + '" cy="' + y2 + '" r="' + Math.round(radius * 0.8) + '" fill="' + palette[2] + '" opacity="0.08" filter="url(#blur)"/>',
    '<g transform="rotate(' + rotation + ' 300 300)" opacity="0.5">',
    '<rect x="64" y="64" width="472" height="472" rx="24" fill="none" stroke="' + palette[2] + '" stroke-opacity="0.18"/>',
    '<rect x="92" y="92" width="416" height="416" rx="18" fill="none" stroke="' + palette[2] + '" stroke-opacity="0.1"/>',
    '</g>',
    '<circle cx="' + Math.round(150 + pick(h >> 5, 300)) + '" cy="' + Math.round(120 + pick(h >> 9, 360)) + '" r="2.5" fill="#ffffff" opacity="0.5"/>',
    '<circle cx="' + Math.round(150 + pick(h >> 13, 300)) + '" cy="' + Math.round(120 + pick(h >> 17, 360)) + '" r="1.6" fill="#ffffff" opacity="0.35"/>',
    '<rect width="600" height="600" filter="url(#grain)" opacity="0.7"/>',
    '<text x="48" y="536" fill="#ffffff" fill-opacity="0.6" font-family="Segoe UI, sans-serif" font-size="16" letter-spacing="6">SOTTO</text>',
    '<text x="48" y="566" fill="#ffffff" fill-opacity="0.3" font-family="Segoe UI, sans-serif" font-size="13" letter-spacing="2">WHISPER ARCHIVE</text>',
    '</svg>'
  ].join('');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export function isMockBridge(): boolean {
  return typeof window !== 'undefined' && !window.murmur;
}

export function imageSrc(path: string | null | undefined): string {
  if (!path) return '';
  if (path.startsWith('data:')) return path;
  if (typeof window !== 'undefined' && window.murmur) {
    return 'murmur://image?path=' + encodeURIComponent(path);
  }
  return coverArt(path);
}

export const PRESET_LABELS: Record<ThemePreset, { name: string; description: string; tagline: string }> = {
  fluent: {
    name: 'Fluent',
    description: '层叠亚克力 · 细腻描边',
    tagline: '安静、通透，像 Windows 11 的一部分。'
  },
  material: {
    name: 'Material You',
    description: '色调表面 · 饱满圆角',
    tagline: '由强调色晕染的柔和界面，留白更从容。'
  },
  studio: {
    name: 'Studio',
    description: '高对比 · 精密网格',
    tagline: '近乎全黑的专注台面，数字使用等宽字体。'
  }
};

export const PRESET_RADIUS: Record<ThemePreset, number> = {
  fluent: 10,
  material: 22,
  studio: 8
};

export const ACCENT_SWATCHES: { value: string; name: string }[] = [
  { value: '#4f8df7', name: '雾蓝' },
  { value: '#8b7cf6', name: '暮紫' },
  { value: '#2fb8a6', name: '青瓷' },
  { value: '#e9a23b', name: '琥珀' },
  { value: '#ef7d8d', name: '樱粉' },
  { value: '#6aa86b', name: '苔绿' },
  { value: '#d2694f', name: '陶土' },
  { value: '#8fa3b0', name: '石墨' }
];

export function buildDefaultTheme(): ThemeSettings {
  return { ...DEFAULT_SETTINGS.theme };
}
