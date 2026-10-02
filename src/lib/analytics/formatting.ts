import { formatDuration } from '@/lib/format';
import type {
  AdvancedAnalyticsBaseMeasure,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsMetricResult
} from '@/types';

export function formatAnalyticsValue(value: number | null | undefined, unit?: string | null): string {
  if (value == null || !Number.isFinite(value)) {
    return 'n/a';
  }

  const normalizedUnit = (unit ?? '').trim().toLowerCase();
  if (normalizedUnit === 's' || normalizedUnit === 'sec' || normalizedUnit === 'seconds') {
    return formatSeconds(value);
  }

  if (normalizedUnit === '%') {
    return `${value.toFixed(1)}%`;
  }

  if (normalizedUnit === 'count') {
    return Math.round(value).toLocaleString();
  }

  if (normalizedUnit) {
    return `${value.toFixed(1)} ${unit}`;
  }

  return value.toFixed(2);
}

export function metricPreviewGranularity(metric: AdvancedAnalyticsMetricDefinition) {
  return metric.base?.defaultChartGranularity ?? 'week';
}

export function metricResultUnit(
  metric: AdvancedAnalyticsMetricDefinition | undefined,
  result: AdvancedAnalyticsMetricResult | undefined
) {
  const resolvedResultUnit = normalizedResolvedUnit(result?.unit);
  if (resolvedResultUnit) {
    return resolvedResultUnit;
  }

  const configuredDisplayUnit = normalizedResolvedUnit(metric?.base?.displayUnit ?? metric?.formula?.displayUnit);
  if (configuredDisplayUnit) {
    return configuredDisplayUnit;
  }

  if (metric?.kind === 'base') {
    return defaultUnitForBaseMeasure(metric.base?.measure);
  }

  return null;
}

function formatSeconds(seconds: number): string {
  return formatDuration(seconds);
}

function normalizedResolvedUnit(unit?: string | null): string | null {
  const trimmed = (unit ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') {
    return null;
  }
  return trimmed;
}

function defaultUnitForBaseMeasure(measure?: AdvancedAnalyticsBaseMeasure): string | null {
  if (!measure) {
    return null;
  }

  switch (measure) {
    case 'activitiesCount':
    case 'activeDaysCount':
      return 'count';
    case 'distanceSum':
    case 'elevationGainSum':
      return 'm';
    case 'durationSum':
    case 'movingTimeSum':
    case 'sampleTime':
      return 's';
    default:
      return null;
  }
}
