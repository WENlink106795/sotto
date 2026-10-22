import { useEffect, useState, type DragEvent } from 'react';
import { ClipboardPaste, ExternalLink, FileAudio, FolderOpen, FolderTree, Play, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import type {
  ConverterFormat,
  ConverterProgress,
  ConverterResult,
  ConverterScan
} from '@shared/types';
import { engineLabel } from '@shared/converter';
import { api } from '../../lib/bridge';
import { useAppStore } from '../../store/useAppStore';
import { Button, Segmented, SettingRow, Switch } from '../ui';

const BITRATES = ['128', '192', '256', '320'];
const OUTPUT_FOLDER = 'Sotto-converted';

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const rest = (seconds % 60).toString().padStart(2, '0');
  return hours > 0 ? hours + ':' + minutes + ':' + rest : minutes + ':' + rest;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export default function ConverterPanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const notify = useAppStore((state) => state.toast);
  const [source, setSource] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [parallelism, setParallelism] = useState(0);
  const [format, setFormat] = useState<ConverterFormat>(settings.convert.format);
  const [bitrateKbps, setBitrateKbps] = useState(settings.convert.bitrateKbps);
  const [scan, setScan] = useState<ConverterScan | null>(null);
  const [progress, setProgress] = useState<ConverterProgress | null>(null);
  const [result, setResult] = useState<ConverterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    return api.onConverterProgress((event) => setProgress(event));
  }, []);

  async function refreshScan(nextSource = source, nextOutput = outputDir): Promise<void> {
    if (!nextSource) return;
    setScanning(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const next = await api.scanConverter({
        source: nextSource,
        outputDir: nextOutput,
        format,
        bitrateKbps,
        recursive,
        parallelism,
        threads: 0
      });
      setScan(next);
    } catch (reason) {
      setScan(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setScanning(false);
    }
  }

  async function pickSource(kind: 'file' | 'folder'): Promise<void> {
    const picked = await api.pickConverterSource(kind);
    if (!picked) return;
    setSource(picked);
    setOutputDir(null);
    await refreshScan(picked, null);
  }

  async function applySource(pathValue: string): Promise<void> {
    const nextPath = pathValue.trim().replace(/^"|"$/g, '');
    if (!nextPath) return;
    setSource(nextPath);
    setOutputDir(null);
    await refreshScan(nextPath, null);
  }

  async function pasteSource(): Promise<void> {
    try {
      const text = await api.readClipboardText();
      if (!text.trim()) {
        notify({ kind: 'warning', title: '剪贴板没有路径', message: '先在资源管理器复制文件或文件夹，再点一次。' });
        return;
      }
      await applySource(text);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const pathValue = api.getPathForFile(file);
    if (!pathValue) {
      setError('无法读取拖入路径');
      return;
    }
    void applySource(pathValue);
  }

  async function pickOutput(): Promise<void> {
    const picked = await api.pickConverterOutput();
    if (!picked) return;
    setOutputDir(picked);
    if (source) await refreshScan(source, picked);
  }

  async function start(): Promise<void> {
    if (!source || !scan || scan.files.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const next = await api.startConverter({
        source,
        outputDir,
        format,
        bitrateKbps,
        recursive,
        parallelism,
        threads: 0
      });
      setResult(next);
      notify({
        kind: next.failed > 0 ? 'warning' : 'success',
        title: '转码完成',
        message: '成功 ' + next.success + ' · 失败 ' + next.failed + ' · 跳过 ' + next.skipped
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const defaultOutput = source
    ? (scan?.outputDir || (outputDir || (source.endsWith('\\') ? source : source + '\\' + OUTPUT_FOLDER)))
    : '选择源文件夹后默认在源目录下新建 ' + OUTPUT_FOLDER;
  const percent = progress ? Math.max(0, Math.min(100, progress.overallPercent)) : 0;

  return (
    <div
      className={'converter-panel' + (dragging ? ' is-dragging' : '')}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={handleDrop}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text');
        if (text.trim()) {
          event.preventDefault();
          void applySource(text);
        }
      }}
    >
      <div className="converter-source-row">
        <div className="converter-source-main">
          <FileAudio size={15} />
          <span className="converter-source-path" title={source || ''}>
            {source || '还没有选择文件或文件夹'}
          </span>
        </div>
        <div className="converter-source-actions">
          <Button variant="secondary" size="sm" onClick={() => void pickSource('file')} disabled={busy}>
            <FileAudio size={13} />
            选文件
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void pickSource('folder')} disabled={busy}>
            <FolderOpen size={13} />
            选文件夹
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void pasteSource()} disabled={busy}>
            <ClipboardPaste size={13} />
            粘贴路径
          </Button>
        </div>
      </div>

      <div className="converter-drop-hint">
        <Upload size={13} />
        可以直接把文件或文件夹拖进来，也可以从资源管理器复制路径后点「粘贴路径」。
      </div>

      <SettingRow
        title="输出目录"
        description={'默认在源目录下新建 ' + OUTPUT_FOLDER + '。也可以手动指定。'}
        control={
          <Button variant="ghost" size="sm" onClick={() => void pickOutput()} disabled={busy}>
            <FolderTree size={13} />
            选择
          </Button>
        }
      />
      <div className="converter-output-line" title={defaultOutput}>
        <span>输出：</span>
        <code>{defaultOutput}</code>
        {outputDir ? (
          <button type="button" className="converter-reset-link" onClick={() => { setOutputDir(null); if (source) void refreshScan(source, null); }}>
            <RotateCcw size={11} /> 恢复默认
          </button>
        ) : null}
      </div>

      <div className="converter-engine-static">
        内嵌引擎：OpenConverter 核心 · Apache-2.0
      </div>

      <div className="converter-option-grid">
        <div>
          <span className="converter-label">目标格式</span>
          <Segmented
            value={format}
            options={[
              { value: 'mp3', label: 'MP3' },
              { value: 'aac', label: 'AAC' },
              { value: 'm4a', label: 'M4A' },
              { value: 'ogg', label: 'OGG' }
            ]}
            onChange={(value) => setFormat(value as ConverterFormat)}
            ariaLabel="转码目标格式"
          />
        </div>
        <div>
          <span className="converter-label">码率</span>
          <Segmented
            value={String(bitrateKbps)}
            options={BITRATES.map((value) => ({ value, label: value + 'k' }))}
            onChange={(value) => setBitrateKbps(Number(value))}
            ariaLabel="转码码率"
          />
        </div>
      </div>

      <div className="converter-options-row">
        <SettingRow
          title="递归子文件夹"
          description="只对文件夹生效；单个文件不受影响。"
          control={<Switch checked={recursive} onChange={(value) => { setRecursive(value); if (source) void refreshScan(source, outputDir); }} label="递归子文件夹" />}
        />
        <div className="converter-option-grid converter-parallel-grid">
          <div>
            <span className="converter-label">同时转码文件数</span>
            <Segmented
              value={String(parallelism)}
              options={[{ value: '0', label: '自动' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '4', label: '4' }]}
              onChange={(value) => setParallelism(Number(value))}
              ariaLabel="同时转码文件数"
            />
            <p className="converter-field-hint">自动按 CPU 核心数选择 1–4 个并发文件。</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refreshScan()} disabled={!source || scanning || busy}>
          <RefreshCw size={13} className={scanning ? 'spin' : undefined} />
          重新扫描
        </Button>
      </div>

      {scan ? (
        <div className="converter-summary">
          <div>
            <strong>{scan.files.length}</strong> 个文件 · <span>{mb(scan.totalBytes)}</span>
            <span className="converter-summary-kind">{scan.sourceKind === 'file' ? '单个文件' : scan.recursive ? '递归文件夹' : '当前文件夹'}</span>
          </div>
          <div className="converter-file-list">
            {scan.files.slice(0, 8).map((file) => (
              <div key={file.path} className="converter-file-line" title={file.path}>
                <span>{file.name}</span>
                <span>{mb(file.size)}</span>
              </div>
            ))}
            {scan.files.length > 8 ? <div className="converter-more">还有 {scan.files.length - 8} 个文件…</div> : null}
          </div>
        </div>
      ) : null}

      {busy ? (
        <div className="converter-progress">
          <div className="converter-progress-label">
            <span>{progress?.message || '准备转码…'}</span>
            <span>{percent}%</span>
          </div>
          <div className="converter-progress-track">
            <div className="converter-progress-fill" style={{ width: Math.max(2, percent) + '%' }} />
          </div>
          <div className="converter-progress-detail">{progress?.detail || '正在准备输出目录…'}</div>
        </div>
      ) : null}

      {result ? (
        <div className="converter-result">
          <div>
            成功 {result.success} · 失败 {result.failed} · 跳过 {result.skipped}
            <span className="converter-result-meta">
              耗时 {formatElapsed(result.finishedAt - result.startedAt)} · 成品 {mb(result.items.reduce((sum, item) => sum + item.bytes, 0))} · {engineLabel(result.engine)}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void api.openPath(result.outputDir)}>
            <ExternalLink size={13} />
            打开输出目录
          </Button>
        </div>
      ) : null}

      {error ? <div className="converter-error">{error}</div> : null}

      <div className="converter-start-row">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void start()}
          disabled={!scan || scan.files.length === 0 || busy}
        >
          <Play size={13} />
          {busy ? '转码中…' : '开始转码'}
        </Button>
        <span className="converter-hint">只处理音频文件；不会覆盖已有输出，会自动追加序号。</span>
      </div>
    </div>
  );
}
