import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import AppErrorBoundary from './components/AppErrorBoundary';
import { api } from './lib/bridge';
import { bootTheme } from './lib/theme';
import './styles/global.css';
import './styles/theme.css';
import './styles/components.css';
import './styles/views.css';
import './styles/surfaces.css';

bootTheme();

function reportRendererError(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  stack: string | undefined,
  source: string,
  meta?: Record<string, unknown>
): void {
  void api
    .log({ level, message, stack, source, meta })
    .catch(() => undefined);
}

window.addEventListener('error', (event) => {
  reportRendererError('error', event.message || 'Uncaught renderer error', event.error?.stack, 'window.error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  reportRendererError('error', message, stack, 'window.unhandledrejection');
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);