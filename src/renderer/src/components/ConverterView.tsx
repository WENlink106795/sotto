import { AudioLines } from 'lucide-react';
import ConverterPanel from './settings/ConverterPanel';
import { SettingsCard } from './ui';

export default function ConverterView(): JSX.Element {
  return (
    <div className="settings-view">
      <div className="settings-inner">
        <header className="view-header">
          <div>
            <span className="eyebrow">
              <AudioLines size={11} />
              LOCAL FFMPEG TOOL
            </span>
            <h1 className="view-title">转码工具</h1>
            <p className="view-sub">
              选择单个音频或整个文件夹，批量转成 MP3 / AAC / M4A / OGG。默认输出到源目录下的 Sotto-converted，也可以自己指定目录。
            </p>
          </div>
        </header>

        <SettingsCard
          title="独立转码"
          description="不经过资料库整理流程，直接转换你选中的文件。转码完成后只在输出目录写入新文件，不会修改源文件。"
        >
          <ConverterPanel />
        </SettingsCard>
      </div>
    </div>
  );
}
