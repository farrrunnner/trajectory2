import { useMemo, useState } from 'react';

import {
  resolveAdvancedAnalyticsTransferSelection,
  type AdvancedAnalyticsTransferData,
  type AdvancedAnalyticsTransferSelectionResult
} from '@/lib/analytics/transfer';

interface TransferSelectionPanelProps {
  mode: 'import' | 'export';
  sourceLabel: string;
  data: AdvancedAnalyticsTransferData;
  existingData?: Pick<AdvancedAnalyticsTransferData, 'metrics' | 'streaks' | 'charts'>;
  onCancel: () => void;
  onConfirm: (selection: AdvancedAnalyticsTransferSelectionResult) => void;
}

function toggleId(ids: string[], id: string, checked: boolean): string[] {
  if (checked) {
    return ids.includes(id) ? ids : [...ids, id];
  }
  return ids.filter((candidate) => candidate !== id);
}

export function TransferSelectionPanel({
  mode,
  sourceLabel,
  data,
  existingData,
  onCancel,
  onConfirm
}: TransferSelectionPanelProps) {
  const [manualMetricIds, setManualMetricIds] = useState<string[]>(() =>
    data.metrics.map((metric) => metric.id)
  );
  const [manualStreakIds, setManualStreakIds] = useState<string[]>(() =>
    data.streaks.map((streak) => streak.id)
  );
  const [manualChartIds, setManualChartIds] = useState<string[]>(() =>
    data.charts.map((chart) => chart.id)
  );

  const selection = useMemo(
    () =>
      resolveAdvancedAnalyticsTransferSelection({
        metrics: data.metrics,
        streaks: data.streaks,
        charts: data.charts,
        selectedMetricIds: manualMetricIds,
        selectedStreakIds: manualStreakIds,
        selectedChartIds: manualChartIds
      }),
    [data, manualChartIds, manualMetricIds, manualStreakIds]
  );

  const manualMetricSet = useMemo(() => new Set(manualMetricIds), [manualMetricIds]);
  const selectedMetricSet = useMemo(
    () => new Set(selection.selectedMetricIds),
    [selection.selectedMetricIds]
  );
  const selectedStreakSet = useMemo(
    () => new Set(selection.selectedStreakIds),
    [selection.selectedStreakIds]
  );
  const selectedChartSet = useMemo(() => new Set(selection.selectedChartIds), [selection.selectedChartIds]);

  const existingMetricIds = useMemo(
    () => new Set(existingData?.metrics.map((metric) => metric.id) ?? []),
    [existingData]
  );
  const existingStreakIds = useMemo(
    () => new Set(existingData?.streaks.map((streak) => streak.id) ?? []),
    [existingData]
  );
  const existingChartIds = useMemo(
    () => new Set(existingData?.charts.map((chart) => chart.id) ?? []),
    [existingData]
  );
  const replaceCounts = useMemo(
    () => ({
      metrics: selection.selectedMetricIds.filter((id) => existingMetricIds.has(id)).length,
      streaks: selection.selectedStreakIds.filter((id) => existingStreakIds.has(id)).length,
      charts: selection.selectedChartIds.filter((id) => existingChartIds.has(id)).length
    }),
    [existingChartIds, existingMetricIds, existingStreakIds, selection]
  );

  const totalSelected =
    selection.selectedMetricIds.length + selection.selectedStreakIds.length + selection.selectedChartIds.length;

  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {mode === 'import' ? 'Import Selection' : 'Export Selection'}
          </h3>
          <p className="text-sm text-muted">
            Source: <span className="font-medium text-foreground">{sourceLabel}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setManualMetricIds(data.metrics.map((metric) => metric.id));
              setManualStreakIds(data.streaks.map((streak) => streak.id));
              setManualChartIds(data.charts.map((chart) => chart.id));
            }}
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-foreground hover:border-accent"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => {
              setManualMetricIds([]);
              setManualStreakIds([]);
              setManualChartIds([]);
            }}
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-xs text-foreground hover:border-accent"
          >
            Clear all
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted">
        Metrics required by selected charts, streaks, or formula metrics are auto-included.
      </p>

      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        <section className="space-y-2 rounded-lg border border-border bg-bg/30 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Metrics ({selection.selectedMetricIds.length}/{data.metrics.length})
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setManualMetricIds(data.metrics.map((metric) => metric.id))}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setManualMetricIds([])}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {data.metrics.length === 0 ? <p className="text-xs text-muted">No metrics.</p> : null}
            {data.metrics.map((metric) => {
              const reasons = selection.requiredMetricReasonsById[metric.id] ?? [];
              const isSelected = selectedMetricSet.has(metric.id);
              const isManual = manualMetricSet.has(metric.id);
              const isDependencyOnly = isSelected && !isManual && reasons.length > 0;
              return (
                <label
                  key={metric.id}
                  className="block rounded-md border border-border/70 bg-bg px-2 py-1.5 text-sm"
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDependencyOnly}
                      onChange={(event) =>
                        setManualMetricIds((current) => toggleId(current, metric.id, event.target.checked))
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-foreground">{metric.name || 'Untitled metric'}</div>
                      <div className="text-xs text-muted">
                        {metric.kind === 'formula' ? 'Formula metric' : metric.base?.measure ?? 'Base metric'}
                      </div>
                      {reasons.length > 0 ? (
                        <p className="mt-1 text-xs text-muted">
                          Auto-included by: {reasons.join(', ')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-bg/30 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Streaks ({selection.selectedStreakIds.length}/{data.streaks.length})
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setManualStreakIds(data.streaks.map((streak) => streak.id))}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setManualStreakIds([])}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {data.streaks.length === 0 ? <p className="text-xs text-muted">No streaks.</p> : null}
            {data.streaks.map((streak) => (
              <label key={streak.id} className="block rounded-md border border-border/70 bg-bg px-2 py-1.5 text-sm">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedStreakSet.has(streak.id)}
                    onChange={(event) =>
                      setManualStreakIds((current) => toggleId(current, streak.id, event.target.checked))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">{streak.name || 'Untitled streak'}</div>
                    <div className="text-xs text-muted">
                      {streak.period} {streak.thresholdOperator} {streak.thresholdValue}
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-2 rounded-lg border border-border bg-bg/30 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">
              Charts ({selection.selectedChartIds.length}/{data.charts.length})
            </p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setManualChartIds(data.charts.map((chart) => chart.id))}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setManualChartIds([])}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted"
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {data.charts.length === 0 ? <p className="text-xs text-muted">No charts.</p> : null}
            {data.charts.map((chart) => (
              <label key={chart.id} className="block rounded-md border border-border/70 bg-bg px-2 py-1.5 text-sm">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedChartSet.has(chart.id)}
                    onChange={(event) =>
                      setManualChartIds((current) => toggleId(current, chart.id, event.target.checked))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground">{chart.name || 'Untitled chart'}</div>
                    <div className="text-xs text-muted">
                      {chart.chartType} • {chart.metricIds.length} metrics
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-3 rounded-md border border-border bg-bg/30 px-3 py-2 text-xs text-muted">
        Selected: {selection.selectedMetricIds.length} metrics, {selection.selectedStreakIds.length}{' '}
        streaks, {selection.selectedChartIds.length} charts.
        {selection.dependencyMetricIds.length > 0 ? (
          <span className="ml-1">
            ({selection.dependencyMetricIds.length} metrics are dependency-only auto selections)
          </span>
        ) : null}
        {mode === 'import' ? (
          <span className="ml-1">
            Existing IDs replaced: {replaceCounts.metrics} metrics, {replaceCounts.streaks} streaks,{' '}
            {replaceCounts.charts} charts.
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-4 py-2 text-sm font-medium text-muted hover:bg-bg/70"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={totalSelected === 0}
          onClick={() => onConfirm(selection)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mode === 'import' ? 'Import selected' : 'Export selected'}
        </button>
      </div>
    </section>
  );
}
