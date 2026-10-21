import { Info, TriangleAlert } from 'lucide-react';
import type { SubtitleEncoding } from '@shared/types';
import { useAppStore } from '../../store/useAppStore';
import { SettingRow, SettingsCard, Switch } from '../ui';

const ENCODINGS: { value: SubtitleEncoding; title: string; description: string; badge?: string }[] = [
  {
    value: 'utf-8',
    title: 'UTF-8',
    description: '无 BOM，绝大多数播放器与字幕工具都能正确识别。',
    badge: '推荐'
  },
  {
    value: 'utf-8-bom',
    title: 'UTF-8 BOM',
    description: '部分车载、老款播放器需要 BOM 才能正确显示中文。'
  },
  {
    value: 'gb18030',
    title: 'GB18030',
    description: '国标编码，适合只支持 GBK / GB18030 的旧设备。'
  }
];

const OFFSETS = [-500, -100, 0, 100, 500];

const SAMPLE_LRC = [
  '[ti:雨夜书房]',
  '[ar:Whisper Garden]',
  '[00:00.35]……',
  '[00:04.20]雨落在窗沿上。',
  '[00:09.80]把耳机戴好，慢慢呼吸。',
  '[00:16.40]现在，只需要听着雨声。'
];

export default function SubtitlePanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const subtitle = settings.subtitle;

  const setOffset = (value: number): void => {
    const clamped = Math.max(-60000, Math.min(60000, Math.round(value)));
    updateSettings({ subtitle: { offsetMs: clamped } });
  };

  return (
    <div className="panel-stack">
      <SettingsCard
        title="输出编码"
        description="转换后的 LRC 会使用所选编码写入。硬件播放器通常只认一种编码，建议先确认设备说明书。"
      >
        <div className="encoding-list" role="radiogroup" aria-label="字幕输出编码">
          {ENCODINGS.map((encoding) => {
            const active = subtitle.encoding === encoding.value;
            return (
              <button
                key={encoding.value}
                type="button"
                role="radio"
                aria-checked={active}
                className={'encoding-option' + (active ? ' is-active' : '')}
                onClick={() => updateSettings({ subtitle: { encoding: encoding.value } })}
              >
                <span className="radio-mark" aria-hidden="true" />
                <span className="option-main">
                  <span className="option-title">
                    {encoding.title}
                    {encoding.badge ? <span className="chip chip-accent">{encoding.badge}</span> : null}
                  </span>
                  <span className="option-desc">{encoding.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="callout callout-accent">
          <Info size={14} />
          编码只影响新写入的 LRC 文件，源 VTT / SRT 不会被改写（除非开启「删除源字幕」）。
        </div>
        <div className="lrc-sample" aria-label="LRC 输出示例">
          {SAMPLE_LRC.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="转换规则" description="决定哪些字幕会被转换，以及时间轴如何处理。">
        <SettingRow
          title="转换 VTT 字幕"
          description="WebVTT 是最常见的格式，会保留说话人标记与时间轴。"
          control={<Switch checked={subtitle.convertVtt} onChange={(convertVtt) => updateSettings({ subtitle: { convertVtt } })} label="转换 VTT 字幕" />}
        />
        <SettingRow
          title="转换 SRT 字幕"
          description="SubRip 字幕会转换为相同的 LRC 时间轴结构。"
          control={<Switch checked={subtitle.convertSrt} onChange={(convertSrt) => updateSettings({ subtitle: { convertSrt } })} label="转换 SRT 字幕" />}
        />
        <SettingRow
          title="写入元信息"
          description="在 LRC 头部写入 [ti:] 与 [ar:]，部分播放器会读取它们。"
          control={<Switch checked={subtitle.includeMetadata} onChange={(includeMetadata) => updateSettings({ subtitle: { includeMetadata } })} label="写入元信息" />}
        />
        <SettingRow
          title="合并连续短句"
          description="把间隔极短的多行字幕合并为一行，避免播放器闪烁。"
          control={<Switch checked={subtitle.mergeLines} onChange={(mergeLines) => updateSettings({ subtitle: { mergeLines } })} label="合并连续短句" />}
        />
        <SettingRow
          title="时间轴偏移"
          description="统一提前或延后字幕，单位为毫秒，范围 ±60 秒。"
          control={
            <div className="offset-control">
              <input
                className="input number-input"
                type="number"
                min={-60000}
                max={60000}
                step={10}
                value={subtitle.offsetMs}
                onChange={(event) => setOffset(Number(event.target.value))}
                aria-label="字幕时间轴偏移（毫秒）"
              />
              <span className="offset-unit">ms</span>
              <div className="offset-chips">
                {OFFSETS.map((offset) => (
                  <button
                    key={offset}
                    type="button"
                    className={'btn btn-ghost btn-sm' + (subtitle.offsetMs === offset ? ' is-current' : '')}
                    onClick={() => setOffset(offset)}
                  >
                    {offset === 0 ? '0' : offset > 0 ? '+' + offset : offset}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        <SettingRow
          title="删除源字幕"
          description="转换成功后把 VTT / SRT / TXT 移入回收站，只保留 LRC。"
          control={
            <Switch
              checked={subtitle.deleteSource}
              onChange={(deleteSource) => updateSettings({ subtitle: { deleteSource } })}
              label="删除源字幕"
            />
          }
        />
        {subtitle.deleteSource ? (
          <div className="callout callout-warn">
            <TriangleAlert size={14} />
            源字幕会被移入系统回收站。仍可通过运行历史撤销，但清空回收站后将无法恢复。
          </div>
        ) : null}
      </SettingsCard>
    </div>
  );
}