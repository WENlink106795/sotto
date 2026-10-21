import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, ImagePlus, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { imageSrc } from '../lib/images';
import { useAppStore } from '../store/useAppStore';
import { Button, Modal, Switch } from './ui';

export default function CoverPicker(): JSX.Element | null {
  const plan = useAppStore((state) => state.plan);
  const folderPath = useAppStore((state) => state.coverPickerFolder);
  const settings = useAppStore((state) => state.settings);
  const coverChoices = useAppStore((state) => state.coverChoices);
  const planRefreshing = useAppStore((state) => state.planRefreshing);
  const applyCover = useAppStore((state) => state.applyCover);
  const clearCover = useAppStore((state) => state.clearCover);
  const close = useAppStore((state) => state.openCoverPicker);

  const folder = plan?.folders.find((item) => item.folder === folderPath) || null;
  const candidates = folder?.coverCandidates || [];
  const chosen = coverChoices.find((choice) => choice.folder === folderPath);
  const [selectedPath, setSelectedPath] = useState('');
  const [convert, setConvert] = useState(settings.cover.convertToJpeg);

  useEffect(() => {
    if (!folder) return;
    setSelectedPath(chosen?.imagePath || folder.cover?.image.path || candidates[0]?.path || '');
    setConvert(chosen?.convertToJpeg !== undefined ? Boolean(chosen.convertToJpeg) : settings.cover.convertToJpeg);
  }, [folder?.folder, chosen?.imagePath, settings.cover.convertToJpeg]);

  if (!folder) return null;

  const currentCover = folder.cover;
  const hasCustomChoice = Boolean(chosen);

  return (
    <Modal
      open
      onClose={() => close(null)}
      className="cover-modal"
      labelledBy="cover-picker-title"
    >
      <div className="modal-head">
        <div className="modal-head-main">
          <h2 className="modal-title" id="cover-picker-title">
            选择封面
          </h2>
          <p className="modal-sub">
            {folder.folderName} · {candidates.length} 张候选图片
          </p>
        </div>
        <button type="button" className="icon-btn modal-close" aria-label="关闭" onClick={() => close(null)}>
          <X size={16} />
        </button>
      </div>

      <div className="modal-body">
        <div className="cover-modal-info">
          <span className="cover-current">
            <ImageIcon size={14} />
            当前封面
            <strong>{currentCover ? currentCover.image.name : '尚未设置'}</strong>
          </span>
          {currentCover && currentCover.action !== 'none' ? (
            <span className="chip chip-accent">将写入 {currentCover.targetName}</span>
          ) : currentCover ? (
            <span className="chip chip-success">已是目标封面</span>
          ) : (
            <span className="chip chip-muted">未选择</span>
          )}
        </div>

        {candidates.length > 0 ? (
          <div className="cover-grid" role="listbox" aria-label="封面候选">
            {candidates.map((image) => {
              const selected = selectedPath === image.path;
              return (
                <button
                  key={image.path}
                  type="button"
                  className={cn('cover-option', selected && 'is-selected')}
                  role="option"
                  aria-selected={selected}
                  onClick={() => setSelectedPath(image.path)}
                  title={image.path}
                >
                  <span className="cover-option-frame">
                    <img src={imageSrc(image.path)} alt={image.name} loading="lazy" />
                    {selected ? (
                      <span className="cover-check">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    ) : null}
                  </span>
                  <span className="cover-name">{image.name}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cover-empty">
            <ImagePlus size={22} />
            <div>这个文件夹里没有找到图片。</div>
            <div>把 jpg、png 或 webp 放进文件夹后再试。</div>
          </div>
        )}

        <div className="cover-toggle-row">
          <div className="setting-info">
            <div className="setting-title">转为 {settings.cover.name || 'cover'}.jpg（推荐）</div>
            <div className="setting-desc">JPG 拥有最好的播放器兼容性；保持原图则直接重命名。转换会保留原始图片。</div>
          </div>
          <Switch checked={convert} onChange={setConvert} label="转为 cover.jpg" />
        </div>
      </div>

      <div className="modal-foot">
        {hasCustomChoice || currentCover ? (
          <Button variant="danger" size="sm" className="spacer" onClick={() => void clearCover(folder.folder)}>
            清除封面
          </Button>
        ) : (
          <span className="spacer" />
        )}
        <Button variant="ghost" onClick={() => close(null)}>
          取消
        </Button>
        <Button
          variant="primary"
          disabled={!selectedPath || planRefreshing}
          onClick={() => void applyCover(folder.folder, selectedPath, convert)}
        >
          {planRefreshing ? '正在更新…' : '应用封面'}
        </Button>
      </div>
    </Modal>
  );
}
