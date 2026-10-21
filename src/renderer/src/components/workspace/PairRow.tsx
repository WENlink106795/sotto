import { TriangleAlert, ArrowRight, FileAudio, FileText, Info } from 'lucide-react';
import type { PairPlan } from '@shared/types';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { hasActiveConversion, MATCH_HINTS, MATCH_LABELS, pairHasWarning, pairNeedsWork } from '../../lib/plan';

export default function PairRow({ pair }: { pair: PairPlan }): JSX.Element {
  const warning = pairHasWarning(pair);
  const needsWork = pairNeedsWork(pair);
  const statusLabel = warning ? '需确认' : needsWork ? '待处理' : '已规范';
  const statusClass = warning ? 'is-warning' : needsWork ? 'is-pending' : 'is-clean';
  const subtitleTarget = pair.subtitleOutputName || pair.subtitleRenameName;
  const subtitleChanged = Boolean(pair.subtitle && subtitleTarget && subtitleTarget !== pair.subtitle.name);
  const conversionActive = hasActiveConversion(pair);
  const sourceRename =
    pair.subtitle && pair.subtitleConvert && pair.subtitleRenameName &&
    pair.subtitleRenameName !== pair.subtitleOutputName &&
    pair.subtitleRenameName !== pair.subtitle.name
      ? pair.subtitleRenameName
      : null;

  return (
    <div className={cn('pair-row', warning && 'has-warning')}>
      <span className="pair-icon">
        <FileAudio size={15} />
      </span>
      <div className="pair-main">
        <div className="pair-line">
          <span className="pair-name-group">
            {pair.audioRenameNeeded ? (
              <>
                <span className="pair-old" title={pair.audio.name}>
                  {pair.audio.name}
                </span>
                <ArrowRight size={12} className="pair-arrow" />
              </>
            ) : null}
            <span className="pair-new" title={pair.renamedAudioName}>
              {pair.renamedAudioName}
            </span>
          </span>
          <span className="pair-tags">
            <span
              className={cn('match-badge', 'match-' + pair.match)}
              title={MATCH_HINTS[pair.match] + ' · 置信度 ' + Math.round(pair.score * 100) + '%'}
            >
              {MATCH_LABELS[pair.match]}
            </span>
            {pair.audioConversion && !conversionActive ? (
              <span className="chip chip-muted" title={pair.audioConversion.skipReason || '此文件已跳过转码'}>
                转码跳过
              </span>
            ) : null}
            {pair.subtitleConvert ? (
              <span className="chip">
                {pair.subtitle ? pair.subtitle.ext.toUpperCase() : '字幕'} → LRC
              </span>
            ) : null}
          </span>
        </div>

        <div className="pair-meta">
          {pair.subtitle ? (
            <span className="meta-item" title={pair.subtitle.name + (subtitleTarget ? ' → ' + subtitleTarget : '')}>
              <FileText size={11} />
              <span className="meta-sub">{pair.subtitle.name}</span>
              {subtitleChanged && subtitleTarget ? (
                <>
                  <ArrowRight size={10} className="meta-arrow" />
                  <span className="meta-strong file-name" title={subtitleTarget}>
                    <span className="file-name-base">{subtitleTarget.replace(/\.[^.]+$/, '')}</span>
                    <span className="file-name-ext">{subtitleTarget.match(/\.[^.]+$/)?.[0] || ''}</span>
                  </span>
                </>
              ) : null}
              {pair.subtitleDeleteSource ? <span className="chip chip-warn">源字幕移入回收站</span> : null}
            </span>
          ) : (
            <span className="meta-item">
              <FileText size={11} />
              无配对字幕 · 仅处理音频
            </span>
          )}

          {conversionActive && pair.audioConversion ? (
            <span className="conversion-line" title={pair.audioConversion.outputPath}>
              转 {pair.audioConversion.format.toUpperCase()} · {pair.audioConversion.bitrateKbps}kbps
              <ArrowRight size={10} className="meta-arrow" />
              <span className="meta-sub">{pair.audioConversion.outputName}</span>
            </span>
          ) : null}

          {sourceRename ? (
            <span className="source-rename" title={sourceRename}>
              源 {pair.subtitle ? pair.subtitle.ext.toUpperCase() : '字幕'} 同步改名
              <span className="meta-sub">{sourceRename}</span>
            </span>
          ) : null}

          {pair.existingLrc && pair.lrcWillOverwrite ? (
            <span className="chip chip-muted" title={pair.existingLrc.path}>
              将更新同名 LRC
            </span>
          ) : null}

          {pair.removedChars.length > 0 ? (
            <span className="removed-chips" aria-label="移除的字符">
              {pair.removedChars.map((char) => (
                <span key={char} className="char-chip" title={'已移除字符 ' + char}>
                  − {char}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        {pair.warnings.map((warningItem, index) => (
          <div
            key={warningItem.code + index}
            className={warningItem.severity === 'info' ? 'pair-info' : 'pair-warning'}
          >
            {warningItem.severity === 'info' ? <Info size={12} /> : <TriangleAlert size={12} />}
            <span>{warningItem.message}</span>
          </div>
        ))}
      </div>

      <div className="pair-side">
        <span className={cn('pair-status', statusClass)}>{statusLabel}</span>
        {conversionActive && pair.audioConversion && pair.audioConversion.estimatedBytes ? (
          <span className="pair-size">约 {formatBytes(pair.audioConversion.estimatedBytes)}</span>
        ) : null}
        {!conversionActive && pair.audio.size > 0 ? (
          <span className="pair-size">{formatBytes(pair.audio.size)}</span>
        ) : null}
      </div>
    </div>
  );
}