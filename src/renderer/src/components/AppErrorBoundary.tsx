import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { api } from '../lib/bridge';

interface AppErrorBoundaryState {
  error: Error | null;
}

export default class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void api
      .log({
        level: 'error',
        message: error.message,
        stack: error.stack,
        source: 'react-error-boundary',
        meta: { componentStack: info.componentStack }
      })
      .catch(() => undefined);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-root">
        <div className="empty-state" style={{ height: '100vh' }}>
          <span className="empty-illustration">
            <ShieldAlert size={22} />
          </span>
          <div className="empty-state-title">界面遇到了问题</div>
          <p className="empty-state-desc">
            错误已写入本地日志。可以重新加载，或在「设置 › 工具」中导出诊断日志反馈问题。
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
