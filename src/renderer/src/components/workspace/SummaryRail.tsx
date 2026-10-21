import { TriangleAlert, ArrowUpRight, LoaderCircle, Play, RotateCw, Undo2 } from 'lucide-react';
import type { SubtitleEncoding } from '@shared/types';
import { cn } from '../../lib/cn';
import { shortPath } from '../../lib/format';
import { collectWarnings, countPlan, selectedOperations } from '../../lib/plan';
import { useAppStore } from '../../store/useAppStore';
import { Switch } from '../ui';

const ENCODINGS: { value: SubtitleEncoding; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8（推荐）' },
  { value: 'utf-8-bom', label: 'UTF-8 BOM' },
  { value: 'gb18030', label: 'GB18030' }
];

export default function SummaryRail(): JSX.Element {
  const plan = useAppStore((state) => state.plan);
  const selection = useAppStore((state) => state.selection);
  const setSelection = useAppStore((state) => state.setSelection);
  const settings = useAppStore((state) => state.settings);
  const ffmpeg = useAppStore((state) => state.ffmpeg);
  const applying = useAppStore((state) => state.applying);
  const planRefreshing = useAppStore((state) => state.planRefreshing);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const runApply = useAppStore((state) => state.runApply);
  const refreshFfmpeg = useAppStore((state) => state.refreshFfmpeg);
  const setView = useAppStore((state) => state.setView);
  const setSettingsTab = useAppStore((state) => state.setSettingsTab);

  if (!plan) return <aside className="workspace-rail" />;

  const counts = countPlan(plan);
  const selected = selectedOperations(plan, selection);
  const operations = selected.total;
  const warnings = collectWarnings(plan.folders);
  const ffmpegInfo = ffmpeg ?? plan.ffmpeg;
  const ffmpegAvailable = Boolean(ffmpegInfo.available);

  return (
    <aside className="workspace-rail" aria-label="整理预览">
      <div className="rail-inner">
        <header className="rail-head">
          <span className="rail-kicker">
            <span className="chip-dot" style={{ background: 'var(--accent)' }} />
            Plan · 未执行
          </span>
          <h2 className="rail-title">整理预览</h2>
          <p className="rail-sub">执行前不会修改任何文件。</p>
        </header>

        {planRefreshing ? (
          <div className="rail-updating">
            <LoaderCircle size={13} className="spin" />
            正在根据设置更新预览…
          </div>
        ) : null}

        <section className="rail-section" aria-label="处理内容">
          <div className="rail-section-head">
            <span className="rail-section-title">处理内容</span>
          </div>
          <div className="rail-toggle">
            <div className="rail-toggle-text">
              <div className="rail-toggle-label">重命名音频</div>
              <div className="rail-toggle-desc">让音频与字幕使用同一个规范名称</div>
            </div>
            <Switch
              checked={selection.renameAudio}
              onChange={(checked) => setSelection({ renameAudio: checked })}
              label="重命名音频"
              disabled={counts.audioRenames === 0}
            />
          </div>
          <div className="rail-toggle">
            <div className="rail-toggle-text">
              <div className="rail-toggle-label">重命名字幕并转 LRC</div>
              <div className="rail-toggle-desc">{counts.subtitleConversions} 个字幕将转写为 LRC</div>
            </div>
            <Switch
              checked={selection.subtitle}
              onChange={(checked) => setSelection({ subtitle: checked })}
              label="重命名字幕并转 LRC"
              disabled={counts.subtitleRenames === 0 && counts.subtitleConversions === 0}
            />
          </div>
          <div className="rail-toggle">
            <div className="rail-toggle-text">
              <div className="rail-toggle-label">音频转码</div>
              <div className="rail-toggle-desc">
                {settings.convert.enabled
                  ? counts.audioConversions + ' 个文件将转为 ' + settings.convert.format.toUpperCase()
                  : '在「设置 › 音频」中开启转码'}
              </div>
            </div>
            <Switch
              checked={selection.convertAudio}
              onChange={(checked) => setSelection({ convertAudio: checked })}
              label="音频转码"
              disabled={!settings.convert.enabled || counts.audioConversions === 0}
            />
          </div>
          <div className="rail-toggle">
            <div className="rail-toggle-text">
              <div className="rail-toggle-label">应用封面</div>
              <div className="rail-toggle-desc">
                {counts.covers > 0 ? counts.covers + ' 个文件夹将写入封面' : '尚未选择封面'}
              </div>
            </div>
            <Switch
              checked={selection.cover}
              onChange={(checked) => setSelection({ cover: checked })}
              label="应用封面"
              disabled={counts.covers === 0}
            />
          </div>
        </section>

        <div className="rail-divider" />

        <section className="rail-numbers" aria-label="计划数量">
          <div className="rail-number">
            <span className="rail-number-label">重命名文件</span>
            <span className={cn('rail-number-value', selected.renames === 0 && 'is-zero')}>{selected.renames}</span>
          </div>
          <div className="rail-number">
            <span className="rail-number-label">字幕转写</span>
            <span className={cn('rail-number-value', selected.subtitleConversions === 0 && 'is-zero')}>
              {selected.subtitleConversions}
            </span>
          </div>
          <div className="rail-number">
            <span className="rail-number-label">音频转码</span>
            <span className={cn('rail-number-value', selected.audioConversions === 0 && 'is-zero')}>
              {selected.audioConversions}
            </span>
          </div>
          <div className="rail-number">
            <span className="rail-number-label">应用封面</span>
            <span className={cn('rail-number-value', selected.covers === 0 && 'is-zero')}>{selected.covers}</span>
          </div>
        </section>

        <div className="rail-field">
          <div className="rail-field-label">
            <span>字幕输出编码</span>
            <span className="mono" style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>
              LRC
            </span>
          </div>
          <div className="select-wrap rail-select">
            <select
              className="select"
              aria-label="字幕输出编码"
              value={settings.subtitle.encoding}
              onChange={(event) =>
                updateSettings({ subtitle: { encoding: event.target.value as SubtitleEncoding } })
              }
            >
              {ENCODINGS.map((encoding) => (
                <option key={encoding.value} value={encoding.value}>
                  {encoding.label}
                </option>
              ))}
            </select>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="ffmpeg-card">
          <div className="ffmpeg-top">
            <span className={cn('ffmpeg-dot', ffmpegAvailable ? 'is-ok' : 'is-warn')} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {ffmpegAvailable
                ? 'ffmpeg ' + (ffmpegInfo.version || '已就绪')
                : '未检测到 ffmpeg'}
            </span>
          </div>
          <div className="ffmpeg-path" title={ffmpegInfo.path || '未找到可执行文件'}>
            {ffmpegInfo.path ? shortPath(ffmpegInfo.path, 40) : '音频转码与封面转换需要 ffmpeg'}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm ffmpeg-action"
            onClick={() => {
              if (ffmpegAvailable) {
                void refreshFfmpeg();
              } else {
                setView('settings');
                setSettingsTab('tools');
              }
            }}
          >
            {ffmpegAvailable ? (
              <>
                <RotateCw size={12} />
                重新检测
              </>
            ) : (
              <>
                <ArrowUpRight size={12} />
                前往设置
              </>
            )}
          </button>
        </div>

        {warnings.length > 0 ? (
          <section className="rail-warnings" aria-label="需要确认的项目">
            <div className="rail-section-title">需要确认 · {warnings.length}</div>
            {warnings.slice(0, 4).map((item, index) => (
              <div key={item.warning.code + index} className="rail-warning">
                <TriangleAlert size={12} />
                <span>
                  {item.warning.message}
                  <span className="rail-warning-folder"> · {item.folder}</span>
                </span>
              </div>
            ))}
            {warnings.length > 4 ? (
              <span className="rail-warning-folder">还有 {warnings.length - 4} 条，请在配对列表中查看。</span>
            ) : null}
          </section>
        ) : null}

        <div className="rail-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={operations === 0 || applying || planRefreshing}
            onClick={() => void runApply()}
          >
            {applying ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
            {applying ? '正在整理…' : '执行整理'}
            {operations > 0 ? <span className="btn-count">{operations}</span> : null}
          </button>
          <span className="rail-note">
            <Undo2 size={11} />
            支持撤销 · 日志保留在本机
          </span>
        </div>
      </div>
    </aside>
  );
}