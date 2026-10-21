import { useState } from 'react';
import type { DragEvent } from 'react';
import {
  Captions,
  ChevronRight,
  FileAudio,
  FolderDown,
  FolderOpen,
  FolderSearch,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
  Volume2
} from 'lucide-react';
import { api } from '../lib/bridge';
import { cn } from '../lib/cn';
import { formatRelative, lastName } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import BootScreen from './BootScreen';
import WorkspaceView from './workspace/WorkspaceView';

function EmptyLibrary(): JSX.Element {
  const recentRoots = useAppStore((state) => state.settings.general.recentRoots);
  const pickFolder = useAppStore((state) => state.pickFolder);
  const openRoot = useAppStore((state) => state.openRoot);
  const applying = useAppStore((state) => state.applying);
  const toast = useAppStore((state) => state.toast);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    const path = api.getPathForFile(file);
    if (path) {
      void openRoot(path);
    } else {
      toast({ kind: 'warning', title: '无法读取文件夹路径', message: '请使用「选择文件夹」按钮打开作品目录。' });
    }
  };

  return (
    <div className="empty-view">
      <div className="empty-inner">
        <header className="empty-hero">
          <span className="hero-eyebrow">
            <Sparkles size={12} />
            Local-first · 本地优先
          </span>
          <h1 className="hero-title">
            让每一段耳语，
            <br />
            <span className="hero-accent">都在播放器里被看见。</span>
          </h1>
          <p className="hero-sub">
            把散落的音频、字幕与封面整理成播放器喜欢的模样——统一命名、VTT / SRT 转 LRC、封面归一，一次完成。
          </p>
        </header>

        <div
          className={cn('dropzone', dragOver && 'is-over')}
          onDragOver={(event) => {
            event.preventDefault();
            if (event.dataTransfer.types.includes('Files')) setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragOver(false);
          }}
          onDrop={onDrop}
        >
          <span className="dropzone-icon">
            <FolderDown size={24} strokeWidth={1.8} />
          </span>
          <div className="dropzone-text">
            <div className="dropzone-title">把作品文件夹拖到这里</div>
            <div className="dropzone-sub">自动识别子文件夹中的音频、字幕与图片，支持 VTT / SRT / LRC</div>
          </div>
          <div className="dropzone-actions">
            <button type="button" className="btn btn-primary" onClick={() => void pickFolder()} disabled={applying}>
              <FolderOpen size={15} />
              选择文件夹
            </button>
          </div>
        </div>

        <div className="feature-grid">
          <div className="feature-card">
            <span className="feature-icon">
              <FileAudio size={16} />
            </span>
            <div>
              <div className="feature-title">统一命名</div>
              <div className="feature-desc">音频与字幕使用同一个规范名称，自动移除播放器不兼容的字符。</div>
            </div>
          </div>
          <div className="feature-card">
            <span className="feature-icon">
              <Captions size={16} />
            </span>
            <div>
              <div className="feature-title">字幕转 LRC</div>
              <div className="feature-desc">VTT / SRT 转换成播放器认得的 LRC，保留时间轴，编码可选。</div>
            </div>
          </div>
          <div className="feature-card">
            <span className="feature-icon">
              <ImageIcon size={16} />
            </span>
            <div>
              <div className="feature-title">封面与转码</div>
              <div className="feature-desc">选中文件夹封面并归一为 cover.jpg；可选 WAV / FLAC 转 MP3。</div>
            </div>
          </div>
        </div>

        {recentRoots.length > 0 ? (
          <section className="recent-section" aria-label="最近打开的资料库">
            <div className="section-head">
              <div className="section-head-title">
                <FolderSearch size={14} />
                最近打开
              </div>
              <span className="section-head-meta">{recentRoots.length} 个资料库</span>
            </div>
            <div className="recent-grid">
              {recentRoots.slice(0, 3).map((item) => (
                <button
                  key={item.root}
                  type="button"
                  className="recent-card"
                  onClick={() => void openRoot(item.root)}
                  title={item.root}
                >
                  <span className="recent-card-icon">
                    <FolderOpen size={16} />
                  </span>
                  <span className="recent-card-main">
                    <span className="recent-card-name">{item.name || lastName(item.root)}</span>
                    <span className="recent-card-path">{item.root}</span>
                    <span className="recent-card-meta">
                      <span>{item.audioCount} 首音频</span>
                      <span>·</span>
                      <span>{formatRelative(item.lastOpenedAt)}</span>
                    </span>
                  </span>
                  <ChevronRight size={14} className="recent-card-arrow" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <p className="privacy-note">
          <ShieldCheck size={13} />
          所有处理都在本机完成 · 不上传任何文件 · 可随时撤销
        </p>
      </div>
    </div>
  );
}

function LibraryLoading(): JSX.Element {
  const root = useAppStore((state) => state.root);
  const label = useAppStore((state) => state.loadingLabel);
  return (
    <div className="library-loading">
      <div className="loading-panel">
        <div className="loading-panel-head">
          <span className="spin">
            <Sparkles size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div>{label || '正在读取资料库…'}</div>
            {root ? <div className="loading-panel-path">{root}</div> : null}
          </div>
        </div>
        <div className="skeleton" style={{ height: 10, width: '72%' }} />
        <div className="skeleton" style={{ height: 10, width: '92%' }} />
        <div className="skeleton" style={{ height: 10, width: '58%' }} />
        <p className="privacy-note" style={{ justifyContent: 'flex-start' }}>
          <ShieldCheck size={12} />
          只读取文件信息，不会修改任何内容
        </p>
      </div>
    </div>
  );
}

export default function LibraryView(): JSX.Element {
  const ready = useAppStore((state) => state.ready);
  const bootError = useAppStore((state) => state.bootError);
  const plan = useAppStore((state) => state.plan);
  const loading = useAppStore((state) => state.loading);
  const scan = useAppStore((state) => state.scan);

  if (!ready) return <BootScreen />;

  if (bootError) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="empty-illustration">
          <FolderSearch size={22} />
        </span>
        <div className="empty-state-title">无法启动工作台</div>
        <p className="empty-state-desc">{bootError}</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }

  if (plan) return <WorkspaceView />;
  if (loading && !scan) return <LibraryLoading />;
  if (loading && scan) return <LibraryLoading />;
  if (scan) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <span className="empty-illustration">
          <FileAudio size={22} />
        </span>
        <div className="empty-state-title">整理预览还没有准备好</div>
        <p className="empty-state-desc">资料库已经扫描完成，请重新打开文件夹以生成预览。</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
  return <EmptyLibrary />;
}
