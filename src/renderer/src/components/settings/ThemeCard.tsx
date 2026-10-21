import { Check } from 'lucide-react';
import type { ThemePreset } from '@shared/types';
import { cn } from '../../lib/cn';
import { PRESET_LABELS } from '../../lib/images';

export default function ThemeCard({
  preset,
  active,
  onSelect
}: {
  preset: ThemePreset;
  active: boolean;
  onSelect: () => void;
}): JSX.Element {
  const meta = PRESET_LABELS[preset];
  return (
    <button
      type="button"
      className={cn('theme-card', active && 'is-active')}
      onClick={onSelect}
      aria-pressed={active}
      aria-label={'使用 ' + meta.name + ' 主题'}
    >
      <span className="theme-preview" data-preview={preset} aria-hidden="true">
        <span className="tp-bar">
          <span />
          <span />
          <span />
        </span>
        <span className="tp-body">
          <span className="tp-side">
            <span className="tp-nav is-active" />
            <span className="tp-nav" />
            <span className="tp-nav" />
            <span className="tp-nav" />
          </span>
          <span className="tp-main">
            <span className="tp-title" />
            <span className="tp-cards">
              <span className="tp-card" />
              <span className="tp-card" />
              <span className="tp-card" />
            </span>
            <span className="tp-row" />
            <span className="tp-row short" />
            <span className="tp-primary" />
          </span>
          <span className="tp-rail">
            <span className="tp-rail-row" />
            <span className="tp-rail-row is-short" />
            <span className="tp-rail-btn" />
          </span>
        </span>
      </span>
      <span className="theme-card-meta">
        <span>
          <span className="theme-name">{meta.name}</span>
          <span className="theme-desc">{meta.description}</span>
        </span>
        {active ? (
          <span className="theme-check">
            <Check size={10} strokeWidth={3.2} />
          </span>
        ) : null}
      </span>
    </button>
  );
}