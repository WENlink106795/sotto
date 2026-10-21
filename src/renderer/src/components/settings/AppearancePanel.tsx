import { Monitor, Moon, Sun } from 'lucide-react';
import type { Density, ThemeMode, ThemePreset } from '@shared/types';
import { ACCENT_SWATCHES, PRESET_RADIUS } from '../../lib/images';
import { useAppStore } from '../../store/useAppStore';
import { Segmented, SettingRow, SettingsCard, Slider, Switch } from '../ui';
import ThemeCard from './ThemeCard';

const PRESETS: ThemePreset[] = ['fluent', 'material', 'studio'];
const MODES: { value: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon }
];
const DENSITIES: { value: Density; label: string }[] = [
  { value: 'comfortable', label: '舒适' },
  { value: 'compact', label: '紧凑' }
];

export default function AppearancePanel(): JSX.Element {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const theme = settings.theme;

  const selectPreset = (preset: ThemePreset): void => {
    updateSettings({ theme: { preset, radius: PRESET_RADIUS[preset] } });
  };

  return (
    <div className="panel-stack">
      <SettingsCard
        title="主题"
        description="每一套主题都会改变界面的材质、圆角与留白气质，而不只是颜色。切换立即生效。"
      >
        <div className="theme-grid">
          {PRESETS.map((preset) => (
            <ThemeCard
              key={preset}
              preset={preset}
              active={theme.preset === preset}
              onSelect={() => selectPreset(preset)}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="色彩" description="选择明暗模式与强调色。强调色会被用于按钮、选中态、图表与柔和光晕。">
        <SettingRow
          title="明暗模式"
          description="跟随系统会随 Windows 的浅色或深色模式自动切换。"
          control={
            <Segmented
              value={theme.mode}
              options={MODES}
              onChange={(mode) => updateSettings({ theme: { mode } })}
              ariaLabel="明暗模式"
            />
          }
        />
        <div className="setting-row" style={{ alignItems: 'flex-start' }}>
          <div className="setting-info">
            <div className="setting-title">强调色</div>
            <div className="setting-desc">用于主要操作与选中状态，会自动生成协调的浅色底。</div>
          </div>
          <div className="accent-grid">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                className={'accent-swatch' + (theme.accent.toLowerCase() === swatch.value ? ' is-active' : '')}
                style={{ background: swatch.value }}
                onClick={() => updateSettings({ theme: { accent: swatch.value } })}
                aria-label={'强调色：' + swatch.name}
                title={swatch.name + ' · ' + swatch.value.toUpperCase()}
              />
            ))}
            <label className="accent-custom" title="自定义强调色">
              <input
                type="color"
                className="color-input"
                value={theme.accent}
                aria-label="自定义强调色"
                onChange={(event) => updateSettings({ theme: { accent: event.target.value } })}
              />
              <span className="hex-code">{theme.accent.toUpperCase()}</span>
            </label>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="版式与动效" description="微调密度、圆角与动态效果。紧凑模式适合更大规模的资料库。">
        <SettingRow
          title="界面密度"
          description="控制列表行高、卡片内边距与侧栏导航高度。"
          control={
            <Segmented
              value={theme.density}
              options={DENSITIES}
              onChange={(density) => updateSettings({ theme: { density } })}
              ariaLabel="界面密度"
            />
          }
        />
        <SettingRow
          title="圆角"
          description="主题会提供默认圆角，你可以在此基础上继续调整。"
          control={
            <div className="setting-slider">
              <Slider
                min={4}
                max={20}
                value={theme.radius}
                onChange={(radius) => updateSettings({ theme: { radius } })}
                ariaLabel="圆角大小"
              />
              <span className="setting-slider-value">{theme.radius}px</span>
            </div>
          }
        />
        <SettingRow
          title="界面文字大小"
          description="按比例缩放整个界面的文字，不影响窗口尺寸。"
          control={
            <div className="setting-slider">
              <Slider
                min={90}
                max={115}
                step={5}
                value={Math.round(theme.fontScale * 100)}
                onChange={(value) => updateSettings({ theme: { fontScale: value / 100 } })}
                ariaLabel="界面文字大小"
              />
              <span className="setting-slider-value">{Math.round(theme.fontScale * 100)}%</span>
            </div>
          }
        />
        <SettingRow
          title="透明面板"
          description="让标题栏、侧栏与预览栏透出背景层次；关闭后使用不透明表面。"
          control={
            <Switch
              checked={theme.transparency}
              onChange={(transparency) => updateSettings({ theme: { transparency } })}
              label="透明面板"
            />
          }
        />
        <SettingRow
          title="减少动态效果"
          description="关闭过渡与动画，适合对动效敏感或在远程桌面中使用。"
          control={
            <Switch
              checked={theme.reduceMotion}
              onChange={(reduceMotion) => updateSettings({ theme: { reduceMotion } })}
              label="减少动态效果"
            />
          }
        />
      </SettingsCard>
    </div>
  );
}
