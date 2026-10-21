import {
  TriangleAlert,
  ChevronRight,
  FileAudio,
  FileText,
  Folder,
  Image as ImageIcon,
  ImagePlus,
  Info
} from 'lucide-react';
import type { FolderPlan, PairPlan } from '@shared/types';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { pairHasWarning } from '../../lib/plan';
import PairRow from './PairRow';

export default function FolderCard({
  folder,
  pairs,
  expanded,
  onToggle,
  onOpenCover
}: {
  folder: FolderPlan;
  pairs: PairPlan[];
  expanded: boolean;
  onToggle: () => void;
  onOpenCover: () => void;
}): JSX.Element {
  const selectedCover = folder.cover;
  const previewImage = selectedCover ? selectedCover.image : folder.coverCandidates[0] || null;
  const warningCount = folder.pairs.filter(pairHasWarning).length;
  const orphanCount = folder.orphanAudios.length + folder.orphanSubtitles.length;
  const relativePath = folder.relativePath.trim();
  const showRelativePath =
    relativePath.length > 0 && relativePath.toLowerCase() !== folder.folderName.trim().toLowerCase();

  const coverLabel = selectedCover
    ? selectedCover.action === 'none'
      ? '封面就绪'
      : selectedCover.targetName
    : folder.coverCandidates.length > 0
      ? folder.coverCandidates.length + ' 张候选'
      : '选择封面';

  return (
    <section className={cn('folder-card', expanded && 'is-open')}>
      <div
        className="folder-head"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <ChevronRight size={14} className="folder-chevron" />
        <span className="folder-icon">
          <Folder size={15} />
        </span>
        <span className="folder-head-main">
          <span className="folder-name" title={folder.folder}>
            {folder.folderName}
          </span>
          {showRelativePath ? <span className="folder-rel">{relativePath}</span> : null}
        </span>
        <div className="folder-head-meta">
          {warningCount > 0 ? (
            <span className="chip chip-warn" title={warningCount + ' 组配对需要确认'}>
              <TriangleAlert size={10} />
              {warningCount}
            </span>
          ) : null}
          {orphanCount > 0 ? (
            <span className="chip chip-muted" title={orphanCount + ' 个未配对文件'}>
              {orphanCount} 个孤立
            </span>
          ) : null}
          <span className="folder-counts">{folder.pairs.length} 组配对</span>
          <button
            type="button"
            className="cover-chip"
            onClick={(event) => {
              event.stopPropagation();
              onOpenCover();
            }}
            title={'为「' + folder.folderName + '」选择封面'}
          >
            <span className={cn('cover-thumb', !previewImage && 'is-empty')}>
              {previewImage ? <img src={imageSrc(previewImage.path)} alt="" /> : <ImagePlus size={13} />}
            </span>
            {coverLabel}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="folder-body">
          {pairs.length > 0 ? (
            <div className="pair-list">
              {pairs.map((pair) => (
                <PairRow key={pair.id} pair={pair} />
              ))}
            </div>
          ) : (
            <div className="pair-info" style={{ padding: '10px 2px' }}>
              <Info size={13} />
              当前筛选下没有需要显示的配对。
            </div>
          )}

          {folder.orphanAudios.length > 0 ? (
            <div className="orphan-block">
              <div className="orphan-head">
                <FileAudio size={13} />
                <div>
                  <div className="orphan-title">未配对音频 · {folder.orphanAudios.length}</div>
                  <div className="orphan-desc">
                    没有找到对应字幕。可在「设置 › 命名规则」中开启「无字幕音频也重命名」。
                  </div>
                </div>
              </div>
              <div className="orphan-list">
                {folder.orphanAudios.map((file) => (
                  <div key={file.path} className="orphan-row" title={file.path}>
                    <FileAudio size={13} className="orphan-row-icon" />
                    <span className="orphan-row-name">{file.name}</span>
                    <span className="orphan-row-meta">{formatBytes(file.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {folder.orphanSubtitles.length > 0 ? (
            <div className="orphan-block">
              <div className="orphan-head">
                <FileText size={13} />
                <div>
                  <div className="orphan-title">未配对字幕 · {folder.orphanSubtitles.length}</div>
                  <div className="orphan-desc">这些字幕没有找到对应音频，将保持原样。</div>
                </div>
              </div>
              <div className="orphan-list">
                {folder.orphanSubtitles.map((file) => (
                  <div key={file.path} className="orphan-row" title={file.path}>
                    <FileText size={13} className="orphan-row-icon" />
                    <span className="orphan-row-name">{file.name}</span>
                    <span className="orphan-row-meta">{file.ext.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedCover ? (
            <button type="button" className="folder-cover-note" onClick={onOpenCover}>
              <ImageIcon size={12} />
              当前封面：{selectedCover.image.name}
              <ChevronRight size={11} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}