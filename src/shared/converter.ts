import type { ConverterEngineId } from './types';

export interface ConverterEngineOption {
  id: ConverterEngineId;
  label: string;
  shortLabel: string;
  license: string;
  description: string;
}

export const CONVERTER_ENGINE_OPTIONS: ConverterEngineOption[] = [
  {
    id: 'openconverter',
    label: 'OpenConverter 核心',
    shortLabel: 'OpenConverter',
    license: 'Apache-2.0',
    description: 'OpenConverter 的 FFmpeg 音频命令核心；OGG 使用 Opus，320k 档位会钳制到 256k。'
  }
];

export const DEFAULT_CONVERTER_ENGINE: ConverterEngineId = 'openconverter';

export function engineLabel(id: ConverterEngineId): string {
  return CONVERTER_ENGINE_OPTIONS.find((engine) => engine.id === id)?.shortLabel || id;
}
