import { Check, FileAudio, LoaderCircle } from 'lucide-react';
import type { ProgressPhase } from '@shared/types';
import { cn } from '../lib/cn';
import { percentOf } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './ui';

const STEPS: { phase: ProgressPhase; label: string }[] = [
  { phase: 'rename', label: '重命名' },
  { phase: 'subtitle', label: '字幕' },
  { phase: 'audio', label: '转码' },
  { phase: 'cover', label: '封面' },
  { phase: 'finish', label: '完成' }
];

function stepIndex(phase: ProgressPhase | undefined): number {
  if (!phase) return 0;
  const index = STEPS.findIndex((step) => step.phase === phase);
  return index < 0 ? 0 : index;
}

export default function ProgressOverlay(): JSX.Element | null {
  const applying = useAppStore((state) => state.applying);
  const progress = useAppStore((state) => state.progress);
  const progressLog = useAppStore((state) => state.progressLog);
  const plan = useAppStore((state) => state.plan);

  if (!applying) return null;
  const percent = progress ? Math.max(2, Math.min(100, progress.overallPercent)) : 2;
  const currentIndex = stepIndex(progress?.phase);
  const recentLog = progressLog.slice(-4);

  return (
    <Modal open onClose={() => undefined} className="progress-modal" closeOnOverlay={false}>
      <div className="progress-inner">
        <div className="progress-head">
          <span className="wave-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
          <div className="progress-head-text">
            <h2 className="progress-title">正在整理</h2>
            <p className="progress-sub">{plan?.rootName || 'Sotto'}</p>
          </div>
          <span className="progress-percent">{percentOf(percent, 100)}%</span>
        </div>

        <div className="phase-steps" aria-hidden="true">
          {STEPS.map((step, index) => {
            const done = index < currentIndex || (progress?.phase === 'finish' && index <= currentIndex);
            const active = index === currentIndex && progress?.phase !== 'finish';
            return (
              <div key={step.phase} className={cn('phase-step', done && 'is-done', active && 'is-active')}>
                <span className="phase-dot">{done ? <Check size={9} strokeWidth={3} /> : null}</span>
                <span className="phase-label">{step.label}</span>
              </div>
            );
          })}
        </div>

        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="整理进度"
        >
          <div className="progress-fill" style={{ width: percent + '%' }} />
        </div>

        <div className="progress-current">
          <div className="progress-current-main">
            <LoaderCircle size={14} className="spin" />
            {progress?.message || '准备整理…'}
          </div>
          <div className="progress-current-detail" title={progress?.detail || undefined}>
            {progress?.detail || '正在建立安全的文件操作计划'}
          </div>
        </div>

        <div className="progress-log" aria-live="polite">
          {recentLog.length === 0 ? (
            <div className="progress-log-line">等待第一个操作…</div>
          ) : (
            recentLog.map((entry, index) => (
              <div
                key={entry.at + '-' + index}
                className={cn('progress-log-line', index === recentLog.length - 1 && 'is-latest')}
              >
                <FileAudio size={9} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 6 }} />
                {entry.message}
                {entry.detail ? ' · ' + entry.detail : ''}
              </div>
            ))
          )}
        </div>

        <p className="progress-note">完成后会自动打开结果摘要 · 请勿关闭窗口</p>
      </div>
    </Modal>
  );
}
