import type { Settings } from './types';

export const DEFAULT_KEEP_PUNCTUATION = '-_()[]{}&,.!~@#%+【】「」『』《》〈〉、。，！？…—・·';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  theme: {
    preset: 'fluent',
    mode: 'system',
    accent: '#4f8df7',
    density: 'comfortable',
    radius: 10,
    transparency: true,
    reduceMotion: false,
    fontScale: 1
  },
  naming: {
    enabled: true,
    normalizeNfkc: true,
    removeEmoji: true,
    asciiOnly: false,
    keepPunctuation: DEFAULT_KEEP_PUNCTUATION,
    extraRemove: '',
    extraKeep: '',
    maxBaseLength: 100,
    collapseSpaces: true,
    renameAudioWithoutSubtitle: false
  },
  subtitle: {
    convertVtt: true,
    convertSrt: true,
    convertTxt: true,
    deleteSource: false,
    encoding: 'utf-8',
    includeMetadata: true,
    mergeLines: true,
    offsetMs: 0
  },
  cover: {
    enabled: true,
    autoPick: false,
    name: 'cover',
    convertToJpeg: true,
    overwrite: false
  },
  convert: {
    enabled: false,
    format: 'mp3',
    bitrateKbps: 192,
    deleteOriginal: false,
    formats: ['wav', 'flac', 'ape', 'aiff', 'aif', 'alac', 'wma'],
    concurrency: 1
  },
  general: {
    language: 'zh-CN',
    ffmpegPath: '',
    recentRoots: [],
    showAdvanced: false
  }
};

export const AUDIO_EXTENSIONS = ['wav', 'flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'aiff', 'aif', 'ape', 'alac', 'wv'];
export const SUBTITLE_EXTENSIONS = ['vtt', 'srt', 'lrc'];
export const TEXT_EXTENSIONS = ['txt'];
export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'avif'];

export const COVER_NAME_OPTIONS = ['cover', 'folder', 'front', 'album', '封面'];

export function cloneSettings(value: Settings): Settings {
  return JSON.parse(JSON.stringify(value)) as Settings;
}

export function mergeSettings(base: Settings, patch: unknown): Settings {
  if (!patch || typeof patch !== 'object') return cloneSettings(base);
  const source = patch as Record<string, unknown>;
  const result = cloneSettings(base);
  for (const key of Object.keys(result) as (keyof Settings)[]) {
    if (key === 'version') continue;
    const incoming = source[key];
    if (incoming && typeof incoming === 'object') {
      result[key] = { ...(result[key] as object), ...(incoming as object) } as never;
    }
  }
  return result;
}