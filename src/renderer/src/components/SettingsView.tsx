import {
  Captions,
  Check,
  Image as ImageIcon,
  LoaderCircle,
  Palette,
  ShieldCheck,
  Type,
  Volume2,
  Wrench
} from 'lucide-react';
import type { SettingsTab } from '../store/useAppStore';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../lib/cn';
import { PanelHeading } from './ui';
import AppearancePanel from './settings/AppearancePanel';
import AudioPanel from './settings/AudioPanel';
import CoverPanel from './settings/CoverPanel';
import NamingPanel from './settings/NamingPanel';
import SubtitlePanel from './settings/SubtitlePanel';
import ToolsPanel from './settings/ToolsPanel';

interface PanelMeta {
  label: string;
  icon: typeof Palette;
  title: string;
  description: string;
  Component: () => JSX.Element;
}

const PANELS: Record<SettingsTab, PanelMeta> = {
  appearance: {
    label: '外观',
    icon: Palette,
    title: '外观',
    description: '选择主题、强调色与界面密度。所有外观设置会立即应用，并自动保存。',
    Component: AppearancePanel
  },
  naming: {
    label: '命名规则',
    icon: Type,
    title: '命名规则',
    description: '统一音频与字幕的名称，移除播放器不兼容的字符。输入示例即可实时预览结果。',
    Component: NamingPanel
  },
  subtitle: {
    label: '字幕',
    icon: Captions,
    title: '字幕',
    description: '决定 VTT 与 SRT 如何转换为播放器兼容的 LRC，以及输出使用的编码。',
    Component: SubtitlePanel
  },
  cover: {
    label: '封面',
    icon: ImageIcon,
    title: '封面',
    description: '决定作品文件夹的封面命名、自动选择与格式转换。',
    Component: CoverPanel
  },
  audio: {
    label: '音频',
    icon: Volume2,
    title: '音频',
    description: '可选地把 WAV、FLAC 等无损音频转为 MP3 或 M4A，方便更多设备播放。',
    Component: AudioPanel
  },
  tools: {
    label: '工具',
    icon: Wrench,
    title: '工具与关于',
    description: '管理 ffmpeg、查看本地数据路径与版本信息。',
    Component: ToolsPanel
  }
};

const TABS: SettingsTab[] = ['appearance', 'naming', 'subtitle', 'cover', 'audio', 'tools'];

export default function SettingsView(): JSX.Element {
  const tab = useAppStore((state) => state.settingsTab);
  const setTab = useAppStore((state) => state.setSettingsTab);
  const saving = useAppStore((state) => state.settingsSaving);
  const appInfo = useAppStore((state) => state.appInfo);
  const meta = PANELS[tab];
  const Panel = meta.Component;

  return (
    <div className="settings-view">
      <div className="settings-inner">
        <header className="view-header">
          <div>
            <h1 className="view-title">设置</h1>
            <p className="view-sub">外观、命名与工具偏好都会自动保存到本机。</p>
          </div>
          <div className="view-head-actions">
            {saving === 'saving' ? (
              <span className="chip chip-muted">
                <LoaderCircle size={11} className="spin" />
                正在保存…
              </span>
            ) : saving === 'saved' ? (
              <span className="chip chip-success">
                <Check size={11} />
                已保存
              </span>
            ) : (
              <span className="chip chip-muted">
                <ShieldCheck size={11} />
                自动保存
              </span>
            )}
            <span className="chip chip-muted">v{appInfo?.version || '0.1.0'}</span>
          </div>
        </header>

        <div className="settings-layout">
          <nav className="settings-subnav" aria-label="设置分类">
            {TABS.map((key) => {
              const item = PANELS[key];
              const Icon = item.icon;
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={cn('subnav-item', active && 'is-active')}
                  onClick={() => setTab(key)}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="subnav-icon">
                    <Icon size={15} />
                  </span>
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="settings-content">
            <div className="settings-panel" key={tab}>
              <PanelHeading title={meta.title} description={meta.description} />
              <Panel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}