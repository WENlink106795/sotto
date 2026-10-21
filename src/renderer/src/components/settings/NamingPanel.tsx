import { useMemo, useState } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import { SAMPLE_NAMES, sanitizeBaseName, stripExtension } from '@shared/naming';
import { useAppStore } from '../../store/useAppStore';
import { SettingRow, SettingsCard, Slider, Switch } from '../ui';

export default function NamingPanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const naming = settings.naming;
  const [sample, setSample] = useState(SAMPLE_NAMES[0]);

  const result = useMemo(() => sanitizeBaseName(stripExtension(sample), naming), [sample, naming]);
  const extension = sample.includes('.') ? sample.slice(sample.lastIndexOf('.')) : '.wav';
  const removedCount = result.removed.reduce((total, item) => total + item.count, 0);

  return (
    <div className="panel-stack">
      <section className="card preview-card">
        <div className="preview-label">
          <span>实时预览</span>
          <span className="chip chip-muted">使用当前命名规则</span>
        </div>
        <div className="preview-input-row">
          <input
            className="input input-mono"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            aria-label="命名预览输入"
            placeholder="输入一个文件名，例如：01 耳边轻语.wav"
            spellCheck={false}
          />
        </div>
        <div className="preview-result">
          <div className="preview-meta">
            <span>整理后</span>
            {result.changed ? <span className="chip chip-accent">已改写</span> : <span className="chip chip-success">无需修改</span>}
            {result.truncated ? <span className="chip chip-warn">已截断</span> : null}
            {result.fallback ? <span className="chip chip-warn">使用 fallback 名称</span> : null}
          </div>
          <div className="preview-result-name">
            {result.value}
            {extension}
          </div>
          <div className="preview-meta">
            {removedCount > 0 ? (
              <>
                <span>移除了 {removedCount} 个字符</span>
                <div className="removed-list">
                  {result.removed.map((item) => (
                    <span key={item.char} className="removed-chip" title={item.label + ' × ' + item.count}>
                      {item.char}
                      {item.count > 1 ? ' ×' + item.count : ''}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span>没有移除任何字符。</span>
            )}
          </div>
        </div>
        {naming.asciiOnly ? (
          <div className="callout callout-warn">
            <TriangleAlert size={14} />
            已开启「仅保留 ASCII」，中文、日文等字符会被移除。请确认目标播放器只接受英文文件名。
          </div>
        ) : null}
      </section>

      <SettingsCard title="命名规则" description="音频与字幕都会使用同一套规则，最终得到完全一致的基础名称。">
        <SettingRow
          title="启用命名规则"
          description="关闭后只做字幕转换与封面处理，不改动原文件名。"
          control={<Switch checked={naming.enabled} onChange={(enabled) => updateSettings({ naming: { enabled } })} label="启用命名规则" />}
        />
        <SettingRow
          title="NFKC 字符归一"
          description="把全角字符、兼容字符转换为标准形式，例如 ＦＵＬＬ 转 FULL。"
          control={<Switch checked={naming.normalizeNfkc} onChange={(normalizeNfkc) => updateSettings({ naming: { normalizeNfkc } })} label="NFKC 字符归一" />}
        />
        <SettingRow
          title="移除表情与符号"
          description="移除 ♡、☆ 等装饰符号，避免播放器或文件系统显示异常。"
          control={<Switch checked={naming.removeEmoji} onChange={(removeEmoji) => updateSettings({ naming: { removeEmoji } })} label="移除表情与符号" />}
        />
        <SettingRow
          title="仅保留 ASCII"
          description="移除中文、日文等非 ASCII 字符。适合只接受英文文件名的老旧播放器。"
          control={<Switch checked={naming.asciiOnly} onChange={(asciiOnly) => updateSettings({ naming: { asciiOnly } })} label="仅保留 ASCII" />}
        />
        <SettingRow
          title="合并连续空格"
          description="多个空格会合并为一个，并清理首尾空白。"
          control={<Switch checked={naming.collapseSpaces} onChange={(collapseSpaces) => updateSettings({ naming: { collapseSpaces } })} label="合并连续空格" />}
        />
        <SettingRow
          title="无字幕音频也重命名"
          description="为没有配对字幕的音频生成规范名称；关闭时保持原样并列为孤立文件。"
          control={
            <Switch
              checked={naming.renameAudioWithoutSubtitle}
              onChange={(renameAudioWithoutSubtitle) => updateSettings({ naming: { renameAudioWithoutSubtitle } })}
              label="无字幕音频也重命名"
            />
          }
        />
      </SettingsCard>

      <SettingsCard title="字符处理" description="精确控制哪些标点被保留、哪些字符被额外移除。修改会即时体现在实时预览中。">
        <SettingRow
          title="保留的标点"
          description="这些字符会原样保留在文件名中。"
          control={
            <input
              className="input input-mono"
              style={{ width: 300, maxWidth: '36vw' }}
              value={naming.keepPunctuation}
              onChange={(event) => updateSettings({ naming: { keepPunctuation: event.target.value } })}
              aria-label="保留的标点"
              spellCheck={false}
            />
          }
        />
        <SettingRow
          title="额外移除"
          description="除默认规则外，额外移除这些字符。"
          control={
            <input
              className="input input-mono"
              style={{ width: 200, maxWidth: '28vw' }}
              value={naming.extraRemove}
              onChange={(event) => updateSettings({ naming: { extraRemove: event.target.value } })}
              placeholder="例如 # ・"
              aria-label="额外移除的字符"
              spellCheck={false}
            />
          }
        />
        <SettingRow
          title="额外保留"
          description="强制保留默认规则会移除的字符。"
          control={
            <input
              className="input input-mono"
              style={{ width: 200, maxWidth: '28vw' }}
              value={naming.extraKeep}
              onChange={(event) => updateSettings({ naming: { extraKeep: event.target.value } })}
              placeholder="例如 ♡"
              aria-label="额外保留的字符"
              spellCheck={false}
            />
          }
        />
        <SettingRow
          title="名称最大长度"
          description="超出时从尾部截断，Windows 路径更安全。"
          control={
            <div className="setting-slider">
              <Slider
                min={20}
                max={160}
                step={5}
                value={naming.maxBaseLength}
                onChange={(maxBaseLength) => updateSettings({ naming: { maxBaseLength } })}
                ariaLabel="名称最大长度"
              />
              <span className="setting-slider-value">{naming.maxBaseLength} 字符</span>
            </div>
          }
        />
        <div className="callout">
          <Info size={14} />
          同名冲突时会自动追加 (2)、(3) 后缀，不会覆盖任何已有文件。重命名使用两阶段操作，失败时会自动回滚。
        </div>
      </SettingsCard>
    </div>
  );
}