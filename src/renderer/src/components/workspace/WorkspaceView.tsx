import { useEffect, useMemo, useRef } from 'react';
import {
  Captions,
  ChevronsDownUp,
  ChevronsUpDown,
  FileAudio,
  FolderOpen,
  Image as ImageIcon,
  ListFilter,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  X
} from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatBytes, formatDay } from '../../lib/format';
import { countPlan, filterFolders, selectedOperations } from '../../lib/plan';
import { useAppStore } from '../../store/useAppStore';
import { Button, Spinner } from '../ui';
import FolderCard from './FolderCard';
import SummaryRail from './SummaryRail';

export default function WorkspaceView(): JSX.Element {
  const plan = useAppStore((state) => state.plan);
  const scan = useAppStore((state) => state.scan);
  const filter = useAppStore((state) => state.filter);
  const query = useAppStore((state) => state.query);
  const expanded = useAppStore((state) => state.expanded);
  const loading = useAppStore((state) => state.loading);
  const loadingLabel = useAppStore((state) => state.loadingLabel);
  const applying = useAppStore((state) => state.applying);
  const planStale = useAppStore((state) => state.planStale);
  const selection = useAppStore((state) => state.selection);
  const settings = useAppStore((state) => state.settings);
  const setFilter = useAppStore((state) => state.setFilter);
  const setQuery = useAppStore((state) => state.setQuery);
  const toggleFolder = useAppStore((state) => state.toggleFolder);
  const setAllExpanded = useAppStore((state) => state.setAllExpanded);
  const openCoverPicker = useAppStore((state) => state.openCoverPicker);
  const runApply = useAppStore((state) => state.runApply);
  const rescan = useAppStore((state) => state.rescan);
  const openPath = useAppStore((state) => state.openPath);
  const scrollRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => countPlan(plan), [plan]);
  const selected = useMemo(() => selectedOperations(plan, selection), [plan, selection]);
  const operations = selected.total;
  const filteredFolders = useMemo(
    () => (plan ? filterFolders(plan.folders, filter, query) : []),
    [plan, filter, query]
  );

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [plan?.root]);

  if (!plan) return <div className="empty-state" style={{ height: '100%' }} />;

  const stats = scan?.stats;
    const txtLyricCount = plan.folders.reduce(
      (total, folder) => total + folder.pairs.filter((pair) => pair.subtitle?.ext === 'txt').length,
      0
    );
    const subtitleCount = (stats?.subtitle || 0) + txtLyricCount;
  const allExpanded = plan.folders.every((folder) => expanded[folder.folder] !== false);
  const visiblePairs = filteredFolders.reduce((total, item) => total + item.pairs.length, 0);

  return (
    <div className="workspace">
      <div className="workspace-main" ref={scrollRef}>
        <div className="workspace-inner">
          <header className="workspace-header">
            <div className="ws-crumbs">
              <FolderOpen size={12} />
              <span>{plan.root}</span>
            </div>
            <div className="ws-title-row">
              <div className="ws-title-wrap">
                <h1 className="ws-title">{plan.rootName}</h1>
                <div className="ws-path" title={plan.root}>
                  <ShieldCheck size={12} />
                  只读预览 · 尚未修改文件
                </div>
              </div>
              <div className="ws-actions">
                <Button variant="secondary" size="sm" onClick={() => void rescan()} disabled={Boolean(loading) || applying}>
                  {loading === 'scan' ? <Spinner size={13} /> : <RefreshCw size={13} />}
                  重新扫描
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void openPath(plan.root)}>
                  <FolderOpen size={13} />
                  打开文件夹
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void runApply()}
                  disabled={operations === 0 || applying}
                >
                  <Play size={13} />
                  执行整理
                </Button>
              </div>
            </div>
            <div className="ws-meta">
              <span className="ws-meta-item">
                {plan.folders.length} 个文件夹 · {plan.summary.pairs} 组配对
              </span>
              <span className="ws-meta-dot" />
              <span className="ws-meta-item">扫描于 {formatDay(plan.createdAt)}</span>
              {scan?.truncated ? (
                <>
                  <span className="ws-meta-dot" />
                  <span className="chip chip-warn">文件较多，扫描已截断</span>
                </>
              ) : null}
              {planStale ? (
                <>
                  <span className="ws-meta-dot" />
                  <span className="chip chip-accent">设置已变更，预览待更新</span>
                </>
              ) : null}
              {loading ? (
                <span className="refresh-strip">
                  <Spinner size={12} />
                  {loadingLabel}
                </span>
              ) : null}
            </div>
          </header>

          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-icon">
                <FileAudio size={15} />
              </span>
              <span className="stat-value">{stats ? stats.audio : plan.summary.pairs}</span>
              <span className="stat-label">音频文件</span>
              <span className="stat-hint" title={formatBytes(stats?.bytes || 0)}>
                {formatBytes(stats?.bytes || 0)} · {plan.folders.length} 个文件夹
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <Captions size={15} />
              </span>
                <span className="stat-value">{subtitleCount}</span>
              <span className="stat-label">字幕文件</span>
                <span className="stat-hint">
                  VTT / SRT / LRC{txtLyricCount > 0 ? ' / ' + txtLyricCount + ' TXT' : ' / TXT'} · 输出 LRC
                </span>
            </div>
            <div className="stat-card">
              <span className="stat-icon">
                <ImageIcon size={15} />
              </span>
              <span className="stat-value">{stats ? stats.image : 0}</span>
              <span className="stat-label">封面候选</span>
              <span className="stat-hint">{counts.covers} 个封面待应用</span>
            </div>
            <div className="stat-card is-accent">
              <span className="stat-icon">
                <Play size={14} />
              </span>
              <span className="stat-value">{operations}</span>
              <span className="stat-label">预计操作</span>
              <span className="stat-hint">
                {selected.renames} 重命名 · {selected.subtitleConversions} 字幕 · {selected.audioConversions} 转码
              </span>
            </div>
          </div>

          <div className="toolbar">
            <div className="filter-chips" role="group" aria-label="筛选配对">
              <button
                type="button"
                className={cn('filter-chip', filter === 'all' && 'is-active')}
                onClick={() => setFilter('all')}
                aria-pressed={filter === 'all'}
              >
                <ListFilter size={12} />
                全部
                <span className="filter-count">{plan.summary.pairs}</span>
              </button>
              <button
                type="button"
                className={cn('filter-chip', filter === 'pending' && 'is-active')}
                onClick={() => setFilter('pending')}
                aria-pressed={filter === 'pending'}
              >
                待处理
                <span className="filter-count">{counts.pending}</span>
              </button>
              <button
                type="button"
                className={cn('filter-chip', filter === 'warn' && 'is-active')}
                onClick={() => setFilter('warn')}
                aria-pressed={filter === 'warn'}
              >
                有警告
                <span className="filter-count">{counts.warned}</span>
              </button>
            </div>
            <div className="toolbar-right">
              <div className="search-box">
                <Search size={14} className="search-icon" />
                <input
                  className="input"
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文件或文件夹…"
                  aria-label="搜索文件或文件夹"
                  spellCheck={false}
                />
                {query ? (
                  <button type="button" className="search-clear" aria-label="清除搜索" onClick={() => setQuery('')}>
                    <X size={13} />
                  </button>
                ) : null}
              </div>
              <span className="toolbar-divider" aria-hidden="true" />
              <button
                type="button"
                className="icon-btn"
                aria-label={allExpanded ? '收起全部文件夹' : '展开全部文件夹'}
                title={allExpanded ? '收起全部' : '展开全部'}
                onClick={() => setAllExpanded(!allExpanded)}
              >
                {allExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
              </button>
            </div>
          </div>

          {filteredFolders.length === 0 ? (
            <div className="search-empty">
              <Search size={20} />
              <div>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 550 }}>没有找到匹配的配对</div>
                <div style={{ marginTop: 3 }}>试试其他关键词，或切换筛选条件。</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                }}
              >
                清除筛选
              </button>
            </div>
          ) : (
            <div className="folder-list">
              {filteredFolders.map((item) => (
                <FolderCard
                  key={item.folder.folder}
                  folder={item.folder}
                  pairs={item.pairs}
                  expanded={expanded[item.folder.folder] !== false}
                  onToggle={() => toggleFolder(item.folder.folder)}
                  onOpenCover={() => openCoverPicker(item.folder.folder)}
                />
              ))}
            </div>
          )}

          <footer className="list-footer">
            <span>
              显示 {filteredFolders.length} 个文件夹 · {visiblePairs} 组配对
            </span>
            <span>
              <ShieldCheck size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
              应用前不会修改文件 · 字幕编码 {settings.subtitle.encoding.toUpperCase()}
            </span>
          </footer>
        </div>
      </div>
      <SummaryRail />
    </div>
  );
}