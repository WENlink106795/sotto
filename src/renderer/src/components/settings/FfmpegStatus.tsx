import { LoaderCircle, RotateCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../ui';

export default function FfmpegStatus(): JSX.Element {
  const ffmpeg = useAppStore((state) => state.ffmpeg);
  const ffmpegLoading = useAppStore((state) => state.ffmpegLoading);
  const chooseFfmpeg = useAppStore((state) => state.chooseFfmpeg);
  const refreshFfmpeg = useAppStore((state) => state.refreshFfmpeg);
  const available = Boolean(ffmpeg?.available);

  return (
    <div className="ffmpeg-status-card">
      <span className={cn('status-dot', available ? 'is-ok' : 'is-warn')} />
      <div className="ffmpeg-status-main">
        <div className="ffmpeg-status-title">
          {available ? 'ffmpeg ' + (ffmpeg?.version || '已就绪') : '未检测到 ffmpeg'}
        </div>
        <div className="ffmpeg-status-path" title={ffmpeg?.path || ''}>
          {ffmpeg?.path || '音频转码与封面格式转换需要 ffmpeg，可放在系统 PATH 或指定可执行文件。'}
        </div>
      </div>
      <div className="ffmpeg-status-actions">
        <Button variant="secondary" size="sm" onClick={() => void chooseFfmpeg()}>
          选择…
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void refreshFfmpeg()} disabled={ffmpegLoading}>
          {ffmpegLoading ? <LoaderCircle size={12} className="spin" /> : <RotateCw size={12} />}
          重新检测
        </Button>
      </div>
    </div>
  );
}
