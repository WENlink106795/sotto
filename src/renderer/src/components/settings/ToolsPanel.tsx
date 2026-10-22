import { useState } from 'react';
import { AudioLines, Download, ExternalLink, Github, HardDrive, RefreshCw, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { Button, Modal, SettingRow, SettingsCard, Switch } from '../ui';
import { api } from '../../lib/bridge';
import FfmpegStatus from './FfmpegStatus';

export default function ToolsPanel(): JSX.Element {
  const appInfo = useAppStore((state) => state.appInfo);
  const openPath = useAppStore((state) => state.openPath);
  const exportLogs = useAppStore((state) => state.exportLogs);
  const exportSettings = useAppStore((state) => state.exportSettings);
  const importSettings = useAppStore((state) => state.importSettings);
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const checkUpdates = useAppStore((state) => state.checkUpdates);
  const updateChecking = useAppStore((state) => state.updateChecking);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const updateDownloading = useAppStore((state) => state.updateDownloading);
  const updateDownloadedPath = useAppStore((state) => state.updateDownloadedPath);
  const startUpdateDownload = useAppStore((state) => state.startUpdateDownload);
  const installUpdate = useAppStore((state) => state.installUpdate);
  const resetAppearance = useAppStore((state) => state.resetAppearance);
  const ffmpeg = useAppStore((state) => state.ffmpeg);
  const [loggingConsentOpen, setLoggingConsentOpen] = useState(false);

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

      <SettingsCard
        title="本地数据"
        description="设置、运行记录与日志都保存在本机用户数据目录。遇到问题时，可导出诊断日志用于反馈；文件可能包含路径，请先检查再分享。"
      >
        <SettingRow
          title="记录本地诊断日志"
          description="默认关闭。开启后会记录错误、崩溃与转码摘要，用于排查问题；不会自动上传。"
          control={
            <Switch
              checked={settings.general.loggingEnabled}
              onChange={(enabled) => {
                if (enabled) setLoggingConsentOpen(true);
                else updateSettings({ general: { loggingEnabled: false } });
              }}
              label="记录本地诊断日志"
            />
          }
        />
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
          <Button variant="primary" size="sm" onClick={() => void exportLogs()}>
            <Download size={13} />
            导出诊断日志
          </Button>
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
          <Button variant="secondary" size="sm" onClick={() => void exportSettings()}>
            <Download size={13} />
            导出设置
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void importSettings()}>
            <Upload size={13} />
            导入设置
          </Button>
          <Button variant="ghost" size="sm" onClick={resetAppearance}>
            <RotateCcw size={13} />
            恢复默认外观
          </Button>
        </div>
        <div className="callout">
          <ShieldCheck size={14} />
          导出的 .log 文件包含应用版本、环境信息、最近错误和整理日志；它只保存在你选择的位置，不会自动上传。清理用户数据目录会同时移除运行记录与可撤销信息，请谨慎操作。
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
          Sotto 默认不联网，也不收集任何使用数据。只有你手动检查更新或开启自动更新时会访问 GitHub Releases，且不会上传本地文件、路径或日志。所有文件处理都在本机完成。
        </p>
        <SettingRow
          title="自动检查更新"
          description="开启后每天第一次打开软件时检查 GitHub Releases；有更新才在右下角提醒，每天最多一次。检查会访问 GitHub，但不会上传任何本地文件。"
          control={
            <Switch
              checked={settings.general.autoUpdate}
              onChange={(enabled) => {
                updateSettings({ general: { autoUpdate: enabled } });
                if (enabled) void checkUpdates(true, false);
              }}
              label="自动检查更新"
            />
          }
        />
        <div className="tools-actions" style={{ marginTop: 10 }}>
          <Button variant="secondary" size="sm" disabled={updateChecking} onClick={() => void checkUpdates(true, true)}>
            <RefreshCw size={13} className={updateChecking ? 'spin' : undefined} />
            {updateChecking ? '正在检查…' : '检查更新'}
          </Button>
          {updateInfo?.hasUpdate ? (
            <Button
              variant="primary"
              size="sm"
              disabled={updateDownloading || !updateInfo.assetUrl}
              onClick={() => {
                if (updateDownloadedPath) void installUpdate();
                else void startUpdateDownload();
              }}
            >
              <Download size={13} className={updateDownloading ? 'spin' : undefined} />
              {updateDownloading ? '正在下载…' : updateDownloadedPath ? '安装并重启' : '一键下载更新'}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => { void api.openExternal('https://github.com/WENlink106795/sotto').catch(() => undefined); }}>
            <Github size={13} />
            GitHub 仓库
          </Button>
          {updateInfo?.hasUpdate ? <span className="chip chip-success">发现 v{updateInfo.latestVersion}</span> : null}
        </div>
      </SettingsCard>

      <Modal
        open={loggingConsentOpen}
        onClose={() => setLoggingConsentOpen(false)}
        className="settings-consent-modal"
        labelledBy="logging-consent-title"
      >
        <div className="modal-head">
          <div className="modal-head-main">
            <h3 className="modal-title" id="logging-consent-title">开启本地诊断日志？</h3>
            <p className="modal-sub">只保存在本机，可随时关闭。</p>
          </div>
        </div>
        <div className="modal-body">
          <p>日志只保存在这台电脑的 %APPDATA%\Sotto\logs，不会自动上传，也不会读取你的作品内容。</p>
          <p>为了排查崩溃和转码问题，日志会记录应用版本、错误堆栈、文件路径与操作摘要；导出时会把用户主目录替换为 ~，但仍可能包含作品文件夹名。</p>
          <p>你可以随时在「设置 › 工具」关闭日志记录。关闭后不会再写入新的日志。</p>
        </div>
        <div className="modal-foot">
          <Button variant="ghost" size="sm" onClick={() => setLoggingConsentOpen(false)}>取消</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              updateSettings({ general: { loggingEnabled: true } });
              setLoggingConsentOpen(false);
            }}
          >
            同意并开启
          </Button>
        </div>
      </Modal>
    </div>
  );
}
