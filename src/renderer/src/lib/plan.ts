import type {
  ApplySelection,
  FolderPlan,
  MatchKind,
  PairPlan,
  PlanResult,
  PlanWarning
} from '@shared/types';

export type FilterMode = 'all' | 'pending' | 'warn';

export interface SelectionState {
  renameAudio: boolean;
  subtitle: boolean;
  convertAudio: boolean;
  cover: boolean;
}

export const MATCH_LABELS: Record<MatchKind, string> = {
  exact: '精确',
  normalized: '归一化',
  fuzzy: '模糊',
  single: '单文件',
  manual: '手动'
};

export const MATCH_HINTS: Record<MatchKind, string> = {
  exact: '音频与字幕基础名称完全一致',
  normalized: '忽略符号、全半角与大小写后一致',
  fuzzy: '名称相近，建议人工确认配对',
  single: '同文件夹内唯一可配对的字幕',
  manual: '由你手动指定配对'
};

export function pairHasWarning(pair: PairPlan): boolean {
  return pair.warnings.some((warning) => warning.severity === 'warning' || warning.severity === 'error');
}

export function hasActiveConversion(pair: PairPlan): boolean {
  return Boolean(pair.audioConversion && !pair.audioConversion.skipReason);
}

export function pairNeedsWork(pair: PairPlan): boolean {
  if (pair.audioRenameNeeded) return true;
  if (pair.subtitleConvert) return true;
  if (pair.subtitle && pair.subtitleRenameName && pair.subtitleRenameName !== pair.subtitle.name) return true;
  if (hasActiveConversion(pair)) return true;
  if (pair.lrcWillOverwrite) return true;
  return pair.warnings.length > 0;
}

export function hasAnyChanges(pair: PairPlan): boolean {
  return (
    pair.audioRenameNeeded ||
    Boolean(pair.subtitleConvert) ||
    hasActiveConversion(pair) ||
    Boolean(pair.subtitleRenameName && pair.subtitle && pair.subtitleRenameName !== pair.subtitle.name)
  );
}

export interface PlanCounts {
  audioRenames: number;
  subtitleRenames: number;
  subtitleConversions: number;
  audioConversions: number;
  covers: number;
  renames: number;
  pending: number;
  warned: number;
}

export function countPlan(plan: PlanResult | null): PlanCounts {
  const counts: PlanCounts = {
    audioRenames: 0,
    subtitleRenames: 0,
    subtitleConversions: 0,
    audioConversions: 0,
    covers: 0,
    renames: 0,
    pending: 0,
    warned: 0
  };
  if (!plan) return counts;
  for (const folder of plan.folders) {
    for (const pair of folder.pairs) {
      if (pair.audioRenameNeeded) counts.audioRenames += 1;
      if (pair.subtitle && pair.subtitleRenameName && pair.subtitleRenameName !== pair.subtitle.name) {
        counts.subtitleRenames += 1;
      }
      if (pair.subtitleConvert) counts.subtitleConversions += 1;
      if (hasActiveConversion(pair)) counts.audioConversions += 1;
      if (pairHasWarning(pair) || hasAnyChanges(pair)) counts.pending += 1;
      if (pairHasWarning(pair)) counts.warned += 1;
    }
    if (folder.cover && folder.cover.action !== 'none') counts.covers += 1;
  }
  counts.renames = counts.audioRenames + counts.subtitleRenames;
  return counts;
}

export function selectionMatches(selection: SelectionState, pair: PairPlan): boolean {
  if (selection.renameAudio && pair.audioRenameNeeded) return true;
  if (selection.subtitle && pair.subtitleConvert) return true;
  if (selection.subtitle && pair.subtitleRenameName && pair.subtitle && pair.subtitleRenameName !== pair.subtitle.name) {
    return true;
  }
  if (selection.convertAudio && hasActiveConversion(pair)) return true;
  return false;
}

export interface SelectedBreakdown {
  renames: number;
  subtitleConversions: number;
  audioConversions: number;
  covers: number;
  total: number;
}

export function selectedOperations(plan: PlanResult | null, selection: SelectionState): SelectedBreakdown {
  const counts = countPlan(plan);
  const renames =
    (selection.renameAudio ? counts.audioRenames : 0) + (selection.subtitle ? counts.subtitleRenames : 0);
  const subtitleConversions = selection.subtitle ? counts.subtitleConversions : 0;
  const audioConversions = selection.convertAudio ? counts.audioConversions : 0;
  const covers = selection.cover ? counts.covers : 0;
  return {
    renames,
    subtitleConversions,
    audioConversions,
    covers,
    total: renames + subtitleConversions + audioConversions + covers
  };
}

export function countSelectedOperations(plan: PlanResult | null, selection: SelectionState): number {
  return selectedOperations(plan, selection).total;
}

export function toApplySelection(selection: SelectionState): ApplySelection {
  return {
    pairIds: null,
    coverFolders: null,
    renameAudio: selection.renameAudio,
    renameSubtitle: selection.subtitle,
    convertSubtitles: selection.subtitle,
    convertAudio: selection.convertAudio,
    applyCovers: selection.cover
  };
}

function matchesQuery(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

function pairMatchesQuery(pair: PairPlan, query: string): boolean {
  if (!query) return true;
  const haystack = [
    pair.audio.name,
    pair.renamedAudioName,
    pair.targetBase,
    pair.subtitle ? pair.subtitle.name : '',
    pair.subtitleOutputName || '',
    pair.subtitleRenameName || '',
    MATCH_LABELS[pair.match]
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function filterFolderPairs(folder: FolderPlan, mode: FilterMode, query: string): PairPlan[] {
  return folder.pairs.filter((pair) => {
    if (mode === 'pending' && !hasAnyChanges(pair) && pair.warnings.length === 0) return false;
    if (mode === 'warn' && !pairHasWarning(pair)) return false;
    return pairMatchesQuery(pair, query);
  });
}

export function folderMatchesQuery(folder: FolderPlan, query: string): boolean {
  if (!query) return true;
  return (
    matchesQuery(folder.folderName, query) ||
    matchesQuery(folder.relativePath, query) ||
    folder.pairs.some((pair) => pairMatchesQuery(pair, query))
  );
}

export interface FilteredFolder {
  folder: FolderPlan;
  pairs: PairPlan[];
}

export function filterFolders(folders: FolderPlan[], mode: FilterMode, query: string): FilteredFolder[] {
  const normalizedQuery = query.trim().toLowerCase();
  const result: FilteredFolder[] = [];
  for (const folder of folders) {
    const pairs = filterFolderPairs(folder, mode, normalizedQuery);
    const folderNameMatch = normalizedQuery && folderMatchesQuery(folder, normalizedQuery);
    if (pairs.length > 0 || (folderNameMatch && mode === 'all' && query.trim())) {
      result.push({ folder, pairs });
    }
  }
  return result;
}

export function collectWarnings(folders: FolderPlan[]): { folder: string; warning: PlanWarning }[] {
  const list: { folder: string; warning: PlanWarning }[] = [];
  for (const folder of folders) {
    for (const pair of folder.pairs) {
      for (const warning of pair.warnings) {
        if (warning.severity === 'warning' || warning.severity === 'error') {
          list.push({ folder: folder.folderName, warning });
        }
      }
    }
    for (const warning of folder.warnings) {
      if (warning.severity === 'warning' || warning.severity === 'error') {
        list.push({ folder: folder.folderName, warning });
      }
    }
  }
  return list;
}

export function planTotalOperations(plan: PlanResult | null): number {
  const counts = countPlan(plan);
  return counts.renames + counts.subtitleConversions + counts.audioConversions + counts.covers;
}
