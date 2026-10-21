import {
  CircleCheckBig,
  CircleX,
  Clock,
  FolderOpen,
  History,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  Undo2
} from 'lucide-react';
import type { RunRecord } from '@shared/types';
import { cn } from '../lib/cn';
import { formatDay } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui';

function statusMeta(status: RunRecord['status']): { label: string; className: string; icon: typeof CircleCheckBig } {
  if (status === 'success') return { label: '已完成', className: 'is-success', icon: CircleCheckBig };
  if (status === 'partial') return { label: '部分完成', className: 'is-partial', icon: TriangleAlert };
  return { label: '失败', className: 'is-failed', icon: CircleX };
}

function RunCard({ run }: { run: RunRecord }): JSX.Element {
  const undoRun = useAppStore((state) => state.undoRun);
  const undoBusy = useAppStore((state) => state.undoBusy);
  const openPath = useAppStore((state) => state.openPath);
  const meta = statusMeta(run.status);
  const Icon = meta.icon;
  const undone = Boolean(run.undoneAt);
  const busy = undoBusy === run.runId;
  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000));

  return (
    <article className="run-card">
      <span className={cn('run-status', meta.className)}>
        <Icon size={17} />
      </span>
      <div className="run-main">
        <div className="run-title-row">
          <span className="run-title">{run.rootName}</span>
          <span className={cn('chip', run.status === 'success' && 'chip-success', run.status === 'partial' && 'chip-warn', run.status === 'failed' && 'chip-danger')}>
            {meta.label}
          </span>
          {undone ? <span className="chip chip-muted">已撤销</span> : null}
          {!undone && run.undoAvailable ? <span className="chip chip-accent">可撤销</span> : null}
        </div>
        <button type="button" className="run-path run-path-button" onClick={() => void openPath(run.root)} title={run.root}>
          <FolderOpen size={11} />
          {run.root}
        </button>
        <div className="run-meta">
          <span className="run-meta-item">
            <Clock size={11} />
            {formatDay(run.startedAt)}
          </span>
          <span className="run-meta-item">用时 {seconds} 秒</span>
        </div>
        <div className="run-stats">
          <span className="run-stat">
            重命名 <strong>{run.stats.renamed}</strong>
          </span>
          <span className="run-stat">
            字幕 <strong>{run.stats.subtitlesConverted}</strong>
          </span>
          <span className="run-stat">
            音频 <strong>{run.stats.audioConverted}</strong>
          </span>
          <span className="run-stat">
            封面 <strong>{run.stats.covers}</strong>
          </span>
          {run.stats.failed > 0 ? (
            <span className="run-stat" style={{ color: 'var(--danger)' }}>
              失败 <strong style={{ color: 'var(--danger)' }}>{run.stats.failed}</strong>
            </span>
          ) : null}
          {run.stats.skipped > 0 ? (
            <span className="run-stat">
              跳过 <strong>{run.stats.skipped}</strong>
            </span>
          ) : null}
        </div>
      </div>
      <div className="run-side">
        {!undone && run.undoAvailable ? (
          <Button variant="secondary" size="sm" onClick={() => void undoRun(run.runId)} disabled={Boolean(undoBusy)}>
            {busy ? <LoaderCircle size={13} className="spin" /> : <Undo2 size={13} />}
            {busy ? '撤销中…' : '撤销'}
          </Button>
        ) : undone ? (
          <span className="run-undone">
            <RotateCcw size={12} />
            已恢复
          </span>
        ) : (
          <span className="run-undo-note" title="原文件已被移动或回收，无法完整撤销">
            不可撤销
          </span>
        )}
      </div>
    </article>
  );
}

export default function HistoryView(): JSX.Element {
  const history = useAppStore((state) => state.history);
  const historyLoading = useAppStore((state) => state.historyLoading);
  const loadHistory = useAppStore((state) => state.loadHistory);
  const setView = useAppStore((state) => state.setView);

  return (
    <div className="history-view">
      <div className="history-inner">
        <header className="view-header">
          <div>
            <h1 className="view-title">运行历史</h1>
            <p className="view-sub">最近 {history.length} 次整理 · 运行记录与日志只保存在本机</p>
          </div>
          <div className="view-head-actions">
            <Button variant="secondary" size="sm" onClick={() => void loadHistory()} disabled={historyLoading}>
              {historyLoading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}
              刷新记录
            </Button>
          </div>
        </header>

        {historyLoading && history.length === 0 ? (
          <div className="history-skeleton" aria-label="正在读取运行记录">
            <div className="skeleton history-skeleton-row" />
            <div className="skeleton history-skeleton-row" />
            <div className="skeleton history-skeleton-row" />
          </div>
        ) : history.length === 0 ? (
          <div className="empty-state history-empty">
            <span className="empty-illustration">
              <History size={22} />
            </span>
            <div className="empty-state-title">还没有整理记录</div>
            <p className="empty-state-desc">
              在资料库中执行一次整理后，这里会记录重命名、字幕转换与撤销状态。
            </p>
            <Button variant="secondary" onClick={() => setView('library')}>
              前往资料库
            </Button>
          </div>
        ) : (
          <>
            <div className="run-list">
              {history.map((run) => (
                <RunCard key={run.runId} run={run} />
              ))}
            </div>
            <p className="privacy-note">
              <ShieldCheck size={12} />
              运行记录保存在本地用户数据目录，不会上传
            </p>
          </>
        )}
      </div>
    </div>
  );
}