import { CircleCheckBig, FolderOpen, LoaderCircle, TriangleAlert, Undo2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatDay } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Button, Modal } from './ui';

export default function ResultDialog(): JSX.Element | null {
  const result = useAppStore((state) => state.result);
  const plan = useAppStore((state) => state.plan);
  const undoBusy = useAppStore((state) => state.undoBusy);
  const undoRun = useAppStore((state) => state.undoRun);
  const openPath = useAppStore((state) => state.openPath);
  const dismiss = useAppStore((state) => state.dismissResult);

  if (!result) return null;

  const success = result.status === 'success';
  const seconds = Math.max(1, Math.round((result.finishedAt - result.startedAt) / 1000));
  const failures = result.items.filter((item) => item.status === 'failed');
  const undoable = result.undoAvailable;

  return (
    <Modal open onClose={dismiss} className="result-modal" labelledBy="result-title">
      <div className="result-head">
        <span className={cn('result-icon', !success && 'is-partial')}>
          {success ? <CircleCheckBig size={26} /> : <TriangleAlert size={26} />}
        </span>
        <h2 className="result-title" id="result-title">
          {success ? '整理完成' : '部分完成'}
        </h2>
        <p className="result-sub">
          {plan?.rootName || result.root} · 用时 {seconds} 秒
          {success ? ' · 所有操作已写入日志' : ' · 有部分文件未能处理'}
        </p>
      </div>

      <div className="result-stats">
        <div className="result-stat">
          <strong>{result.stats.renamed}</strong>
          <span>重命名</span>
        </div>
        <div className="result-stat">
          <strong>{result.stats.subtitlesConverted}</strong>
          <span>字幕</span>
        </div>
        <div className="result-stat">
          <strong>{result.stats.audioConverted}</strong>
          <span>音频</span>
        </div>
        <div className="result-stat">
          <strong>{result.stats.covers}</strong>
          <span>封面</span>
        </div>
        <div className="result-stat">
          <strong style={{ color: result.stats.failed > 0 ? 'var(--danger)' : undefined }}>
            {result.stats.failed}
          </strong>
          <span>失败</span>
        </div>
      </div>

      <div className="result-body">
        {failures.length > 0 ? (
          <div className="result-fail-list">
            {failures.slice(0, 3).map((item, index) => (
              <div key={item.kind + index}>· {item.message}</div>
            ))}
          </div>
        ) : null}
        <p className="result-note">
          {undoable
            ? '本次整理可以完整撤销，撤销操作会恢复文件名称并移除新建的 LRC。'
            : '本次整理包含不可完全撤销的操作（例如已删除原文件），可撤销的部分仍会尝试恢复。'}
        </p>
      </div>

      <div className="result-actions">
        <Button
          variant="secondary"
          onClick={() => void undoRun(result.runId)}
          disabled={Boolean(undoBusy) || !undoable}
          title={undoable ? '撤销本次整理' : '本次整理不可撤销'}
        >
          {undoBusy ? <LoaderCircle size={14} className="spin" /> : <Undo2 size={14} />}
          {undoBusy ? '正在撤销…' : '撤销本次整理'}
        </Button>
        <Button variant="ghost" onClick={() => void openPath(result.root)}>
          <FolderOpen size={14} />
          打开文件夹
        </Button>
        <Button variant="primary" onClick={dismiss}>
          完成
        </Button>
      </div>
    </Modal>
  );
}