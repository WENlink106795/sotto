import { AudioLines, ChevronRight, Download, FolderOpen, Folder, History, Library, Settings2, ShieldCheck } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatRelative } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import type { ViewKey } from '../lib/capture';

const NAV: { key: ViewKey; label: string; icon: typeof Library }[] = [
  { key: 'library', label: '资料库', icon: Library },
  { key: 'history', label: '运行历史', icon: History },
  { key: 'converter', label: '转码工具', icon: AudioLines },
  { key: 'settings', label: '设置', icon: Settings2 }
];

export default function Sidebar(): JSX.Element {
  const view = useAppStore((state) => state.view);
  const setView = useAppStore((state) => state.setView);
  const root = useAppStore((state) => state.root);
  const recentRoots = useAppStore((state) => state.settings.general.recentRoots);
  const openRoot = useAppStore((state) => state.openRoot);
  const pickFolder = useAppStore((state) => state.pickFolder);
  const applying = useAppStore((state) => state.applying);
  const plan = useAppStore((state) => state.plan);
  const historyCount = useAppStore((state) => state.history.length);
  const updateDownloading = useAppStore((state) => state.updateDownloading);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const updateProgress = useAppStore((state) => state.updateProgress);

  return (
    <aside className="app-sidebar" aria-label="主导航">
      <nav className="sidebar-nav" aria-label="工作区">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = view === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={cn('nav-item', active && 'is-active')}
              onClick={() => setView(item.key)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="nav-icon">
                <Icon size={16} strokeWidth={1.9} />
              </span>
              <span className="nav-label">{item.label}</span>
              {item.key === 'library' && plan ? <span className="nav-count">{plan.summary.pairs} 组</span> : null}
              {item.key === 'history' && historyCount > 0 ? <span className="nav-count">{historyCount}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-heading">最近打开</div>
      <div className="sidebar-recent">
        {recentRoots.length === 0 ? (
          <p className="recent-empty">还没有打开过资料库。选择一个作品文件夹，Sotto 会记住它。</p>
        ) : (
          recentRoots.map((item) => {
            const active = root === item.root;
            return (
              <button
                key={item.root}
                type="button"
                className={cn('recent-item', active && 'is-active')}
                onClick={() => {
                  if (!applying) void openRoot(item.root);
                }}
                title={item.root}
              >
                <span className="recent-icon">
                  <Folder size={13} />
                </span>
                <span className="recent-text">
                  <span className="recent-name">{item.name}</span>
                  <span className="recent-sub">
                    <span>{item.audioCount} 首</span>
                    <span>·</span>
                    <span>{formatRelative(item.lastOpenedAt)}</span>
                  </span>
                </span>
                <ChevronRight size={12} className="recent-arrow" />
              </button>
            );
          })
        )}
      </div>

      {updateDownloading ? (
        <div className="update-download">
          <div className="update-download-label">
            <span><Download size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />正在下载 Sotto {updateInfo?.latestVersion || ''}</span>
            <span>{updateProgress?.percent || 0}%</span>
          </div>
          <div className="update-download-track">
            <div className="update-download-fill" style={{ width: Math.max(2, Math.min(100, updateProgress?.percent || 0)) + '%' }} />
          </div>
        </div>
      ) : null}

      <button type="button" className="btn btn-secondary btn-sm btn-block sidebar-open" onClick={() => void pickFolder()}>
        <FolderOpen size={14} />
        打开作品文件夹
      </button>

      <div className="privacy-card">
        <span className="privacy-icon">
          <ShieldCheck size={14} />
        </span>
        <span className="privacy-title">本地优先</span>
        <span className="privacy-text">文件只在本机处理，不上传、不联网。整理日志保留在本地，随时可以撤销。</span>
      </div>
    </aside>
  );
}
