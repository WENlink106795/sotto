import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled,
  className,
  title,
  ariaLabel
}: ButtonProps): JSX.Element {
  const variantClass =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : variant === 'soft'
          ? 'btn-soft'
          : variant === 'danger'
            ? 'btn-danger-ghost'
            : 'btn-secondary';
  return (
    <button
      type={type}
      className={cn('btn', variantClass, size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', className)}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}

export function IconButton({ children, onClick, label, className, active, disabled, title }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={cn('icon-btn', active && 'is-active', className)}
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('segmented', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={cn('segmented-item', active && 'is-active')}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
          >
            {Icon ? <Icon size={13} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  ariaLabel
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}): JSX.Element {
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      style={{ '--range-progress': progress + '%' } as CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  className
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('select-wrap', className)}>
      <select className="select" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} />
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }): JSX.Element {
  return <LoaderCircle size={size} className="spin" />;
}

export function SettingsCard({
  title,
  description,
  actions,
  children,
  className
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cn('card settings-card', className)}>
      {title || description ? (
        <div className="settings-card-head">
          <div>
            {title ? <h3 className="settings-card-title">{title}</h3> : null}
            {description ? <p className="settings-card-desc">{description}</p> : null}
          </div>
          {actions ? <div className="setting-control">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SettingRow({
  title,
  description,
  control
}: {
  title: string;
  description?: string;
  control: ReactNode;
}): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-info">
        <div className="setting-title">{title}</div>
        {description ? <div className="setting-desc">{description}</div> : null}
      </div>
      <div className="setting-control">{control}</div>
    </div>
  );
}

export function PanelHeading({ title, description }: { title: string; description: string }): JSX.Element {
  return (
    <div className="panel-heading">
      <h2 className="panel-title">{title}</h2>
      <p className="panel-desc">{description}</p>
    </div>
  );
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'muted' }): JSX.Element {
  return <span className={cn('status-dot', tone === 'ok' && 'is-ok', tone === 'warn' && 'is-warn')} aria-hidden="true" />;
}

export function FileName({ name, className }: { name: string; className?: string }): JSX.Element {
  const index = name.lastIndexOf('.');
  const base = index > 0 ? name.slice(0, index) : name;
  const ext = index > 0 ? name.slice(index) : '';
  return (
    <span className={cn('file-name', className)} title={name}>
      <span className="file-name-base">{base}</span>
      {ext ? <span className="file-name-ext">{ext}</span> : null}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  closeOnOverlay = true
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  closeOnOverlay?: boolean;
}): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      dialogRef.current?.focus();
    }, 30);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={cn('modal', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={dialogRef}
      >
        {children}
      </div>
    </div>
  );
}