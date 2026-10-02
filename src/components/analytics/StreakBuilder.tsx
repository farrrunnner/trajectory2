import { useEffect, useState } from 'react';

import type {
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsStreakDefinition
} from '@/types';

interface StreakBuilderProps {
  streak: AdvancedAnalyticsStreakDefinition;
  metrics: AdvancedAnalyticsMetricDefinition[];
  onChange: (streak: AdvancedAnalyticsStreakDefinition) => void;
  onDelete: () => void;
}

export function StreakBuilder({ streak, metrics, onChange, onDelete }: StreakBuilderProps) {
  const [thresholdInput, setThresholdInput] = useState(String(streak.thresholdValue));
  const topGridClassName = 'grid gap-x-3 gap-y-3 md:grid-cols-2';
  const topFieldRowClassName = 'grid min-h-7 grid-cols-[max-content_minmax(0,1fr)] items-center gap-2';
  const topFieldLabelClassName = 'text-sm text-muted whitespace-nowrap';
  const topControlClassName = 'h-7 w-full rounded-md border border-border bg-bg px-2 text-sm';

  useEffect(() => {
    setThresholdInput(String(streak.thresholdValue));
  }, [streak.id]);

  const selectedMetricIds = [
    streak.metricId,
    ...(streak.additionalMetricIds ?? []).filter((metricId) => metricId && metricId !== streak.metricId)
  ].filter((metricId, index, all) => metricId && all.indexOf(metricId) === index);
  const selectedMetricIdSet = new Set(selectedMetricIds);

  const commitSelectedMetrics = (ids: string[], preferredPrimaryId?: string) => {
    const ordered = metrics
      .map((metric) => metric.id)
      .filter((metricId) => ids.includes(metricId));
    const nextPrimaryId =
      (preferredPrimaryId && ordered.includes(preferredPrimaryId) && preferredPrimaryId) ||
      ordered[0] ||
      '';
    const nextAdditionalIds = ordered.filter((metricId) => metricId !== nextPrimaryId);
    onChange({ ...streak, metricId: nextPrimaryId, additionalMetricIds: nextAdditionalIds });
  };

  const toggleRequiredMetric = (metricId: string, checked: boolean) => {
    if (checked) {
      const nextIds = selectedMetricIdSet.has(metricId) ? selectedMetricIds : [...selectedMetricIds, metricId];
      commitSelectedMetrics(nextIds, streak.metricId || metricId);
      return;
    }
    const nextIds = selectedMetricIds.filter((id) => id !== metricId);
    const preferredPrimary = streak.metricId === metricId ? nextIds[0] : streak.metricId;
    commitSelectedMetrics(nextIds, preferredPrimary);
  };

  const updateThresholdInput = (raw: string) => {
    setThresholdInput(raw);
    if (raw.trim() === '') {
      return;
    }

    const nextValue = Number(raw);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    onChange({ ...streak, thresholdValue: nextValue });
  };

  const commitThresholdInput = () => {
    const trimmed = thresholdInput.trim();
    const nextValue = trimmed.length === 0 ? 0 : Number(trimmed);
    const normalizedValue = Number.isFinite(nextValue) ? nextValue : 0;
    setThresholdInput(String(normalizedValue));
    onChange({ ...streak, thresholdValue: normalizedValue });
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Streak Builder</h3>
          <p className="text-sm text-muted">
            Consecutive daily or weekly periods where one or more required metrics meet a threshold.
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-border px-2 py-1 text-xs text-muted"
        >
          Delete
        </button>
      </div>

      <div className={topGridClassName}>
        <label className={`${topFieldRowClassName} md:col-span-2`}>
          <span className={topFieldLabelClassName}>Name</span>
          <input
            value={streak.name}
            onChange={(event) => onChange({ ...streak, name: event.target.value })}
            className={topControlClassName}
          />
        </label>
        <label className={topFieldRowClassName}>
          <span className={topFieldLabelClassName}>Period</span>
          <select
            value={streak.period}
            onChange={(event) => onChange({ ...streak, period: event.target.value as 'day' | 'week' })}
            className={topControlClassName}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
          </select>
        </label>
        <label className={topFieldRowClassName}>
          <span className={topFieldLabelClassName}>Threshold operator</span>
          <select
            value={streak.thresholdOperator}
            onChange={(event) =>
              onChange({
                ...streak,
                thresholdOperator: event.target.value as
                  | 'greaterThan'
                  | 'greaterThanOrEqual'
                  | 'lessThan'
                  | 'lessThanOrEqual'
                  | 'equals'
              })
            }
            className={topControlClassName}
          >
            <option value="greaterThan">{'>'}</option>
            <option value="greaterThanOrEqual">{'>='}</option>
            <option value="lessThan">{'<'}</option>
            <option value="lessThanOrEqual">{'<='}</option>
            <option value="equals">=</option>
          </select>
        </label>
        <label className={topFieldRowClassName}>
          <span className={topFieldLabelClassName}>Threshold value</span>
          <input
            type="number"
            value={thresholdInput}
            onChange={(event) => updateThresholdInput(event.target.value)}
            onBlur={commitThresholdInput}
            className={topControlClassName}
          />
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-border bg-bg/30 p-3 text-sm">
        <p className="text-muted">Required metrics (AND)</p>
        {metrics.length === 0 ? (
          <p className="text-xs text-muted">Add metrics first to configure this streak.</p>
        ) : (
          <div className="space-y-2">
            {metrics.map((metric) => {
              const isRequired = selectedMetricIdSet.has(metric.id);
              return (
                <div
                  key={metric.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isRequired}
                      onChange={(event) => toggleRequiredMetric(metric.id, event.target.checked)}
                    />
                    <span className="text-foreground">{metric.name || 'Untitled metric'}</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted">
          Select one or more required metrics. Every selected metric must pass the same threshold each period.
        </p>
      </div>
    </section>
  );
}
