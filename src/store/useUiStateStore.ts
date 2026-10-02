import { format, subDays } from 'date-fns';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { HeatmapViewMode } from '@/types';

type SettingsTab = 'import' | 'appearance' | 'athlete';
type DashboardMode = 'year' | 'month';
type DashboardBarMetric = 'durationHours' | 'distanceKm' | 'activities';
type HeatmapTimeSpan = 'all' | '30d' | '90d' | '365d' | 'custom';
type NavSection = 'dashboard' | 'activities' | 'heatmap' | 'analytics' | 'settings';
type AnalyticsTab = 'configure' | 'view';

interface UiState {
  settingsActiveTab: SettingsTab;
  dashboardMode: DashboardMode;
  dashboardSelectedYear: number;
  dashboardSelectedMonthIndex: number;
  dashboardBarMetric: DashboardBarMetric;
  activitiesCategory: string;
  activitiesMinDistanceKm: string;
  activitiesMaxDistanceKm: string;
  activitiesSorting: Array<{ id: string; desc: boolean }>;
  lastSectionRoutes: Record<NavSection, string>;
  heatmapTimeSpan: HeatmapTimeSpan;
  heatmapCustomStartDate: string;
  heatmapCustomEndDate: string;
  heatmapCategory: string;
  heatmapSportType: string;
  heatmapReducedMapComplexity: boolean;
  heatmapViewMode: HeatmapViewMode;
  analyticsActiveTab: AnalyticsTab;
  setSettingsActiveTab: (tab: SettingsTab) => void;
  setDashboardMode: (mode: DashboardMode) => void;
  setDashboardSelectedYear: (year: number) => void;
  setDashboardSelectedMonthIndex: (monthIndex: number) => void;
  setDashboardBarMetric: (metric: DashboardBarMetric) => void;
  setActivitiesCategory: (category: string) => void;
  setActivitiesMinDistanceKm: (value: string) => void;
  setActivitiesMaxDistanceKm: (value: string) => void;
  setActivitiesSorting: (sorting: Array<{ id: string; desc: boolean }>) => void;
  setLastSectionRoute: (section: NavSection, path: string) => void;
  setHeatmapTimeSpan: (span: HeatmapTimeSpan) => void;
  setHeatmapCustomStartDate: (date: string) => void;
  setHeatmapCustomEndDate: (date: string) => void;
  setHeatmapCategory: (category: string) => void;
  setHeatmapSportType: (sportType: string) => void;
  setHeatmapReducedMapComplexity: (checked: boolean) => void;
  setHeatmapViewMode: (mode: HeatmapViewMode) => void;
  setAnalyticsActiveTab: (tab: AnalyticsTab) => void;
}

const today = new Date();

export const useUiStateStore = create<UiState>()(
  persist(
    (set) => ({
      settingsActiveTab: 'import',
      dashboardMode: 'year',
      dashboardSelectedYear: today.getFullYear(),
      dashboardSelectedMonthIndex: today.getMonth(),
      dashboardBarMetric: 'durationHours',
      activitiesCategory: '',
      activitiesMinDistanceKm: '',
      activitiesMaxDistanceKm: '',
      activitiesSorting: [{ id: 'activityStart', desc: true }],
      lastSectionRoutes: {
        dashboard: '/',
        activities: '/activities',
        heatmap: '/heatmap',
        analytics: '/analytics',
        settings: '/settings'
      },
      heatmapTimeSpan: 'all',
      heatmapCustomStartDate: format(subDays(today, 30), 'yyyy-MM-dd'),
      heatmapCustomEndDate: format(today, 'yyyy-MM-dd'),
      heatmapCategory: '',
      heatmapSportType: '',
      heatmapReducedMapComplexity: false,
      heatmapViewMode: 'routes',
      analyticsActiveTab: 'view',
      setSettingsActiveTab: (tab) => set({ settingsActiveTab: tab }),
      setDashboardMode: (mode) => set({ dashboardMode: mode }),
      setDashboardSelectedYear: (year) => set({ dashboardSelectedYear: year }),
      setDashboardSelectedMonthIndex: (monthIndex) =>
        set({ dashboardSelectedMonthIndex: Math.min(11, Math.max(0, monthIndex)) }),
      setDashboardBarMetric: (metric) => set({ dashboardBarMetric: metric }),
      setActivitiesCategory: (category) => set({ activitiesCategory: category }),
      setActivitiesMinDistanceKm: (value) => set({ activitiesMinDistanceKm: value }),
      setActivitiesMaxDistanceKm: (value) => set({ activitiesMaxDistanceKm: value }),
      setActivitiesSorting: (sorting) => set({ activitiesSorting: sorting }),
      setLastSectionRoute: (section, path) =>
        set((state) => ({
          lastSectionRoutes: {
            ...state.lastSectionRoutes,
            [section]: path
          }
        })),
      setHeatmapTimeSpan: (span) => set({ heatmapTimeSpan: span }),
      setHeatmapCustomStartDate: (date) => set({ heatmapCustomStartDate: date }),
      setHeatmapCustomEndDate: (date) => set({ heatmapCustomEndDate: date }),
      setHeatmapCategory: (category) => set({ heatmapCategory: category }),
      setHeatmapSportType: (sportType) => set({ heatmapSportType: sportType }),
      setHeatmapReducedMapComplexity: (checked) => set({ heatmapReducedMapComplexity: checked }),
      setHeatmapViewMode: (mode) => set({ heatmapViewMode: mode }),
      setAnalyticsActiveTab: (tab) => set({ analyticsActiveTab: tab })
    }),
    {
      name: 'trajectory-ui-state',
      partialize: (state) => ({
        settingsActiveTab: state.settingsActiveTab,
        dashboardMode: state.dashboardMode,
        dashboardSelectedYear: state.dashboardSelectedYear,
        dashboardSelectedMonthIndex: state.dashboardSelectedMonthIndex,
        dashboardBarMetric: state.dashboardBarMetric,
        activitiesCategory: state.activitiesCategory,
        activitiesMinDistanceKm: state.activitiesMinDistanceKm,
        activitiesMaxDistanceKm: state.activitiesMaxDistanceKm,
        activitiesSorting: state.activitiesSorting,
        lastSectionRoutes: state.lastSectionRoutes,
        heatmapTimeSpan: state.heatmapTimeSpan,
        heatmapCustomStartDate: state.heatmapCustomStartDate,
        heatmapCustomEndDate: state.heatmapCustomEndDate,
        heatmapCategory: state.heatmapCategory,
        heatmapSportType: state.heatmapSportType,
        heatmapReducedMapComplexity: state.heatmapReducedMapComplexity,
        heatmapViewMode: state.heatmapViewMode,
        analyticsActiveTab: state.analyticsActiveTab
      })
    }
  )
);
