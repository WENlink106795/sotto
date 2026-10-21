import { Info, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store/useAppStore';
import { Segmented, SettingRow, SettingsCard, Switch } from '../ui';
import FfmpegStatus from './FfmpegStatus';

const BITRATES = ['128', '192', '256', '320'];

export default function AudioPanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const convert = settings.convert;

  return (
    <div className="panel-stack">
      <SettingsCard
        title="音频转码"
        description="把 WAV、FLAC 等无损音频转为更通用的格式，方便手机、车载播放器与流媒体设备读取。"
      >
        <SettingRow
          title="启用音频转码"
          description="关闭后只整理名称、字幕与封面，不触碰音频内容。"
          control={<Switch checked={convert.enabled} onChange={(enabled) => updateSettings({ convert: { enabled } })} label="启用音频转码" />}
        />

        <div className={cn('transcode-block', !convert.enabled && 'is-dimmed')}>
          <div className="format-grid">
            <button
              type="button"
              className={cn('format-card', convert.format === 'mp3' && 'is-active')}
              onClick={() => updateSettings({ convert: { format: 'mp3' } })}
              aria-pressed={convert.format === 'mp3'}
            >
              <span className="format-icon">MP3</span>
              <span className="format-main">
                <span className="format-name">
                  MP3
                  {convert.format === 'mp3' ? <span className="format-check">已选择</span> : null}
                </span>
                <span className="format-desc">兼容性最好，几乎所有播放器都支持。</span>
              </span>
            </button>
            <button
              type="button"
              className={cn('format-card', convert.format === 'm4a' && 'is-active')}
              onClick={() => updateSettings({ convert: { format: 'm4a' } })}
              aria-pressed={convert.format === 'm4a'}
            >
              <span className="format-icon">M4A</span>
              <span className="format-main">
                <span className="format-name">
                  M4A
                  {convert.format === 'm4a' ? <span className="format-check">已选择</span> : null}
                </span>
                <span className="format-desc">相同码率下体积更小，适合 Apple 生态。</span>
              </span>
            </button>
          </div>

          <SettingRow
            title="码率"
            description="更高的码率保留更多细节，也会占用更多空间。"
            control={
              <Segmented
                value={String(convert.bitrateKbps)}
                options={BITRATES.map((value) => ({ value, label: value + 'k' }))}
                onChange={(value) => updateSettings({ convert: { bitrateKbps: Number(value) } })}
                ariaLabel="音频码率"
              />
            }
          />

          <SettingRow
            title="转换后删除原文件"
            description="转换成功后将无损原文件移入回收站，避免重复占用空间。"
            control={
              <Switch
                checked={convert.deleteOriginal}
                onChange={(deleteOriginal) => updateSettings({ convert: { deleteOriginal } })}
                label="转换后删除原文件"
              />
            }
          />

          {convert.deleteOriginal ? (
            <div className="callout callout-warn">
              <TriangleAlert size={14} />
              原文件会被移入系统回收站。若清空回收站，将无法通过运行历史恢复音频内容。
            </div>
          ) : null}
        </div>
      </SettingsCard>

      <SettingsCard title="输入格式" description="只有下列格式会参与转码；已经是目标格式的文件会跳过。">
        <div className="format-chips">
          {convert.formats.map((format) => (
            <span key={format} className="chip">
              {format.toUpperCase()}
            </span>
          ))}
        </div>
        <div className="callout">
          <Info size={14} />
          转码使用 ffmpeg 完成。转换会先生成临时文件，校验成功后再替换目标名称，中途失败不会留下损坏文件。
        </div>
      </SettingsCard>

      <SettingsCard title="ffmpeg" description="转码与封面格式转换依赖 ffmpeg。Sotto 会依次检查自定义路径、内置目录、PATH 与常见安装位置。">
        <FfmpegStatus />
      </SettingsCard>
    </div>
  );
}
