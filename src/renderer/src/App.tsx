import { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import BootScreen from './components/BootScreen';
import LibraryView from './components/LibraryView';
import HistoryView from './components/HistoryView';
import SettingsView from './components/SettingsView';
import CoverPicker from './components/CoverPicker';
import ProgressOverlay from './components/ProgressOverlay';
import ResultDialog from './components/ResultDialog';
import ToastHost from './components/ToastHost';
import UpdatePrompt from './components/UpdatePrompt';

export default function App(): JSX.Element {
  const boot = useAppStore((state) => state.boot);
  const ready = useAppStore((state) => state.ready);
  const bootError = useAppStore((state) => state.bootError);
  const view = useAppStore((state) => state.view);

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <div className="app-root">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="app-main">
          {!ready ? (
            <BootScreen />
          ) : bootError ? (
            <div className="empty-state" style={{ height: '100%' }}>
              <span className="empty-illustration">
                <ShieldAlert size={22} />
              </span>
              <div className="empty-state-title">无法启动 Sotto</div>
              <p className="empty-state-desc">{bootError}</p>
              <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
                重新加载
              </button>
            </div>
          ) : (
            <div className="view-enter" key={view}>
              {view === 'library' ? <LibraryView /> : view === 'history' ? <HistoryView /> : <SettingsView />}
            </div>
          )}
        </main>
      </div>
      <CoverPicker />
      <ProgressOverlay />
      <ResultDialog />
      <ToastHost />
    </div>
  );
}
