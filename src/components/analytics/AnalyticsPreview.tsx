import type { AdvancedAnalyticsSelection } from '@/store/useAdvancedAnalyticsStore';
import type {
  AdvancedAnalyticsChartDefinition,
  AdvancedAnalyticsChartResult,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsMetricResult,
  AdvancedAnalyticsRunResponse,
  AdvancedAnalyticsStreakDefinition,
  AdvancedAnalyticsStreakResult,
  AdvancedAnalyticsTimeRangeConfig
} from '@/types';

import { AnalyticsLoadingBar } from './preview/AnalyticsLoadingBar';
import { ChartPreview } from './preview/ChartPreview';
import { MetricPreview } from './preview/MetricPreview';
import { StreakPreview } from './preview/StreakPreview';
import { NoticeList } from './preview/shared';

interface AnalyticsPreviewProps {
  selectedItem: AdvancedAnalyticsSelection;
  metrics: AdvancedAnalyticsMetricDefinition[];
  streaks: AdvancedAnalyticsStreakDefinition[];
  charts: AdvancedAnalyticsChartDefinition[];
  mode?: 'selected' | 'overview';
  overviewMetricIds?: string[];
  response: AdvancedAnalyticsRunResponse | null;
  overviewMetricResultsById?: Record<string, AdvancedAnalyticsMetricResult | undefined>;
  overviewStreakResultsById?: Record<string, AdvancedAnalyticsStreakResult | undefined>;
  overviewChartResultsById?: Record<string, AdvancedAnalyticsChartResult | undefined>;
  onMetricTimeRangeChange?: (metricId: string, timeRange: AdvancedAnalyticsTimeRangeConfig) => void;
  onChartTimeRangeChange?: (chartId: string, timeRange: AdvancedAnalyticsTimeRangeConfig) => void;
  loading: boolean;
  loadingProgress?: { completed: number; total: number } | null;
  error: string | null;
}

export function AnalyticsPreview({
  selectedItem,
  metrics,
  streaks,
  charts,
  mode = 'selected',
  overviewMetricIds,
  response,
  overviewMetricResultsById,
  overviewStreakResultsById,
  overviewChartResultsById,
  onMetricTimeRangeChange,
  onChartTimeRangeChange,
  loading,
  loadingProgress,
  error
}: AnalyticsPreviewProps) {
  const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
  const metricResults = response?.metricResults ?? {};
  const streakResults = response?.streakResults ?? {};
  const chartResults = response?.chartResults ?? {};
  const resolvedOverviewMetricResults = overviewMetricResultsById ?? metricResults;
  const resolvedOverviewStreakResults = overviewStreakResultsById ?? streakResults;
  const resolvedOverviewChartResults = overviewChartResultsById ?? chartResults;
  const overviewMetricIdSet = overviewMetricIds ? new Set(overviewMetricIds) : null;
  const overviewMetrics =
    mode === 'overview'
      ? overviewMetricIdSet
        ? metrics.filter((metric) => overviewMetricIdSet.has(metric.id))
        : metrics
      : [];

  if (mode === 'overview') {
    const hasAnyItems = overviewMetrics.length > 0 || streaks.length > 0 || charts.length > 0;

    return (
      <div className="space-y-5">
        {loading ? <AnalyticsLoadingBar loadingProgress={loadingProgress} /> : null}
        {error ? (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">{error}</div>
        ) : null}
        {response?.globalWarnings?.length ? (
          <NoticeList title="Global Warnings" items={response.globalWarnings} />
        ) : null}

        {!hasAnyItems ? (
          <section className="rounded-xl border border-border bg-panel p-6">
            <h3 className="text-lg font-semibold text-foreground">View</h3>
            <p className="mt-2 text-sm text-muted">
              Create metrics, streaks, or chart views in Configure to see an overview here.
            </p>
          </section>
        ) : null}

        {overviewMetrics.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Metrics</h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {overviewMetrics.map((metric) => (
                <MetricPreview
                  key={metric.id}
                  metric={metric}
                  result={resolvedOverviewMetricResults[metric.id]}
                  showChart={false}
                  showSamplePreview={false}
                />
              ))}
            </div>
          </section>
        ) : null}

        {streaks.length > 0 ? (
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">Streaks</h3>
            <div className="grid gap-3 xl:grid-cols-2">
              {streaks.map((streak) => (
                <StreakPreview
                  key={streak.id}
                  streak={streak}
                  result={resolvedOverviewStreakResults[streak.id]}
                />
              ))}
            </div>
          </section>
        ) : null}

        {charts.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold text-foreground">Charts</h3>
            {charts.map((chart) => (
              <ChartPreview
                key={chart.id}
                chart={chart}
                result={resolvedOverviewChartResults[chart.id]}
                metricsById={metricsById}
                metricResults={resolvedOverviewMetricResults}
              />
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  if (!selectedItem) {
    return (
      <section className="rounded-xl border border-border bg-panel p-6">
        <h3 className="text-lg font-semibold text-foreground">Preview</h3>
        <p className="mt-2 text-sm text-muted">
          Select or create a metric, streak, or chart view to edit and preview it.
        </p>
      </section>
    );
  }

  const selectedMetric =
    selectedItem.kind === 'metric' ? metrics.find((metric) => metric.id === selectedItem.id) : undefined;
  const selectedStreak =
    selectedItem.kind === 'streak' ? streaks.find((streak) => streak.id === selectedItem.id) : undefined;
  const selectedChart =
    selectedItem.kind === 'chart' ? charts.find((chart) => chart.id === selectedItem.id) : undefined;

  return (
    <div className="space-y-4">
      {loading ? <AnalyticsLoadingBar loadingProgress={loadingProgress} /> : null}
      {error ? (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">{error}</div>
      ) : null}
      {response?.globalWarnings?.length ? (
        <NoticeList title="Global Warnings" items={response.globalWarnings} />
      ) : null}

      {selectedMetric ? (
        <MetricPreview
          metric={selectedMetric}
          result={metricResults[selectedMetric.id]}
          onTimeRangeChange={
            onMetricTimeRangeChange
              ? (timeRange) => onMetricTimeRangeChange(selectedMetric.id, timeRange)
              : undefined
          }
        />
      ) : null}
      {selectedStreak ? (
        <StreakPreview
          streak={selectedStreak}
          result={streakResults[selectedStreak.id]}
        />
      ) : null}
      {selectedChart ? (
        <ChartPreview
          chart={selectedChart}
          result={chartResults[selectedChart.id]}
          metricsById={metricsById}
          metricResults={metricResults}
          onTimeRangeChange={
            onChartTimeRangeChange
              ? (timeRange) => onChartTimeRangeChange(selectedChart.id, timeRange)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
