import { create } from 'zustand';

import {
  getSettings,
  scanImportFolder,
  setAccentTheme,
  setChartMaxSamples,
  setChartOutlierRemoval,
  setDarkMode,
  setHeatmapFullOpacity,
  setHeartRateZoneUpperBoundsBpm,
  setImportFolder,
  onScanProgress
} from '@/lib/tauri';
import type { AccentThemeId } from '@/lib/theme';
import type {
  ActivitySummary,
  AdvancedAnalyticsRunResponse,
  ScanDoneEvent,
  ScanProgressEvent,
  Settings
} from '@/types';

interface AppState {
  settings: Settings | null;
  loadingSettings: boolean;
  scanning: boolean;
  scanProgress: ScanProgressEvent | null;
  scanDone: ScanDoneEvent | null;
  activitiesCache: Record<string, ActivitySummary[]>;
  advancedAnalyticsCache: Record<string, AdvancedAnalyticsRunResponse>;
  init: () => Promise<void>;
  updateImportFolder: (path: string, recursive: boolean) => Promise<void>;
  setScanRecursive: (recursive: boolean) => Promise<void>;
  updateDarkMode: (darkMode: boolean) => Promise<void>;
  updateAccentTheme: (accentTheme: AccentThemeId) => Promise<void>;
  updateHeatmapFullOpacity: (heatmapFullOpacity: boolean) => Promise<void>;
  updateChartMaxSamples: (chartMaxSamples: number) => Promise<void>;
  updateChartOutlierRemoval: (chartOutlierRemoval: boolean) => Promise<void>;
  updateHeartRateZoneUpperBoundsBpm: (upperBoundsBpm: number[]) => Promise<void>;
  runScan: (fullRescan?: boolean) => Promise<void>;
  getCachedActivities: (cacheKey: string) => ActivitySummary[] | null;
  setCachedActivities: (cacheKey: string, activities: ActivitySummary[]) => void;
  clearActivitiesCache: () => void;
  getCachedAdvancedAnalytics: (cacheKey: string) => AdvancedAnalyticsRunResponse | null;
  setCachedAdvancedAnalytics: (cacheKey: string, response: AdvancedAnalyticsRunResponse) => void;
  clearAdvancedAnalyticsCache: () => void;
}

let listenersInitialized = false;

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  loadingSettings: true,
  scanning: false,
  scanProgress: null,
  scanDone: null,
  activitiesCache: {},
  advancedAnalyticsCache: {},
  init: async () => {
    if (!listenersInitialized) {
      listenersInitialized = true;
      void onScanProgress((progress) => {
        set({ scanProgress: progress, scanning: true });
      });
    }

    set({ loadingSettings: true });
    const settings = await getSettings();
    set({ settings, loadingSettings: false });
  },
  updateImportFolder: async (path, recursive) => {
    const settings = await setImportFolder(path, recursive);
    set({ settings, scanDone: null, activitiesCache: {}, advancedAnalyticsCache: {} });
  },
  setScanRecursive: async (recursive) => {
    const current = get().settings;
    if (!current?.importFolderPath) {
      return;
    }

    const settings = await setImportFolder(current.importFolderPath, recursive);
    set({ settings, scanDone: null, activitiesCache: {}, advancedAnalyticsCache: {} });
  },
  updateDarkMode: async (darkMode) => {
    const settings = await setDarkMode(darkMode);
    set({ settings });
  },
  updateAccentTheme: async (accentTheme) => {
    const settings = await setAccentTheme(accentTheme);
    set({ settings });
  },
  updateHeatmapFullOpacity: async (heatmapFullOpacity) => {
    const settings = await setHeatmapFullOpacity(heatmapFullOpacity);
    set({ settings });
  },
  updateChartMaxSamples: async (chartMaxSamples) => {
    const settings = await setChartMaxSamples(chartMaxSamples);
    set({ settings });
  },
  updateChartOutlierRemoval: async (chartOutlierRemoval) => {
    const settings = await setChartOutlierRemoval(chartOutlierRemoval);
    set({ settings });
  },
  updateHeartRateZoneUpperBoundsBpm: async (upperBoundsBpm) => {
    const settings = await setHeartRateZoneUpperBoundsBpm(upperBoundsBpm);
    set({ settings, advancedAnalyticsCache: {} });
  },
  runScan: async (fullRescan = false) => {
    set({ scanning: true, scanDone: null });
    try {
      const done = await scanImportFolder(fullRescan);
      const settings = await getSettings();
      set({
        scanDone: done,
        scanning: false,
        scanProgress: null,
        settings,
        activitiesCache: {},
        advancedAnalyticsCache: {}
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        scanning: false,
        scanProgress: null,
        scanDone: { added: 0, updated: 0, skipped: 0, errors: [message] }
      });
      throw error;
    }
  },
  getCachedActivities: (cacheKey) => get().activitiesCache[cacheKey] ?? null,
  setCachedActivities: (cacheKey, activities) =>
    set((state) => ({
      activitiesCache: {
        ...state.activitiesCache,
        [cacheKey]: activities
      }
    })),
  clearActivitiesCache: () => set({ activitiesCache: {} }),
  getCachedAdvancedAnalytics: (cacheKey) => get().advancedAnalyticsCache[cacheKey] ?? null,
  setCachedAdvancedAnalytics: (cacheKey, response) =>
    set((state) => ({
      advancedAnalyticsCache: {
        ...state.advancedAnalyticsCache,
        [cacheKey]: response
      }
    })),
  clearAdvancedAnalyticsCache: () => set({ advancedAnalyticsCache: {} })
}));
