import { useMemo } from 'react';
import type { TooltipProps } from 'recharts';

import {
  ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS,
  normalizeAdvancedAnalyticsTimeRange
} from '@/lib/analytics/timeRange';
import {
  CHART_TOOLTIP_STYLE,
  isValueInDomain,
  parseStringChartLabel,
  usePlotDragZoom
} from '@/lib/charts/plottingEngine';
import { formatDuration } from '@/lib/format';
import type {
  AdvancedAnalyticsStreakDefinition,
  AdvancedAnalyticsStreakResult,
  AdvancedAnalyticsTimeRangeConfig
} from '@/types';

export const CHART_COLORS = ['#2563eb', '#dc2626', '#10b981', '#f59e0b', '#7c3aed'];
export const SAMPLE_TIME_PREVIEW_PAGE_SIZE = 6;
export type ChartRow = { key: string; label: string } & Record<string, string | number | null>;
const compareBucketKeys = (left: string, right: string) => left.localeCompare(right);
const timeRangeLabelByPreset = new Map(
  ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS.map((option) => [option.value, option.label])
);

export function timeRangeIndicator(range: AdvancedAnalyticsTimeRangeConfig | undefined): string {
  const normalized = normalizeAdvancedAnalyticsTimeRange(range);
  if (normalized.preset === 'custom') {
    if (normalized.customStartDate && normalized.customEndDate) {
      return `${normalized.customStartDate} -> ${normalized.customEndDate}`;
    }
    if (normalized.customStartDate) {
      return `from ${normalized.customStartDate}`;
    }
    if (normalized.customEndDate) {
      return `until ${normalized.customEndDate}`;
    }
    return 'custom';
  }
  return timeRangeLabelByPreset.get(normalized.preset) ?? normalized.preset;
}

export function trimOuterEmptyBuckets<T>(rows: T[], hasData: (row: T) => boolean): T[] {
  let first = -1;
  let last = -1;

  for (let index = 0; index < rows.length; index += 1) {
    if (!hasData(rows[index])) {
      continue;
    }
    if (first === -1) {
      first = index;
    }
    last = index;
  }

  if (first === -1 || last === -1) {
    return rows;
  }

  return rows.slice(first, last + 1);
}

export function useZoomableRows<T extends { key: string }>(rows: T[]) {
  const keyValues = useMemo(() => rows.map((row) => row.key), [rows]);
  const plotZoom = usePlotDragZoom<string>({
    parseLabel: parseStringChartLabel,
    compareValues: compareBucketKeys,
    values: keyValues
  });
  const activeZoomDomain = plotZoom.zoomDomain;
  const visibleRows = useMemo(
    () =>
      activeZoomDomain
        ? rows.filter((row) => isValueInDomain(row.key, activeZoomDomain, compareBucketKeys))
        : rows,
    [activeZoomDomain, rows]
  );

  return {
    visibleRows,
    selectionDomain: plotZoom.selectionDomain,
    isZoomed: plotZoom.isZoomed,
    onMouseDown: plotZoom.onMouseDown,
    onMouseMove: plotZoom.onMouseMove,
    onMouseUp: plotZoom.onMouseUp,
    onMouseLeave: plotZoom.onMouseLeave
  };
}

export function NoticeList({
  title,
  items,
  tone = 'muted'
}: {
  title: string;
  items: string[];
  tone?: 'muted' | 'error';
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        tone === 'error'
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border bg-bg/40 text-muted'
      }`}
    >
      <p className="mb-1 text-xs uppercase tracking-[0.12em]">{title}</p>
      <ul className="list-disc space-y-1 pl-4">
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function formatTooltipNumber(value: number) {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatDateBucketLabel(label: unknown): string {
  if (typeof label !== 'string') {
    return String(label ?? '');
  }

  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (dayMatch) {
    return `${dayMatch[3]}.${dayMatch[2]}.${dayMatch[1]}`;
  }

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(label);
  if (monthMatch) {
    return `01.${monthMatch[2]}.${monthMatch[1]}`;
  }

  return label;
}

export function formatTooltipMetricValue(value: number, unit?: string): string {
  const normalizedUnit = (unit ?? '').trim().toLowerCase();
  if (normalizedUnit === 's' || normalizedUnit === 'sec' || normalizedUnit === 'seconds') {
    return formatDuration(value);
  }

  return formatTooltipNumber(value);
}

export function formatStreakValue(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (Math.abs(value) >= 1000 || Math.abs(value % 1) < 1e-9) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function periodGoalProgressPercent(
  operator: AdvancedAnalyticsStreakDefinition['thresholdOperator'],
  threshold: number,
  currentValue: number
): number {
  if (!Number.isFinite(threshold) || !Number.isFinite(currentValue)) {
    return 0;
  }

  const safeThreshold = Math.abs(threshold);
  if (safeThreshold < 1e-9) {
    return 0;
  }

  if (operator === 'greaterThan' || operator === 'greaterThanOrEqual') {
    return Math.max(0, Math.min(100, (currentValue / threshold) * 100));
  }

  if (operator === 'lessThan' || operator === 'lessThanOrEqual') {
    if (currentValue <= threshold) {
      return 100;
    }
    return Math.max(0, Math.min(100, (threshold / currentValue) * 100));
  }

  const diff = Math.abs(currentValue - threshold);
  return Math.max(0, Math.min(100, (1 - diff / safeThreshold) * 100));
}

export function streakStatusTone(status?: AdvancedAnalyticsStreakResult['status']): string {
  if (status === 'active') {
    return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/40';
  }
  if (status === 'pending') {
    return 'text-amber-600 bg-amber-500/10 border-amber-500/40';
  }
  if (status === 'broken') {
    return 'text-rose-600 bg-rose-500/10 border-rose-500/40';
  }
  return 'text-muted bg-bg/60 border-border';
}

export function streakCurrentCardTone(status?: AdvancedAnalyticsStreakResult['status']): string {
  if (status === 'active') {
    return 'border-emerald-500/30 bg-emerald-500/10';
  }
  if (status === 'pending') {
    return 'border-amber-500/30 bg-amber-500/10';
  }
  if (status === 'broken') {
    return 'border-rose-500/30 bg-rose-500/10';
  }
  return 'border-border bg-bg/30';
}

export function AnalyticsChartTooltip({
  active,
  label,
  payload,
  unitsByKey
}: TooltipProps<number, string> & { unitsByKey?: Record<string, string> }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const firstPayload = payload[0] as { payload?: { label?: unknown } };
  const rawLabel = firstPayload?.payload?.label ?? label;
  const labelText = formatDateBucketLabel(rawLabel);

  return (
    <div style={CHART_TOOLTIP_STYLE} className="min-w-[13rem] p-3 text-sm leading-tight">
      <p className="font-semibold text-foreground">{labelText}</p>
      <div className="mt-2 space-y-1 text-foreground">
        {payload.map((entry) => {
          const seriesKey = String(entry.dataKey ?? '');
          const numericValue = typeof entry.value === 'number' ? entry.value : Number(entry.value);
          const valueLabel = Number.isFinite(numericValue)
            ? formatTooltipMetricValue(numericValue, unitsByKey?.[seriesKey])
            : String(entry.value ?? 'n/a');
          const unit = unitsByKey?.[seriesKey];
          const normalizedUnit = (unit ?? '').trim().toLowerCase();
          const renderUnit =
            Boolean(unit) &&
            normalizedUnit !== 's' &&
            normalizedUnit !== 'sec' &&
            normalizedUnit !== 'seconds';

          return (
            <p key={`${seriesKey}-${entry.name ?? 'value'}`}>
              <span className="font-medium">{entry.name ?? seriesKey}</span>:{' '}
              <span className="font-semibold">{valueLabel}</span>
              {renderUnit ? ` ${unit}` : ''}
            </p>
          );
        })}
      </div>
    </div>
  );
}
