import { X, Download, ExternalLink, RotateCw, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui';

export default function UpdatePrompt(): JSX.Element | null {
  const open = useAppStore((state) => state.updatePromptOpen);
  const info = useAppStore((state) => state.updateInfo);
  const downloading = useAppStore((state) => state.updateDownloading);
  const progress = useAppStore((state) => state.updateProgress);
  const downloadedPath = useAppStore((state) => state.updateDownloadedPath);
  const error = useAppStore((state) => state.updateError);
  const dismiss = useAppStore((state) => state.dismissUpdatePrompt);
  const startDownload = useAppStore((state) => state.startUpdateDownload);
  const install = useAppStore((state) => state.installUpdate);
  const openRelease = useAppStore((state) => state.openReleasePage);

  if (!open || !info) return null;
  const canDownload = Boolean(info.assetUrl);
  const percent = progress ? Math.max(0, Math.min(100, progress.percent)) : 0;

  return (
    <div className="update-overlay" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-card">
        <button type="button" className="update-close" aria-label="关闭更新提醒" title="关闭" onClick={dismiss}>
          <X size={15} />
        </button>
        <div className="update-eyebrow">
          <ShieldCheck size={13} />
          检查到新版本
        </div>
        <h2 className="update-title" id="update-title">
          Sotto {info.latestVersion} 已发布
        </h2>
        <p className="update-copy">
          当前版本 v{info.currentVersion}。可以在软件内静默下载安装包，或前往 GitHub Releases 查看完整更新说明。
        </p>
        <p className="update-note">这个提醒每天只出现一次；你可以在「设置 › 工具」关闭自动更新。</p>

        {downloading || downloadedPath ? (
          <div className="update-progress-wrap">
            <div className="update-progress-label">
              <span>{downloadedPath ? '下载完成，等待安装' : progress?.message || '正在下载更新…'}</span>
              <span>{downloadedPath ? '100%' : percent + '%'}</span>
            </div>
            <div className="update-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="update-progress-fill" style={{ width: (downloadedPath ? 100 : percent) + '%' }} />
            </div>
          </div>
        ) : null}

        {error ? <p className="update-error">{error}</p> : null}

        <div className="update-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={downloading || !canDownload}
            onClick={() => {
              if (downloadedPath) void install();
              else void startDownload();
            }}
          >
            {downloadedPath ? <RotateCw size={13} /> : <Download size={13} />}
            {downloadedPath ? '安装并重启' : downloading ? '正在下载…' : canDownload ? '在软件内升级' : '此版本无安装包'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void openRelease()}>
            <ExternalLink size={13} />
            前往下载页
          </Button>
        </div>
      </div>
    </div>
  );
}
