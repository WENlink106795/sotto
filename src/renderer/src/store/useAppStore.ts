import { create } from 'zustand';
import { cloneSettings, DEFAULT_SETTINGS } from '@shared/defaults';
import type {
  AppInfo,
  ApplyResult,
  CoverChoice,
  CoverSettings,
  ConvertSettings,
  FfmpegInfo,
  GeneralSettings,
  NamingSettings,
  PlanResult,
  ProgressEvent,
  RunRecord,
  ScanResult,
  Settings,
  SubtitleSettings,
  ThemeSettings,
  UpdateInfo,
  UpdateProgress
} from '@shared/types';
import { api, bridgeMode } from '../lib/bridge';
import { runtimeConfig, type ViewKey } from '../lib/capture';
import { applyTheme, cacheSettings } from '../lib/theme';
import { countSelectedOperations, toApplySelection, type FilterMode, type SelectionState } from '../lib/plan';
import { PRESET_RADIUS } from '../lib/images';
import { DEMO_ROOT, demoCoverChoices } from '../lib/mock';

export type SettingsTab = 'appearance' | 'naming' | 'subtitle' | 'cover' | 'audio' | 'tools';
export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface SettingsPatch {
  theme?: Partial<ThemeSettings>;
  naming?: Partial<NamingSettings>;
  subtitle?: Partial<SubtitleSettings>;
  cover?: Partial<CoverSettings>;
  convert?: Partial<ConvertSettings>;
  general?: Partial<GeneralSettings>;
}

export interface AppStore {
  ready: boolean;
  bootError: string | null;
  booted: boolean;
  capture: boolean;
  bridgeMode: 'electron' | 'mock';
  view: ViewKey;
  settingsTab: SettingsTab;
  settings: Settings;
  settingsSaving: 'idle' | 'saving' | 'saved';
  appInfo: AppInfo | null;
  ffmpeg: FfmpegInfo | null;
  ffmpegLoading: boolean;
  root: string | null;
  scan: ScanResult | null;
  plan: PlanResult | null;
  planStale: boolean;
  planRefreshing: boolean;
  loading: 'scan' | 'plan' | null;
  loadingLabel: string;
  history: RunRecord[];
  historyLoading: boolean;
  applying: boolean;
  progress: ProgressEvent | null;
  progressLog: ProgressEvent[];
  result: ApplyResult | null;
  undoBusy: string | null;
  coverPickerFolder: string | null;
  coverChoices: CoverChoice[];
  selection: SelectionState;
  filter: FilterMode;
  query: string;
  expanded: Record<string, boolean>;
  toasts: ToastItem[];
  windowMaximized: boolean;
  boot: () => Promise<void>;
  setView: (view: ViewKey) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  updateSettings: (patch: SettingsPatch) => void;
  resetAppearance: () => void;
  openRoot: (root: string) => Promise<void>;
  pickFolder: () => Promise<void>;
  rescan: () => Promise<void>;
  rebuildPlan: (options?: { silent?: boolean }) => Promise<void>;
  runApply: () => Promise<void>;
  undoRun: (runId?: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  refreshFfmpeg: (silent?: boolean) => Promise<void>;
  chooseFfmpeg: () => Promise<void>;
  setSelection: (patch: Partial<SelectionState>) => void;
  setFilter: (filter: FilterMode) => void;
  setQuery: (query: string) => void;
  toggleFolder: (folder: string) => void;
  setAllExpanded: (expanded: boolean) => void;
  openCoverPicker: (folder: string | null) => void;
  applyCover: (folder: string, imagePath: string, convert: boolean) => Promise<void>;
  clearCover: (folder: string) => Promise<void>;
  dismissResult: () => void;
  toast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: number) => void;
  windowMinimize: () => void;
  windowToggleMaximize: () => void;
  windowClose: () => void;
  openPath: (targetPath: string) => Promise<void>;
  exportLogs: () => Promise<void>;
  exportSettings: () => Promise<void>;
  importSettings: () => Promise<void>;
  updateInfo: UpdateInfo | null;
  updatePromptOpen: boolean;
  updateChecking: boolean;
  updateDownloading: boolean;
  updateProgress: UpdateProgress | null;
  updateDownloadedPath: string | null;
  updateError: string | null;
  checkUpdates: (force?: boolean, manual?: boolean) => Promise<void>;
  dismissUpdatePrompt: () => void;
  startUpdateDownload: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openReleasePage: () => Promise<void>;
}

let toastSeq = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistResetTimer: ReturnType<typeof setTimeout> | null = null;
let planTimer: ReturnType<typeof setTimeout> | null = null;
let subscribed = false;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '发生了未知错误，请稍后重试。';
}

function defaultSelection(settings: Settings): SelectionState {
  return {
    renameAudio: settings.naming.enabled,
    subtitle: true,
    convertAudio: settings.convert.enabled,
    cover: settings.cover.enabled
  };
}

function expandAll(plan: PlanResult): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const folder of plan.folders) expanded[folder.folder] = true;
  return expanded;
}

function mergeExpanded(previous: Record<string, boolean>, plan: PlanResult): Record<string, boolean> {
  const next: Record<string, boolean> = { ...previous };
  for (const folder of plan.folders) {
    if (next[folder.folder] === undefined) next[folder.folder] = true;
  }
  return next;
}

function withRecent(settings: Settings, scan: ScanResult): GeneralSettings {
  const entry = {
    root: scan.root,
    name: scan.rootName,
    lastOpenedAt: Date.now(),
    audioCount: scan.stats.audio
  };
  const rest = settings.general.recentRoots.filter((item) => item.root !== scan.root);
  return { ...settings.general, recentRoots: [entry, ...rest].slice(0, 8) };
}

export const useAppStore = create<AppStore>()((set, get) => {
  const notify = (toast: Omit<ToastItem, 'id'>): void => {
    if (get().capture) return;
    const id = (toastSeq += 1);
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
  };

  const fail = (title: string, error: unknown): void => {
    notify({ kind: 'error', title, message: messageOf(error) });
  };

  const schedulePersist = (settings: Settings): void => {
    if (get().capture) return;
    if (persistTimer) clearTimeout(persistTimer);
    if (persistResetTimer) clearTimeout(persistResetTimer);
    set({ settingsSaving: 'saving' });
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void api
        .saveSettings(settings)
        .then((saved) => {
          if (saved) cacheSettings(saved);
          set({ settingsSaving: 'saved' });
          persistResetTimer = setTimeout(() => {
            if (get().settingsSaving === 'saved') set({ settingsSaving: 'idle' });
          }, 2200);
        })
        .catch((error) => {
          set({ settingsSaving: 'idle' });
          fail('设置保存失败', error);
        });
    }, 550);
  };

  const commitSettings = (next: Settings, planAffecting: boolean): void => {
    applyTheme(next.theme, { capture: get().capture });
    cacheSettings(next);
    const hasPlan = Boolean(get().plan);
    set({ settings: next, ...(planAffecting && hasPlan ? { planStale: true } : {}) });
    schedulePersist(next);
    if (planAffecting && hasPlan && get().view === 'library') {
      if (planTimer) clearTimeout(planTimer);
      planTimer = setTimeout(() => {
        planTimer = null;
        void get().rebuildPlan({ silent: true });
      }, 650);
    }
  };

  return {
    ready: false,
    bootError: null,
    booted: false,
    capture: runtimeConfig.capture,
    bridgeMode,
    view: 'library',
    settingsTab: 'appearance',
    settings: cloneSettings(DEFAULT_SETTINGS),
    settingsSaving: 'idle',
    appInfo: null,
    ffmpeg: null,
    ffmpegLoading: false,
    root: null,
    scan: null,
    plan: null,
    planStale: false,
    planRefreshing: false,
    loading: null,
    loadingLabel: '',
    history: [],
    historyLoading: false,
    applying: false,
    progress: null,
    progressLog: [],
    result: null,
    undoBusy: null,
    coverPickerFolder: null,
    coverChoices: [],
    selection: defaultSelection(DEFAULT_SETTINGS),
    filter: 'all',
    query: '',
    expanded: {},
    toasts: [],
    windowMaximized: false,
    updateInfo: null,
    updatePromptOpen: false,
    updateChecking: false,
    updateDownloading: false,
    updateProgress: null,
    updateDownloadedPath: null,
    updateError: null,

    async boot() {
      if (get().booted) return;
      set({ booted: true });
      if (!subscribed) {
        subscribed = true;
        api.onProgress((event) => {
          if (!get().applying) return;
          set((state) => ({
            progress: event,
            progressLog: [...state.progressLog, event].slice(-9)
          }));
        });
        api.onWindowMaximized((maximized) => set({ windowMaximized: maximized }));
      }
      try {
        const [settingsRaw, appInfo, ffmpeg, maximized] = await Promise.all([
          api.getSettings(),
          api.getAppInfo().catch(() => null),
          api.getFfmpegInfo(false).catch(() => null),
          api.isWindowMaximized().catch(() => false)
        ]);
        const settings = cloneSettings(settingsRaw);
        if (runtimeConfig.theme) {
          settings.theme.preset = runtimeConfig.theme;
          settings.theme.radius = PRESET_RADIUS[runtimeConfig.theme];
        }
        if (runtimeConfig.mode) settings.theme.mode = runtimeConfig.mode;
        applyTheme(settings.theme, { capture: runtimeConfig.capture });
        cacheSettings(settings);
        set({
          settings,
          appInfo,
          ffmpeg,
          view: runtimeConfig.view,
          windowMaximized: maximized
        });
        if (runtimeConfig.view === 'history') await get().loadHistory();
        if (runtimeConfig.workspaceDemo && bridgeMode === 'mock') {
          const root = settings.general.recentRoots[0]?.root || DEMO_ROOT;
          const scan = await api.scan(root);
          const coverChoices = demoCoverChoices(scan, settings);
          const plan = await api.buildPlan({
            root: scan.root,
            settings,
            manualPairs: [],
            coverChoices
          });
          set({
            root: scan.root,
            scan,
            plan,
            coverChoices,
            selection: defaultSelection(settings),
            expanded: expandAll(plan),
            view: 'library',
            planStale: false
          });
        }
        set({ ready: true });
      } catch (error) {
        set({ ready: true, bootError: messageOf(error) });
      }
    },

    setView(view) {
      set({ view });
      if (view === 'history') void get().loadHistory();
      if (view === 'library' && get().planStale && get().plan) {
        void get().rebuildPlan({ silent: true });
      }
    },

    setSettingsTab(tab) {
      set({ settingsTab: tab });
    },

    updateSettings(patch) {
      const current = get().settings;
      const next: Settings = {
        ...current,
        theme: { ...current.theme, ...patch.theme },
        naming: { ...current.naming, ...patch.naming },
        subtitle: { ...current.subtitle, ...patch.subtitle },
        cover: { ...current.cover, ...patch.cover },
        convert: { ...current.convert, ...patch.convert },
        general: { ...current.general, ...patch.general }
      };
      const planAffecting = Boolean(patch.naming || patch.subtitle || patch.cover || patch.convert);
      commitSettings(next, planAffecting);
      if (typeof patch.convert?.enabled === 'boolean') {
        set((state) => ({ selection: { ...state.selection, convertAudio: patch.convert!.enabled! } }));
      }
    },

    resetAppearance() {
      get().updateSettings({ theme: { ...DEFAULT_SETTINGS.theme } });
      notify({ kind: 'info', title: '外观已恢复默认', message: '主题、强调色与版式均已重置。' });
    },

    async openRoot(root) {
      if (get().applying) return;
      set({
        root,
        view: 'library',
        loading: 'scan',
        loadingLabel: '正在扫描文件夹…',
        scan: null,
        plan: null,
        planStale: false,
        planRefreshing: false,
        coverChoices: [],
        coverPickerFolder: null,
        result: null,
        filter: 'all',
        query: ''
      });
      try {
        const scan = await api.scan(root);
        set({ scan, loading: 'plan', loadingLabel: '正在匹配音频与字幕…' });
        const coverChoices: CoverChoice[] = [];
        const plan = await api.buildPlan({
          root: scan.root,
          settings: get().settings,
          manualPairs: [],
          coverChoices
        });
        const nextSettings: Settings = { ...get().settings, general: withRecent(get().settings, scan) };
        cacheSettings(nextSettings);
        schedulePersist(nextSettings);
        set({
          settings: nextSettings,
          plan,
          loading: null,
          planStale: false,
          coverChoices,
          selection: defaultSelection(get().settings),
          expanded: expandAll(plan)
        });
      } catch (error) {
        set({ loading: null });
        fail('无法打开这个文件夹', error);
      }
    },

    async pickFolder() {
      try {
        const root = await api.pickFolder();
        if (root) await get().openRoot(root);
      } catch (error) {
        fail('无法选择文件夹', error);
      }
    },

    async rescan() {
      const root = get().root;
      if (!root || get().loading || get().applying) return;
      set({ loading: 'scan', loadingLabel: '正在重新扫描文件夹…' });
      try {
        const previousExpanded = get().expanded;
        const scan = await api.scan(root);
        set({ scan, loading: 'plan', loadingLabel: '正在生成新的整理预览…' });
        const plan = await api.buildPlan({
          root: scan.root,
          settings: get().settings,
          manualPairs: [],
          coverChoices: get().coverChoices.filter((choice) =>
            scan.folders.some((folder) => folder.path === choice.folder)
          )
        });
        set({
          plan,
          loading: null,
          planStale: false,
          expanded: mergeExpanded(previousExpanded, plan),
          selection: get().selection
        });
        notify({ kind: 'success', title: '已重新扫描', message: '整理预览已更新。' });
      } catch (error) {
        set({ loading: null });
        fail('重新扫描失败', error);
      }
    },

    async rebuildPlan(options) {
      const state = get();
      if (!state.root || !state.plan || state.applying || state.loading) return;
      if (options?.silent) set({ planRefreshing: true });
      else set({ loading: 'plan', loadingLabel: '正在更新整理预览…' });
      try {
        const plan = await api.buildPlan({
          root: state.root,
          settings: get().settings,
          manualPairs: [],
          coverChoices: get().coverChoices
        });
        set((current) => ({
          plan,
          planRefreshing: false,
          loading: null,
          planStale: false,
          expanded: mergeExpanded(current.expanded, plan)
        }));
      } catch (error) {
        set({ planRefreshing: false, loading: null });
        fail('预览更新失败', error);
      }
    },

    async runApply() {
      const state = get();
      if (!state.plan || state.applying || state.planRefreshing) return;
      if (state.planStale) await get().rebuildPlan();
      const plan = get().plan;
      if (!plan) return;
      const selection = get().selection;
      const operations = countSelectedOperations(plan, selection);
      if (operations === 0) {
        notify({
          kind: 'info',
          title: '没有需要执行的操作',
          message: '调整右侧的处理项后再试。'
        });
        return;
      }
      const liveFfmpeg = get().ffmpeg ?? plan.ffmpeg;
      if (selection.convertAudio && !liveFfmpeg.available) {
        notify({
          kind: 'error',
          title: '未检测到 ffmpeg',
          message: '音频转码需要 ffmpeg，请先在「设置 › 工具」中选择路径。'
        });
        return;
      }
      set({
        applying: true,
        result: null,
        progressLog: [],
        progress: {
          runId: '',
          phase: 'rename',
          current: 0,
          total: operations,
          overallPercent: 0,
          message: '准备整理…',
          detail: null,
          level: 'info',
          at: Date.now()
        }
      });
      try {
        const result = await api.applyPlan({ plan, selection: toApplySelection(selection) });
        set({ applying: false, progress: null, result, planStale: true });
        void get().loadHistory();
      } catch (error) {
        set({ applying: false, progress: null });
        fail('整理没有完成', error);
      }
    },

    async undoRun(runId) {
      if (get().undoBusy) return;
      set({ undoBusy: runId ?? 'latest' });
      try {
        const result = await api.undoRun(runId);
        notify({
          kind: result.status === 'failed' ? 'error' : 'success',
          title: result.status === 'success' ? '已撤销本次整理' : '撤销未完全成功',
          message: result.message
        });
        if (result.status === 'success') {
          set({ result: null, planStale: true });
          if (get().plan && get().root) void get().rebuildPlan({ silent: true });
        }
        await get().loadHistory();
      } catch (error) {
        fail('撤销失败', error);
      } finally {
        set({ undoBusy: null });
      }
    },

    async loadHistory() {
      if (get().historyLoading) return;
      set({ historyLoading: true });
      try {
        const history = await api.getHistory();
        history.sort((a, b) => b.startedAt - a.startedAt);
        set({ history, historyLoading: false });
      } catch (error) {
        set({ historyLoading: false });
        fail('无法读取运行记录', error);
      }
    },

    async refreshFfmpeg(silent) {
      set({ ffmpegLoading: true });
      try {
        const info = await api.getFfmpegInfo(true);
        set({ ffmpeg: info, ffmpegLoading: false });
        if (get().plan && get().root) void get().rebuildPlan({ silent: true });
        if (!silent) {
          notify({
            kind: info.available ? 'success' : 'warning',
            title: info.available ? 'ffmpeg 已就绪' : '未检测到 ffmpeg',
            message: info.available ? '版本 ' + info.version : '请在「设置 › 工具」中指定 ffmpeg.exe。'
          });
        }
      } catch (error) {
        set({ ffmpegLoading: false });
        fail('检测 ffmpeg 失败', error);
      }
    },

    async chooseFfmpeg() {
      try {
        const path = await api.pickFfmpeg();
        if (!path) return;
        const next: Settings = {
          ...get().settings,
          general: { ...get().settings.general, ffmpegPath: path }
        };
        cacheSettings(next);
        set({ settings: next });
        const saved = await api.saveSettings(next);
        cacheSettings(saved);
        set({ settings: saved });
        await get().refreshFfmpeg(true);
        notify({ kind: 'success', title: '已保存 ffmpeg 路径', message: path });
      } catch (error) {
        fail('无法选择 ffmpeg', error);
      }
    },

    setSelection(patch) {
      set((state) => ({ selection: { ...state.selection, ...patch } }));
    },

    setFilter(filter) {
      set({ filter });
    },

    setQuery(query) {
      set({ query });
    },

    toggleFolder(folder) {
      set((state) => ({
        expanded: { ...state.expanded, [folder]: !state.expanded[folder] }
      }));
    },

    setAllExpanded(expanded) {
      set((state) => {
        const next: Record<string, boolean> = { ...state.expanded };
        if (state.plan) {
          for (const folder of state.plan.folders) next[folder.folder] = expanded;
        }
        return { expanded: next };
      });
    },

    openCoverPicker(folder) {
      set({ coverPickerFolder: folder });
    },

    async applyCover(folder, imagePath, convert) {
      const choices = get().coverChoices.filter((choice) => choice.folder !== folder);
      choices.push({ folder, imagePath, convertToJpeg: convert });
      set({ coverChoices: choices, coverPickerFolder: null });
      await get().rebuildPlan({ silent: true });
      notify({
        kind: 'success',
        title: '封面已加入预览',
        message: '执行整理时会应用这个封面。'
      });
    },

    async clearCover(folder) {
      set({
        coverChoices: get().coverChoices.filter((choice) => choice.folder !== folder),
        coverPickerFolder: null
      });
      await get().rebuildPlan({ silent: true });
      notify({ kind: 'info', title: '已取消封面', message: '执行整理时不会改动这个文件夹的封面。' });
    },

    dismissResult() {
      set({ result: null });
      if (get().plan && get().root) void get().rebuildPlan({ silent: true });
    },

    toast(toast) {
      notify(toast);
    },

    dismissToast(id) {
      set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
    },

    windowMinimize() {
      try {
        api.windowMinimize();
      } catch {
        /* browser preview */
      }
    },

    windowToggleMaximize() {
      if (get().bridgeMode === 'mock') {
        set((state) => ({ windowMaximized: !state.windowMaximized }));
        return;
      }
      try {
        api.windowToggleMaximize();
      } catch {
        /* window unavailable */
      }
    },

    windowClose() {
      if (get().bridgeMode === 'mock') return;
      try {
        api.windowClose();
      } catch {
        /* window unavailable */
      }
    },

    async exportLogs() {
      try {
        const saved = await api.exportLogs();
        if (!saved) {
          notify({ kind: 'info', title: '已取消导出' });
          return;
        }
        notify({ kind: 'success', title: '诊断日志已导出', message: saved });
      } catch (error) {
        fail('导出诊断日志失败', error);
      }
    },

    async exportSettings() {
      try {
        const saved = await api.exportSettings();
        if (!saved) {
          notify({ kind: 'info', title: '已取消导出设置' });
          return;
        }
        notify({ kind: 'success', title: '设置已导出', message: saved });
      } catch (error) {
        fail('导出设置失败', error);
      }
    },

    async importSettings() {
      try {
        const saved = await api.importSettings();
        if (!saved) return;
        cacheSettings(saved);
        applyTheme(saved.theme);
        set({ settings: saved, settingsSaving: 'saved' });
        notify({ kind: 'success', title: '设置已导入', message: '主题与偏好已更新。' });
      } catch (error) {
        fail('导入设置失败', error);
      }
    },

    async checkUpdates(force = false, manual = false) {
      if (get().updateChecking) return;
      set({ updateChecking: true });
      try {
        const info = await api.checkForUpdates(force);
        set({ updateChecking: false, updateInfo: info });
        if (!info) {
          if (manual) notify({ kind: 'error', title: '检查更新失败', message: '无法连接 GitHub，请稍后再试。' });
          return;
        }
        if (!info.hasUpdate) {
          if (manual) notify({ kind: 'success', title: '已是最新版本', message: 'v' + info.currentVersion });
          return;
        }
        const today = new Date().toISOString().slice(0, 10);
        const auto = get().settings.general.autoUpdate;
        if (!manual && (!auto || get().settings.general.lastUpdatePrompt === today)) return;
        set({ updatePromptOpen: true });
        if (!manual) {
          const next = {
            ...get().settings,
            general: { ...get().settings.general, lastUpdatePrompt: today }
          };
          cacheSettings(next);
          set({ settings: next });
          void api.saveSettings(next).catch(() => undefined);
        }
      } catch (error) {
        set({ updateChecking: false });
        if (manual) fail('检查更新失败', error);
      }
    },

    dismissUpdatePrompt() {
      set({ updatePromptOpen: false });
    },

    async startUpdateDownload() {
      const info = get().updateInfo;
      if (!info || !info.assetUrl) {
        notify({ kind: 'error', title: '没有可下载的安装包', message: '请前往 GitHub Releases 手动下载。' });
        return;
      }
      set({ updateDownloading: true, updateDownloadedPath: null, updateError: null });
      try {
        const saved = await api.downloadUpdate(info);
        set({ updateDownloading: false, updateDownloadedPath: saved });
        notify({ kind: 'success', title: '更新已下载', message: '可以点击「安装并重启」完成升级。' });
      } catch (error) {
        set({ updateDownloading: false });
        fail('下载更新失败', error);
      }
    },

    async installUpdate() {
      const target = get().updateDownloadedPath;
      if (!target) return;
      try {
        await api.installUpdate(target);
      } catch (error) {
        fail('启动安装程序失败', error);
      }
    },

    async openReleasePage() {
      const url = get().updateInfo?.releaseUrl || 'https://github.com/WENlink106795/sotto/releases/latest';
      try {
        await api.openExternal(url);
      } catch (error) {
        fail('无法打开下载页面', error);
      }
    },

    async openPath(targetPath) {
      try {
        await api.openPath(targetPath);
      } catch (error) {
        fail('无法打开路径', error);
      }
    }
  };
});