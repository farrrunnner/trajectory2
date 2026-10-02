import {
  ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS,
  normalizeAdvancedAnalyticsTimeRange
} from '@/lib/analytics/timeRange';
import type { AdvancedAnalyticsTimeRangeConfig, AdvancedAnalyticsTimeRangePreset } from '@/types';

interface TimeRangeControlProps {
  value: AdvancedAnalyticsTimeRangeConfig | undefined;
  onChange: (next: AdvancedAnalyticsTimeRangeConfig) => void;
  compact?: boolean;
  label?: string;
  inlineLabel?: boolean;
  labelWidthClassName?: string;
  controlClassName?: string;
}

export function TimeRangeControl({
  value,
  onChange,
  compact = false,
  label = 'Time range',
  inlineLabel = false,
  labelWidthClassName,
  controlClassName
}: TimeRangeControlProps) {
  const normalized = normalizeAdvancedAnalyticsTimeRange(value);
  const showCustomDates = normalized.preset === 'custom';
  const wrapperClassName = compact
    ? showCustomDates
      ? 'grid gap-2 md:grid-cols-3'
      : 'grid gap-2 md:grid-cols-1'
    : showCustomDates
      ? 'grid gap-3 md:grid-cols-3'
      : 'grid gap-3 md:grid-cols-1';
  const inputClassName = compact
    ? 'w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs'
    : 'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm';
  const resolvedControlClassName = controlClassName ?? inputClassName;
  const labelClassName = compact ? 'space-y-1 text-xs' : 'space-y-1 text-sm';
  const inlineLabelClassName =
    labelWidthClassName ?? (compact ? 'w-28 shrink-0 text-xs text-muted' : 'w-40 shrink-0 text-sm text-muted');

  return (
    <div className={wrapperClassName}>
      {inlineLabel ? (
        <label className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
          <span className={inlineLabelClassName}>{label}</span>
          <select
            value={normalized.preset}
            onChange={(event) =>
              onChange({
                ...normalized,
                preset: event.target.value as AdvancedAnalyticsTimeRangePreset
              })
            }
            className={`${resolvedControlClassName} justify-self-start`}
          >
            {ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className={labelClassName}>
          <span className="text-muted">{label}</span>
          <select
            value={normalized.preset}
            onChange={(event) =>
              onChange({
                ...normalized,
                preset: event.target.value as AdvancedAnalyticsTimeRangePreset
              })
            }
            className={resolvedControlClassName}
          >
            {ADVANCED_ANALYTICS_TIME_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {showCustomDates ? (
        <>
          {inlineLabel ? (
            <label className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
              <span className={inlineLabelClassName}>Start</span>
              <input
                type="date"
                value={normalized.customStartDate}
                onChange={(event) => onChange({ ...normalized, customStartDate: event.target.value })}
                className={`${resolvedControlClassName} justify-self-start`}
              />
            </label>
          ) : (
            <label className={labelClassName}>
              <span className="text-muted">Start</span>
              <input
                type="date"
                value={normalized.customStartDate}
                onChange={(event) => onChange({ ...normalized, customStartDate: event.target.value })}
                className={resolvedControlClassName}
              />
            </label>
          )}

          {inlineLabel ? (
            <label className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-2">
              <span className={inlineLabelClassName}>End</span>
              <input
                type="date"
                value={normalized.customEndDate}
                onChange={(event) => onChange({ ...normalized, customEndDate: event.target.value })}
                className={`${resolvedControlClassName} justify-self-start`}
              />
            </label>
          ) : (
            <label className={labelClassName}>
              <span className="text-muted">End</span>
              <input
                type="date"
                value={normalized.customEndDate}
                onChange={(event) => onChange({ ...normalized, customEndDate: event.target.value })}
                className={resolvedControlClassName}
              />
            </label>
          )}
        </>
      ) : null}
    </div>
  );
}
