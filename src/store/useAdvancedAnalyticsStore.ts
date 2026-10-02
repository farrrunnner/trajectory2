import { format, subDays } from 'date-fns';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { defaultAdvancedAnalyticsTimeRange } from '@/lib/analytics/timeRange';
import type {
  AdvancedAnalyticsActivityCondition,
  AdvancedAnalyticsActivityConditionGroup,
  AdvancedAnalyticsBaseMetricDefinition,
  AdvancedAnalyticsChartDefinition,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsSampleCondition,
  AdvancedAnalyticsSampleConditionGroup,
  AdvancedAnalyticsStreakDefinition,
  AdvancedAnalyticsTimeRangePreset
} from '@/types';
export type AdvancedAnalyticsSelection =
  | { kind: 'metric'; id: string }
  | { kind: 'streak'; id: string }
  | { kind: 'chart'; id: string }
  | null;

interface AdvancedAnalyticsState {
  schemaVersion: number;
  metrics: AdvancedAnalyticsMetricDefinition[];
  streaks: AdvancedAnalyticsStreakDefinition[];
  charts: AdvancedAnalyticsChartDefinition[];
  timeRangePreset: AdvancedAnalyticsTimeRangePreset;
  customStartDate: string;
  customEndDate: string;
  autoRun: boolean;
  selectedItem: AdvancedAnalyticsSelection;
  setTimeRangePreset: (preset: AdvancedAnalyticsTimeRangePreset) => void;
  setCustomStartDate: (value: string) => void;
  setCustomEndDate: (value: string) => void;
  setAutoRun: (value: boolean) => void;
  setSelectedItem: (selection: AdvancedAnalyticsSelection) => void;
  addMetric: (kind?: 'base' | 'formula') => void;
  updateMetric: (id: string, updater: (metric: AdvancedAnalyticsMetricDefinition) => AdvancedAnalyticsMetricDefinition) => void;
  removeMetric: (id: string) => void;
  moveMetric: (id: string, direction: 'up' | 'down') => void;
  addStreak: () => void;
  updateStreak: (id: string, updater: (streak: AdvancedAnalyticsStreakDefinition) => AdvancedAnalyticsStreakDefinition) => void;
  removeStreak: (id: string) => void;
  moveStreak: (id: string, direction: 'up' | 'down') => void;
  addChart: () => void;
  updateChart: (id: string, updater: (chart: AdvancedAnalyticsChartDefinition) => AdvancedAnalyticsChartDefinition) => void;
  removeChart: (id: string) => void;
  moveChart: (id: string, direction: 'up' | 'down') => void;
  replaceDefinitions: (next: {
    metrics: AdvancedAnalyticsMetricDefinition[];
    streaks: AdvancedAnalyticsStreakDefinition[];
    charts: AdvancedAnalyticsChartDefinition[];
    autoRun?: boolean;
    selectedItem?: AdvancedAnalyticsSelection;
  }) => void;
}

const today = new Date();

const defaultBaseMetric = (): AdvancedAnalyticsBaseMetricDefinition => ({
  measure: 'activitiesCount',
  activityConditions: [],
  sampleConditions: [],
  activityConditionGroups: [],
  sampleConditionGroups: [],
  activityConditionJoin: 'and',
  sampleConditionJoin: 'and',
  minimumSampleMatchSeconds: 0,
  defaultChartGranularity: 'week',
  displayUnit: 'auto'
});

const newId = (prefix: string) =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}_${crypto.randomUUID().slice(0, 8)}`
    : `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const blankActivityCondition = (): AdvancedAnalyticsActivityCondition => ({
  id: newId('ac'),
  field: 'title',
  operator: 'contains',
  value: ''
});

const blankSampleCondition = (): AdvancedAnalyticsSampleCondition => ({
  id: newId('sc'),
  field: 'heartRateZone',
  operator: 'is',
  zone: 2
});

const blankActivityConditionGroup = (): AdvancedAnalyticsActivityConditionGroup => ({
  id: newId('ag'),
  conditions: [blankActivityCondition()]
});

const blankSampleConditionGroup = (): AdvancedAnalyticsSampleConditionGroup => ({
  id: newId('sg'),
  conditions: [blankSampleCondition()]
});

export const createBlankActivityCondition = blankActivityCondition;
export const createBlankSampleCondition = blankSampleCondition;
export const createBlankActivityConditionGroup = blankActivityConditionGroup;
export const createBlankSampleConditionGroup = blankSampleConditionGroup;

function resolveSelection(
  selection: AdvancedAnalyticsSelection,
  metrics: AdvancedAnalyticsMetricDefinition[],
  streaks: AdvancedAnalyticsStreakDefinition[],
  charts: AdvancedAnalyticsChartDefinition[]
): AdvancedAnalyticsSelection {
  if (selection?.kind === 'metric' && metrics.some((metric) => metric.id === selection.id)) {
    return selection;
  }
  if (selection?.kind === 'streak' && streaks.some((streak) => streak.id === selection.id)) {
    return selection;
  }
  if (selection?.kind === 'chart' && charts.some((chart) => chart.id === selection.id)) {
    return selection;
  }
  if (metrics[0]) {
    return { kind: 'metric', id: metrics[0].id };
  }
  if (streaks[0]) {
    return { kind: 'streak', id: streaks[0].id };
  }
  if (charts[0]) {
    return { kind: 'chart', id: charts[0].id };
  }
  return null;
}

export const useAdvancedAnalyticsStore = create<AdvancedAnalyticsState>()(
  persist(
    (set) => ({
      schemaVersion: 1,
      metrics: [],
      streaks: [],
      charts: [],
      timeRangePreset: '90d',
      customStartDate: format(subDays(today, 30), 'yyyy-MM-dd'),
      customEndDate: format(today, 'yyyy-MM-dd'),
      autoRun: true,
      selectedItem: null,
      setTimeRangePreset: (preset) => set({ timeRangePreset: preset }),
      setCustomStartDate: (value) => set({ customStartDate: value }),
      setCustomEndDate: (value) => set({ customEndDate: value }),
      setAutoRun: (value) => set({ autoRun: value }),
      setSelectedItem: (selection) => set({ selectedItem: selection }),
      addMetric: (kind = 'base') =>
        set((state) => {
          const metric: AdvancedAnalyticsMetricDefinition =
            kind === 'formula'
              ? {
                  id: newId('metric'),
                  name: `Formula Metric ${state.metrics.filter((m) => m.kind === 'formula').length + 1}`,
                  kind: 'formula',
                  showInView: true,
                  timeRange: defaultAdvancedAnalyticsTimeRange(),
                  formula: {
                    leftMetricId: state.metrics.find((m) => m.kind === 'base')?.id ?? '',
                    operator: 'divide',
                    rightMetricId: state.metrics.find((m) => m.kind === 'base')?.id ?? '',
                    displayUnit: 'auto'
                  }
                }
              : {
                  id: newId('metric'),
                  name: `Metric ${state.metrics.filter((m) => m.kind === 'base').length + 1}`,
                  kind: 'base',
                  showInView: true,
                  timeRange: defaultAdvancedAnalyticsTimeRange(),
                  base: defaultBaseMetric()
                };

          return {
            metrics: [...state.metrics, metric],
            selectedItem: { kind: 'metric', id: metric.id }
          };
        }),
      updateMetric: (id, updater) =>
        set((state) => ({
          metrics: state.metrics.map((metric) => (metric.id === id ? updater(metric) : metric))
        })),
      removeMetric: (id) =>
        set((state) => ({
          metrics: state.metrics.filter((metric) => metric.id !== id),
          streaks: state.streaks.map((streak) => ({
            ...streak,
            metricId: streak.metricId === id ? '' : streak.metricId,
            additionalMetricIds: (streak.additionalMetricIds ?? []).filter(
              (metricId) => metricId !== id
            )
          })),
          charts: state.charts.map((chart) => ({
            ...chart,
            metricIds: chart.metricIds.filter((metricId) => metricId !== id)
          })),
          selectedItem:
            state.selectedItem?.kind === 'metric' && state.selectedItem.id === id
              ? null
              : state.selectedItem
        })),
      moveMetric: (id, direction) =>
        set((state) => {
          const currentIndex = state.metrics.findIndex((metric) => metric.id === id);
          if (currentIndex < 0) {
            return { metrics: state.metrics };
          }

          const currentMetric = state.metrics[currentIndex];
          let swapIndex = -1;

          if (direction === 'up') {
            for (let index = currentIndex - 1; index >= 0; index -= 1) {
              if (state.metrics[index].kind === currentMetric.kind) {
                swapIndex = index;
                break;
              }
            }
          } else {
            for (let index = currentIndex + 1; index < state.metrics.length; index += 1) {
              if (state.metrics[index].kind === currentMetric.kind) {
                swapIndex = index;
                break;
              }
            }
          }

          if (swapIndex < 0) {
            return { metrics: state.metrics };
          }

          const nextMetrics = [...state.metrics];
          [nextMetrics[currentIndex], nextMetrics[swapIndex]] = [
            nextMetrics[swapIndex],
            nextMetrics[currentIndex]
          ];
          return { metrics: nextMetrics };
        }),
      addStreak: () =>
        set((state) => {
          const streak: AdvancedAnalyticsStreakDefinition = {
            id: newId('streak'),
            name: `Streak ${state.streaks.length + 1}`,
            timeRange: defaultAdvancedAnalyticsTimeRange(),
            metricId: state.metrics[0]?.id ?? '',
            additionalMetricIds: [],
            period: 'week',
            thresholdOperator: 'greaterThanOrEqual',
            thresholdValue: 60 * 60
          };
          return {
            streaks: [...state.streaks, streak],
            selectedItem: { kind: 'streak', id: streak.id }
          };
        }),
      updateStreak: (id, updater) =>
        set((state) => ({
          streaks: state.streaks.map((streak) => (streak.id === id ? updater(streak) : streak))
        })),
      removeStreak: (id) =>
        set((state) => ({
          streaks: state.streaks.filter((streak) => streak.id !== id),
          selectedItem:
            state.selectedItem?.kind === 'streak' && state.selectedItem.id === id
              ? null
              : state.selectedItem
        })),
      moveStreak: (id, direction) =>
        set((state) => {
          const currentIndex = state.streaks.findIndex((streak) => streak.id === id);
          if (currentIndex < 0) {
            return { streaks: state.streaks };
          }

          const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          if (swapIndex < 0 || swapIndex >= state.streaks.length) {
            return { streaks: state.streaks };
          }

          const nextStreaks = [...state.streaks];
          [nextStreaks[currentIndex], nextStreaks[swapIndex]] = [
            nextStreaks[swapIndex],
            nextStreaks[currentIndex]
          ];
          return { streaks: nextStreaks };
        }),
      addChart: () =>
        set((state) => {
          const defaultMetricIds = state.metrics.slice(0, 2).map((metric) => metric.id);
          const chart: AdvancedAnalyticsChartDefinition = {
            id: newId('chart'),
            name: `Chart ${state.charts.length + 1}`,
            timeRange: defaultAdvancedAnalyticsTimeRange(),
            chartType: defaultMetricIds.length >= 2 ? 'stackedBar' : 'bar',
            metricIds:
              defaultMetricIds.length >= 2 ? defaultMetricIds : defaultMetricIds.slice(0, 1),
            granularity: 'week'
          };
          return {
            charts: [...state.charts, chart],
            selectedItem: { kind: 'chart', id: chart.id }
          };
        }),
      updateChart: (id, updater) =>
        set((state) => ({
          charts: state.charts.map((chart) => (chart.id === id ? updater(chart) : chart))
        })),
      removeChart: (id) =>
        set((state) => ({
          charts: state.charts.filter((chart) => chart.id !== id),
          selectedItem:
            state.selectedItem?.kind === 'chart' && state.selectedItem.id === id
              ? null
              : state.selectedItem
        })),
      moveChart: (id, direction) =>
        set((state) => {
          const currentIndex = state.charts.findIndex((chart) => chart.id === id);
          if (currentIndex < 0) {
            return { charts: state.charts };
          }

          const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
          if (swapIndex < 0 || swapIndex >= state.charts.length) {
            return { charts: state.charts };
          }

          const nextCharts = [...state.charts];
          [nextCharts[currentIndex], nextCharts[swapIndex]] = [
            nextCharts[swapIndex],
            nextCharts[currentIndex]
          ];
          return { charts: nextCharts };
        }),
      replaceDefinitions: (next) =>
        set((state) => ({
          metrics: next.metrics,
          streaks: next.streaks,
          charts: next.charts,
          autoRun: next.autoRun ?? state.autoRun,
          selectedItem: resolveSelection(
            next.selectedItem ?? null,
            next.metrics,
            next.streaks,
            next.charts
          )
        }))
    }),
    {
      name: 'trajectory-advanced-analytics',
      partialize: (state) => ({
        schemaVersion: state.schemaVersion,
        metrics: state.metrics,
        streaks: state.streaks,
        charts: state.charts,
        timeRangePreset: state.timeRangePreset,
        customStartDate: state.customStartDate,
        customEndDate: state.customEndDate,
        autoRun: state.autoRun,
        selectedItem: state.selectedItem
      })
    }
  )
);
