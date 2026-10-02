import { format, startOfMonth, startOfWeek, startOfYear, subDays } from 'date-fns';

import type { AdvancedAnalyticsTimeRangeConfig, AdvancedAnalyticsTimeRangePreset } from '@/types';

export interface NormalizedAdvancedAnalyticsTimeRange {
  preset: AdvancedAnalyticsTimeRangePreset;
  customStartDate: string;
  customEndDate: string;
}

export const ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS: Array<{
  value: AdvancedAnalyticsTimeRangePreset;
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '365d', label: '365d' },
  { value: 'thisWeek', label: 'This week' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'ytd', label: 'YTD' },
  { value: 'custom', label: 'Custom' }
];

export function defaultAdvancedAnalyticsTimeRange(): NormalizedAdvancedAnalyticsTimeRange {
  const today = new Date();
  return {
    preset: '90d',
    customStartDate: format(subDays(today, 30), 'yyyy-MM-dd'),
    customEndDate: format(today, 'yyyy-MM-dd')
  };
}

export function normalizeAdvancedAnalyticsTimeRange(
  range: AdvancedAnalyticsTimeRangeConfig | undefined
): NormalizedAdvancedAnalyticsTimeRange {
  const fallback = defaultAdvancedAnalyticsTimeRange();
  return {
    preset: range?.preset ?? fallback.preset,
    customStartDate: range?.customStartDate ?? fallback.customStartDate,
    customEndDate: range?.customEndDate ?? fallback.customEndDate
  };
}

export function resolveAdvancedAnalyticsTimeRange(range: AdvancedAnalyticsTimeRangeConfig | undefined): {
  startDate: string | undefined;
  endDate: string | undefined;
} {
  const normalized = normalizeAdvancedAnalyticsTimeRange(range);
  const today = new Date();
  if (normalized.preset === 'all') {
    return { startDate: undefined, endDate: undefined };
  }
  if (normalized.preset === 'custom') {
    return {
      startDate: normalized.customStartDate || undefined,
      endDate: normalized.customEndDate || undefined
    };
  }
  if (normalized.preset === 'thisWeek') {
    return {
      startDate: format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      endDate: format(today, 'yyyy-MM-dd')
    };
  }
  if (normalized.preset === 'thisMonth') {
    return {
      startDate: format(startOfMonth(today), 'yyyy-MM-dd'),
      endDate: format(today, 'yyyy-MM-dd')
    };
  }
  if (normalized.preset === 'ytd') {
    return {
      startDate: format(startOfYear(today), 'yyyy-MM-dd'),
      endDate: format(today, 'yyyy-MM-dd')
    };
  }

  const days = normalized.preset === '7d' ? 6 : normalized.preset === '30d' ? 29 : normalized.preset === '90d' ? 89 : 364;
  return {
    startDate: format(subDays(today, days), 'yyyy-MM-dd'),
    endDate: format(today, 'yyyy-MM-dd')
  };
}
