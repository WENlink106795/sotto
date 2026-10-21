import { useEffect } from 'react';
import { TriangleAlert, CircleCheckBig, Info, X, CircleX } from 'lucide-react';
import type { ToastItem } from '../store/useAppStore';
import { useAppStore } from '../store/useAppStore';
import { cn } from '../lib/cn';

function ToastCard({ toast }: { toast: ToastItem }): JSX.Element {
  const dismiss = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 4800);
    return () => window.clearTimeout(timer);
  }, [toast.id, dismiss]);

  const Icon = toast.kind === 'success' ? CircleCheckBig : toast.kind === 'error' ? CircleX : toast.kind === 'warning' ? TriangleAlert : Info;

  return (
    <div className={cn('toast', 'is-' + toast.kind)} role="status">
      <span className="toast-icon">
        <Icon size={15} />
      </span>
      <div className="toast-main">
        <div className="toast-title">{toast.title}</div>
        {toast.message ? <div className="toast-msg">{toast.message}</div> : null}
      </div>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => dismiss(toast.id)}>
        <X size={13} />
      </button>
    </div>
  );
}

export default function ToastHost(): JSX.Element | null {
  const toasts = useAppStore((state) => state.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}