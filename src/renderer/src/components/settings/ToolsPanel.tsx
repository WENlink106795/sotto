import { AudioLines, ExternalLink, HardDrive, RotateCcw, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Button, SettingsCard } from '../ui';
import FfmpegStatus from './FfmpegStatus';

export default function ToolsPanel(): JSX.Element {
  const appInfo = useAppStore((state) => state.appInfo);
  const openPath = useAppStore((state) => state.openPath);
  const resetAppearance = useAppStore((state) => state.resetAppearance);
  const ffmpeg = useAppStore((state) => state.ffmpeg);

  const versions = [
    { label: 'Sotto', value: appInfo?.version || '—' },
    { label: 'Electron', value: appInfo?.electron || '—' },
    { label: 'Chromium', value: appInfo?.chrome || '—' },
    { label: 'Node.js', value: appInfo?.node || '—' },
    { label: '平台', value: appInfo ? appInfo.platform + ' / ' + appInfo.arch : '—' },
    { label: 'ffmpeg', value: ffmpeg?.version || '未检测到' }
  ];

  return (
    <div className="panel-stack">
      <SettingsCard title="ffmpeg" description="转码与封面转换的核心工具。若系统未安装，可下载后在此指定可执行文件路径。">
        <FfmpegStatus />
      </SettingsCard>

      <SettingsCard title="本地数据" description="设置、运行记录与日志都保存在本机用户数据目录，不会同步到网络。">
        <div className="path-row">
          <span className="path-row-label">用户数据</span>
          <span className="path-row-value" title={appInfo?.userDataPath || ''}>
            {appInfo?.userDataPath || '—'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (appInfo?.userDataPath) void openPath(appInfo.userDataPath);
            }}
          >
            <ExternalLink size={12} />
            打开
          </Button>
        </div>
        <div className="path-row">
          <span className="path-row-label">运行日志</span>
          <span className="path-row-value" title={appInfo?.logsPath || ''}>
            {appInfo?.logsPath || '—'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (appInfo?.logsPath) void openPath(appInfo.logsPath);
            }}
          >
            <ExternalLink size={12} />
            打开
          </Button>
        </div>
        <div className="tools-actions" style={{ marginTop: 10 }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (appInfo?.logsPath) void openPath(appInfo.logsPath);
            }}
          >
            <HardDrive size={13} />
            打开日志文件夹
          </Button>
          <Button variant="ghost" size="sm" onClick={resetAppearance}>
            <RotateCcw size={13} />
            恢复默认外观
          </Button>
        </div>
        <div className="callout">
          <ShieldCheck size={14} />
          清理用户数据目录会同时移除运行记录与可撤销信息，请谨慎操作。
        </div>
      </SettingsCard>

      <SettingsCard title="关于 Sotto" description="一个安静、专注的本地耳语资料库整理工具。">
        <div className="about-hero">
          <span className="about-logo">
            <AudioLines size={22} />
          </span>
          <div>
            <div className="about-name">Sotto 耳畔</div>
            <div className="about-tagline">让每一段耳语，都在播放器里被看见。</div>
          </div>
          <span className="chip chip-muted" style={{ marginLeft: 'auto' }}>
            {appInfo?.isPackaged ? '正式版' : '开发版'}
          </span>
        </div>
        <div className="version-grid">
          {versions.map((item) => (
            <div key={item.label} className="version-item">
              <span className="version-label">{item.label}</span>
              <span className="version-value" title={item.value}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
        <p className="settings-card-desc">
          Sotto 不收集任何使用数据，也不会发起网络请求。所有文件操作都发生在你的电脑上，执行前会展示完整预览，执行后写入本地日志。
        </p>
      </SettingsCard>
    </div>
  );
}
