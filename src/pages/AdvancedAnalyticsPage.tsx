import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import { AnalyticsLibrary } from '@/components/analytics/AnalyticsLibrary';
import { TransferSelectionPanel } from '@/components/analytics/TransferSelectionPanel';
import { advancedAnalyticsDataVersion, advancedAnalyticsRequestCacheKey } from '@/lib/analytics/cacheKey';
import {
  buildAdvancedAnalyticsTransferFile,
  mergeAdvancedAnalyticsTransferData,
  type AdvancedAnalyticsTransferData,
  type AdvancedAnalyticsTransferSelectionResult,
  parseAdvancedAnalyticsTransferFile
} from '@/lib/analytics/transfer';
import { AnalyticsPreview } from '@/components/analytics/AnalyticsPreview';
import { ChartBuilder } from '@/components/analytics/ChartBuilder';
import { MetricBuilder } from '@/components/analytics/MetricBuilder';
import { StreakBuilder } from '@/components/analytics/StreakBuilder';
import { resolveAdvancedAnalyticsTimeRange } from '@/lib/analytics/timeRange';
import { validateAdvancedAnalyticsDefinitions } from '@/lib/analytics/validation';
import { exportAnalyticsJson, runAdvancedAnalytics } from '@/lib/tauri';
import { useAdvancedAnalyticsStore } from '@/store/useAdvancedAnalyticsStore';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';
import type {
  AdvancedAnalyticsChartResult,
  AdvancedAnalyticsMetricResult,
  AdvancedAnalyticsRunRequest,
  AdvancedAnalyticsRunResponse,
  AdvancedAnalyticsStreakResult,
  AdvancedAnalyticsTimeRangeConfig
} from '@/types';

interface RequestEntry {
  cacheKey: string;
  request: AdvancedAnalyticsRunRequest;
}

interface TransferSelectionSession {
  id: string;
  mode: 'import' | 'export';
  sourceLabel: string;
  data: AdvancedAnalyticsTransferData;
}

function AnalyticsLoadingBar({
  loadingProgress
}: {
  loadingProgress: { completed: number; total: number } | null;
}) {
  if (!loadingProgress || loadingProgress.total <= 0) {
    return (
      <section className="rounded-xl border border-border bg-panel p-3">
        <p className="text-xs text-muted">Recomputing analytics...</p>
        <div className="mt-2 h-2 rounded-full bg-bg">
          <div className="h-full w-2/5 rounded-full bg-accent/80" />
        </div>
      </section>
    );
  }

  const total = Math.max(loadingProgress.total, 1);
  const completed = Math.max(0, Math.min(loadingProgress.completed, total));
  const percent = Math.round((completed / total) * 100);

  return (
    <section className="rounded-xl border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>Recomputing analytics...</span>
        <span>
          {completed}/{total} ({percent}%)
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  );
}

function buildRequest(
  range: { startDate?: string; endDate?: string },
  metrics: AdvancedAnalyticsRunRequest['metrics'],
  streaks: AdvancedAnalyticsRunRequest['streaks'],
  charts: AdvancedAnalyticsRunRequest['charts']
): AdvancedAnalyticsRunRequest {
  return {
    startDate: range.startDate,
    endDate: range.endDate,
    metrics,
    streaks,
    charts
  };
}

function rangeKeyFromConfig(timeRange: AdvancedAnalyticsTimeRangeConfig | undefined): string {
  return JSON.stringify(resolveAdvancedAnalyticsTimeRange(timeRange));
}

const STREAK_FIXED_TIME_RANGE: AdvancedAnalyticsTimeRangeConfig = { preset: 'all' };
const CONFIGURE_PREVIEW_TIME_RANGE: AdvancedAnalyticsTimeRangeConfig = { preset: 'all' };

export function AdvancedAnalyticsPage() {
  const settings = useAppStore((state) => state.settings);
  const getCachedAdvancedAnalytics = useAppStore((state) => state.getCachedAdvancedAnalytics);
  const setCachedAdvancedAnalytics = useAppStore((state) => state.setCachedAdvancedAnalytics);
  const metrics = useAdvancedAnalyticsStore((state) => state.metrics);
  const streaks = useAdvancedAnalyticsStore((state) => state.streaks);
  const charts = useAdvancedAnalyticsStore((state) => state.charts);
  const autoRun = useAdvancedAnalyticsStore((state) => state.autoRun);
  const selectedItem = useAdvancedAnalyticsStore((state) => state.selectedItem);
  const setAutoRun = useAdvancedAnalyticsStore((state) => state.setAutoRun);
  const setSelectedItem = useAdvancedAnalyticsStore((state) => state.setSelectedItem);
  const addMetric = useAdvancedAnalyticsStore((state) => state.addMetric);
  const updateMetric = useAdvancedAnalyticsStore((state) => state.updateMetric);
  const removeMetric = useAdvancedAnalyticsStore((state) => state.removeMetric);
  const moveMetric = useAdvancedAnalyticsStore((state) => state.moveMetric);
  const addStreak = useAdvancedAnalyticsStore((state) => state.addStreak);
  const updateStreak = useAdvancedAnalyticsStore((state) => state.updateStreak);
  const removeStreak = useAdvancedAnalyticsStore((state) => state.removeStreak);
  const moveStreak = useAdvancedAnalyticsStore((state) => state.moveStreak);
  const addChart = useAdvancedAnalyticsStore((state) => state.addChart);
  const updateChart = useAdvancedAnalyticsStore((state) => state.updateChart);
  const removeChart = useAdvancedAnalyticsStore((state) => state.removeChart);
  const moveChart = useAdvancedAnalyticsStore((state) => state.moveChart);
  const replaceDefinitions = useAdvancedAnalyticsStore((state) => state.replaceDefinitions);
  const activeTab = useUiStateStore((state) => state.analyticsActiveTab);
  const setActiveTab = useUiStateStore((state) => state.setAnalyticsActiveTab);

  const [responsesByCacheKey, setResponsesByCacheKey] = useState<Record<string, AdvancedAnalyticsRunResponse>>({});
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ completed: number; total: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [transferMessage, setTransferMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [transferSelectionSession, setTransferSelectionSession] = useState<TransferSelectionSession | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedItem) {
      return;
    }
    if (metrics[0]) {
      setSelectedItem({ kind: 'metric', id: metrics[0].id });
      return;
    }
    if (streaks[0]) {
      setSelectedItem({ kind: 'streak', id: streaks[0].id });
      return;
    }
    if (charts[0]) {
      setSelectedItem({ kind: 'chart', id: charts[0].id });
    }
  }, [charts, metrics, selectedItem, setSelectedItem, streaks]);

  const dataVersion = advancedAnalyticsDataVersion(settings);

  const validationIssues = useMemo(
    () => validateAdvancedAnalyticsDefinitions({ metrics, streaks, charts }),
    [charts, metrics, streaks]
  );
  const viewTabMetrics = useMemo(
    () => metrics.filter((metric) => metric.showInView !== false),
    [metrics]
  );

  const selectedIssues = useMemo(() => {
    if (!selectedItem) {
      return validationIssues;
    }
    return validationIssues.filter(
      (issue) => issue.scope === 'global' || (issue.id != null && issue.id === selectedItem.id)
    );
  }, [selectedItem, validationIssues]);

  const selectedMetric =
    selectedItem?.kind === 'metric' ? metrics.find((metric) => metric.id === selectedItem.id) : undefined;
  const selectedStreak =
    selectedItem?.kind === 'streak' ? streaks.find((streak) => streak.id === selectedItem.id) : undefined;
  const selectedChart =
    selectedItem?.kind === 'chart' ? charts.find((chart) => chart.id === selectedItem.id) : undefined;

  const selectedRequestEntry = useMemo<RequestEntry | null>(() => {
    if (!selectedItem) {
      return null;
    }

    const range = resolveAdvancedAnalyticsTimeRange(CONFIGURE_PREVIEW_TIME_RANGE);
    const request = buildRequest(range, metrics, streaks, charts);
    return {
      request,
      cacheKey: advancedAnalyticsRequestCacheKey(request, dataVersion)
    };
  }, [charts, dataVersion, metrics, selectedItem, streaks]);

  const overviewRequestEntries = useMemo<RequestEntry[]>(() => {
    const byRangeKey = new Map<string, RequestEntry>();
    const itemRanges = [
      ...viewTabMetrics.map((metric) => metric.timeRange),
      ...streaks.map(() => STREAK_FIXED_TIME_RANGE),
      ...charts.map((chart) => chart.timeRange)
    ];

    for (const timeRange of itemRanges) {
      const key = rangeKeyFromConfig(timeRange);
      if (byRangeKey.has(key)) {
        continue;
      }
      const range = resolveAdvancedAnalyticsTimeRange(timeRange);
      const request = buildRequest(range, metrics, streaks, charts);
      byRangeKey.set(key, {
        request,
        cacheKey: advancedAnalyticsRequestCacheKey(request, dataVersion)
      });
    }

    return Array.from(byRangeKey.values());
  }, [charts, dataVersion, metrics, streaks, viewTabMetrics]);

  const requestEntries = useMemo(
    () => (activeTab === 'view' ? overviewRequestEntries : selectedRequestEntry ? [selectedRequestEntry] : []),
    [activeTab, overviewRequestEntries, selectedRequestEntry]
  );

  const getResponse = (cacheKey: string): AdvancedAnalyticsRunResponse | null =>
    responsesByCacheKey[cacheKey] ?? getCachedAdvancedAnalytics(cacheKey);

  const runRequests = async (entries: RequestEntry[], force: boolean) => {
    if (entries.length === 0) {
      setLoadingProgress(null);
      return;
    }

    setLoading(true);
    setLoadingProgress({ completed: 0, total: entries.length });
    setRunError(null);

    const nextResponses: Record<string, AdvancedAnalyticsRunResponse> = {};
    const errors: string[] = [];

    await Promise.all(
      entries.map(async (entry) => {
        try {
          if (!force) {
            const existing = getResponse(entry.cacheKey);
            if (existing) {
              nextResponses[entry.cacheKey] = existing;
              return;
            }
          }

          const next = await runAdvancedAnalytics(entry.request);
          nextResponses[entry.cacheKey] = next;
          setCachedAdvancedAnalytics(entry.cacheKey, next);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        } finally {
          setLoadingProgress((current) =>
            current
              ? { ...current, completed: Math.min(current.total, current.completed + 1) }
              : current
          );
        }
      })
    );

    setResponsesByCacheKey((current) => ({ ...current, ...nextResponses }));
    setRunError(errors.length > 0 ? errors[0] : null);
    setLoading(false);
    setLoadingProgress(null);
  };

  useEffect(() => {
    if (!autoRun || requestEntries.length === 0) {
      return;
    }

    const missing = requestEntries.filter((entry) => !getResponse(entry.cacheKey));
    if (missing.length === 0) {
      setLoading(false);
      setLoadingProgress(null);
      setRunError(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadingProgress({ completed: 0, total: missing.length });
      setRunError(null);

      const nextResponses: Record<string, AdvancedAnalyticsRunResponse> = {};
      const errors: string[] = [];

      await Promise.all(
        missing.map(async (entry) => {
          try {
            const next = await runAdvancedAnalytics(entry.request);
            if (!cancelled) {
              nextResponses[entry.cacheKey] = next;
              setCachedAdvancedAnalytics(entry.cacheKey, next);
            }
          } catch (error) {
            if (!cancelled) {
              errors.push(error instanceof Error ? error.message : String(error));
            }
          } finally {
            if (!cancelled) {
              setLoadingProgress((current) =>
                current
                  ? { ...current, completed: Math.min(current.total, current.completed + 1) }
                  : current
              );
            }
          }
        })
      );

      if (!cancelled) {
        setResponsesByCacheKey((current) => ({ ...current, ...nextResponses }));
        setRunError(errors.length > 0 ? errors[0] : null);
        setLoading(false);
        setLoadingProgress(null);
      }
    };

    void run();

    return () => {
      cancelled = true;
      setLoadingProgress(null);
    };
  }, [autoRun, getCachedAdvancedAnalytics, requestEntries, setCachedAdvancedAnalytics]);

  const selectedResponse = selectedRequestEntry ? getResponse(selectedRequestEntry.cacheKey) : null;

  const overviewMetricResultsById = useMemo<Record<string, AdvancedAnalyticsMetricResult | undefined>>(() => {
    const results: Record<string, AdvancedAnalyticsMetricResult | undefined> = {};
    for (const metric of viewTabMetrics) {
      const range = resolveAdvancedAnalyticsTimeRange(metric.timeRange);
      const request = buildRequest(range, metrics, streaks, charts);
      const cacheKey = advancedAnalyticsRequestCacheKey(request, dataVersion);
      const response = getResponse(cacheKey);
      results[metric.id] = response?.metricResults[metric.id];
    }
    return results;
  }, [charts, dataVersion, getCachedAdvancedAnalytics, metrics, responsesByCacheKey, streaks, viewTabMetrics]);

  const overviewStreakResultsById = useMemo<Record<string, AdvancedAnalyticsStreakResult | undefined>>(() => {
    const results: Record<string, AdvancedAnalyticsStreakResult | undefined> = {};
    for (const streak of streaks) {
      const range = resolveAdvancedAnalyticsTimeRange(STREAK_FIXED_TIME_RANGE);
      const request = buildRequest(range, metrics, streaks, charts);
      const cacheKey = advancedAnalyticsRequestCacheKey(request, dataVersion);
      const response = getResponse(cacheKey);
      results[streak.id] = response?.streakResults[streak.id];
    }
    return results;
  }, [charts, dataVersion, getCachedAdvancedAnalytics, metrics, responsesByCacheKey, streaks]);

  const overviewChartResultsById = useMemo<Record<string, AdvancedAnalyticsChartResult | undefined>>(() => {
    const results: Record<string, AdvancedAnalyticsChartResult | undefined> = {};
    for (const chart of charts) {
      const range = resolveAdvancedAnalyticsTimeRange(chart.timeRange);
      const request = buildRequest(range, metrics, streaks, charts);
      const cacheKey = advancedAnalyticsRequestCacheKey(request, dataVersion);
      const response = getResponse(cacheKey);
      results[chart.id] = response?.chartResults[chart.id];
    }
    return results;
  }, [charts, dataVersion, getCachedAdvancedAnalytics, metrics, responsesByCacheKey, streaks]);

  const handleExportDefinitions = () => {
    setTransferSelectionSession({
      id:
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : String(Date.now()),
      mode: 'export',
      sourceLabel: 'Current analytics library',
      data: {
        metrics,
        streaks,
        charts
      }
    });
  };

  const handleImportDefinitions = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseAdvancedAnalyticsTransferFile(text);
      if (!parsed.ok) {
        setTransferMessage({ type: 'error', text: parsed.error });
        return;
      }

      setTransferSelectionSession({
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : String(Date.now()),
        mode: 'import',
        sourceLabel: file.name,
        data: parsed.data
      });
      setTransferMessage(null);
    } catch (error) {
      setTransferMessage({
        type: 'error',
        text: error instanceof Error ? error.message : String(error)
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleTransferSelectionConfirm = async (
    selection: AdvancedAnalyticsTransferSelectionResult
  ) => {
    if (!transferSelectionSession) {
      return;
    }

    if (transferSelectionSession.mode === 'export') {
      const folderPath = await open({
        directory: true,
        multiple: false,
        title: 'Select Export Folder'
      });
      if (!folderPath || Array.isArray(folderPath)) {
        return;
      }

      try {
        const payload = buildAdvancedAnalyticsTransferFile(selection.data);
        const fileText = JSON.stringify(payload, null, 2);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `trajectory-analytics-${timestamp}.json`;
        const outputPath = await exportAnalyticsJson(folderPath, fileName, fileText);
        setTransferMessage({
          type: 'success',
          text: `Exported ${selection.data.metrics.length} metrics, ${selection.data.streaks.length} streaks, and ${selection.data.charts.length} charts to ${outputPath}.`
        });
        setTransferSelectionSession(null);
      } catch (error) {
        setTransferMessage({
          type: 'error',
          text: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    const merged = mergeAdvancedAnalyticsTransferData({
      base: { metrics, streaks, charts },
      incoming: selection.data
    });
    replaceDefinitions({
      metrics: merged.metrics,
      streaks: merged.streaks,
      charts: merged.charts
    });
    setResponsesByCacheKey({});
    setRunError(null);
    setTransferSelectionSession(null);
    setTransferMessage({
      type: 'success',
      text: `Imported ${selection.data.metrics.length} metrics, ${selection.data.streaks.length} streaks, and ${selection.data.charts.length} charts from ${transferSelectionSession.sourceLabel}.`
    });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Analytics</p>
          <h2 className="mt-2 text-3xl font-semibold text-foreground">Advanced Analytics</h2>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Build custom metrics, formula metrics, streaks, and chart views from your local activity
            data.
          </p>
        </div>

        <section className="rounded-xl border border-border bg-panel p-3">
          <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_auto_auto_1fr] lg:items-center">
            <div className="inline-flex rounded-lg border border-border bg-bg/40 p-1">
              {(['view', 'configure'] as const).map((tab) => {
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      active
                        ? 'bg-accent text-white'
                        : 'text-muted hover:bg-bg hover:text-foreground'
                    }`}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>

            <label className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={autoRun}
                onChange={(event) => setAutoRun(event.target.checked)}
              />
              Auto-run
            </label>

            <button
              type="button"
              onClick={() => {
                void runRequests(requestEntries, true);
              }}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              Recompute
            </button>

            <button
              type="button"
              onClick={handleExportDefinitions}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg hover:text-foreground"
            >
              Export Metrics
            </button>

            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-bg hover:text-foreground"
            >
              Import Metrics
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                void handleImportDefinitions(event);
              }}
            />

            <div className="text-xs text-muted lg:text-right">
              Using HR zones from Settings:
              <span className="ml-1 font-medium text-foreground">
                {(settings?.heartRateZoneUpperBoundsBpm ?? [120, 140, 160, 180]).join(' / ')} bpm
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            {activeTab === 'configure'
              ? 'Create and edit analytics definitions. Set metric/chart card time ranges for View cards here; Configure previews always use all activity history.'
              : 'See all analytics results at a glance. Metric cards show only values; charts appear only from Chart Views.'}
          </p>
          <p className="mt-1 text-xs text-muted">
            Use Export/Import to share selected analytics definitions. Dependencies are included automatically.
          </p>
          {transferMessage ? (
            <p
              className={`mt-2 text-xs ${
                transferMessage.type === 'error' ? 'text-accent' : 'text-muted'
              }`}
            >
              {transferMessage.text}
            </p>
          ) : null}
        </section>

        {transferSelectionSession ? (
          <TransferSelectionPanel
            key={transferSelectionSession.id}
            mode={transferSelectionSession.mode}
            sourceLabel={transferSelectionSession.sourceLabel}
            data={transferSelectionSession.data}
            existingData={
              transferSelectionSession.mode === 'import'
                ? { metrics, streaks, charts }
                : undefined
            }
            onCancel={() => setTransferSelectionSession(null)}
            onConfirm={handleTransferSelectionConfirm}
          />
        ) : null}
      </header>

      {activeTab === 'configure' && loading ? (
        <AnalyticsLoadingBar loadingProgress={loadingProgress} />
      ) : null}

      {activeTab === 'configure' ? (
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <AnalyticsLibrary
            metrics={metrics}
            streaks={streaks}
            charts={charts}
            selectedItem={selectedItem}
            onSelect={setSelectedItem}
            onAddMetric={() => addMetric('base')}
            onAddFormulaMetric={() => addMetric('formula')}
            onMoveMetric={moveMetric}
            onAddStreak={addStreak}
            onMoveStreak={moveStreak}
            onAddChart={addChart}
            onMoveChart={moveChart}
          />

          <div className="space-y-4">
            {selectedIssues.length > 0 ? (
              <section className="rounded-xl border border-border bg-panel p-4">
                <h3 className="text-sm font-semibold text-foreground">Validation</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {selectedIssues.map((issue, index) => (
                    <li key={`${issue.scope}-${issue.id ?? 'global'}-${index}`}>{issue.message}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {selectedMetric ? (
              <MetricBuilder
                metric={selectedMetric}
                allMetrics={metrics}
                onChange={(metric) => updateMetric(metric.id, () => metric)}
                onDelete={() => removeMetric(selectedMetric.id)}
              />
            ) : null}

            {selectedStreak ? (
              <StreakBuilder
                streak={selectedStreak}
                metrics={metrics}
                onChange={(streak) => updateStreak(streak.id, () => streak)}
                onDelete={() => removeStreak(selectedStreak.id)}
              />
            ) : null}

            {selectedChart ? (
              <ChartBuilder
                chart={selectedChart}
                metrics={metrics}
                onChange={(chart) => updateChart(chart.id, () => chart)}
                onDelete={() => removeChart(selectedChart.id)}
              />
            ) : null}

            <AnalyticsPreview
              selectedItem={selectedItem}
              metrics={metrics}
              streaks={streaks}
              charts={charts}
              response={selectedResponse}
              loading={false}
              loadingProgress={loadingProgress}
              error={runError}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {metrics.length > 0 && viewTabMetrics.length === 0 ? (
            <section className="rounded-xl border border-border bg-panel p-4 text-sm text-muted">
              No metrics are enabled for this tab. Open the Configure tab and enable{' '}
              <span className="font-medium text-foreground">Show in View tab</span> on any metric.
            </section>
          ) : null}

          <AnalyticsPreview
            mode="overview"
            overviewMetricIds={viewTabMetrics.map((metric) => metric.id)}
            selectedItem={selectedItem}
            metrics={metrics}
            streaks={streaks}
            charts={charts}
            response={selectedResponse}
            overviewMetricResultsById={overviewMetricResultsById}
            overviewStreakResultsById={overviewStreakResultsById}
            overviewChartResultsById={overviewChartResultsById}
            loading={loading}
            loadingProgress={loadingProgress}
            error={runError}
          />
        </div>
      )}
    </div>
  );
}
