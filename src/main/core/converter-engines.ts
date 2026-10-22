import type { ConverterFormat } from '@shared/types';
import { DEFAULT_CONVERTER_ENGINE } from '@shared/converter';

export { DEFAULT_CONVERTER_ENGINE };

export function buildConverterArgs(
  input: string,
  output: string,
  format: ConverterFormat,
  bitrateKbps: number
): string[] {
  const args = ['-y', '-i', input, '-map', '0:a:0', '-vn'];
  if (format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', bitrateKbps + 'k', '-id3v2_version', '3');
  else if (format === 'aac' || format === 'm4a') args.push('-c:a', 'aac', '-b:a', bitrateKbps + 'k');
  else args.push('-c:a', 'libopus', '-b:a', Math.min(bitrateKbps, 256) + 'k');
  if (format === 'aac') args.push('-f', 'adts');
  args.push('-map_metadata', '0', output);
  return args;
}
