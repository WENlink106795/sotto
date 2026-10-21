import { AudioLines, ChevronRight, Copy, Folder, Minus, ShieldCheck, Square, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { ViewKey } from '../lib/capture';

function viewLabel(view: ViewKey): string {
  if (view === 'history') return '运行历史';
  if (view === 'settings') return '设置';
  return '整理预览';
}

export default function TitleBar(): JSX.Element {
  const view = useAppStore((state) => state.view);
  const plan = useAppStore((state) => state.plan);
  const scan = useAppStore((state) => state.scan);
  const root = useAppStore((state) => state.root);
  const windowMaximized = useAppStore((state) => state.windowMaximized);
  const toggleMaximize = useAppStore((state) => state.windowToggleMaximize);
  const minimize = useAppStore((state) => state.windowMinimize);
  const close = useAppStore((state) => state.windowClose);
  const rootName = plan?.rootName || scan?.rootName || (root ? root.split(/[\\/]/).filter(Boolean).slice(-1)[0] : '');

  const onDoubleClick = (event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest('.no-drag')) return;
    toggleMaximize();
  };

  return (
    <header className="app-titlebar drag" onDoubleClick={onDoubleClick}>
      <div className="titlebar-left">
        <div className="brand">
          <span className="brand-mark">
            <AudioLines size={14} strokeWidth={2.2} />
          </span>
          <span className="brand-word">
            Sotto<span className="brand-cn">耳畔</span>
          </span>
        </div>
        <span className="titlebar-divider" aria-hidden="true" />
        <div className="titlebar-crumbs no-drag" aria-label="当前位置">
          <span className="crumbs-path">
            <Folder size={12} />
            <span>{rootName || '本地资料库'}</span>
          </span>
          {rootName ? (
            <>
              <ChevronRight size={11} className="crumbs-sep" />
              <span className="crumbs-view">{viewLabel(view)}</span>
            </>
          ) : null}
        </div>
      </div>
      <span className="titlebar-status no-drag">
        <ShieldCheck size={12} />
        本地处理 · 不上传
      </span>
      <div className="window-controls no-drag">
        <button type="button" className="window-control" aria-label="最小化" title="最小化" onClick={minimize}>
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={windowMaximized ? '还原窗口' : '最大化'}
          title={windowMaximized ? '还原窗口' : '最大化'}
          onClick={toggleMaximize}
        >
          {windowMaximized ? <Copy size={13} /> : <Square size={12} />}
        </button>
        <button type="button" className="window-control close" aria-label="关闭" title="关闭" onClick={close}>
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
