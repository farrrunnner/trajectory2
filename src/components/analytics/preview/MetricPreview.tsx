import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { TimeRangeControl } from '@/components/analytics/TimeRangeControl';
import { formatAnalyticsValue, metricPreviewGranularity, metricResultUnit } from '@/lib/analytics/formatting';
import {
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_IS_ANIMATION_ACTIVE,
  CHART_LINE_ACTIVE_DOT,
  CHART_LINE_STROKE_WIDTH,
  CHART_SELECTION_FILL,
  CHART_SELECTION_FILL_OPACITY,
  CHART_SELECTION_STROKE,
  CHART_SELECTION_STROKE_OPACITY,
  CHART_TOOLTIP_CURSOR_LINE,
  CHART_TOOLTIP_WRAPPER_STYLE
} from '@/lib/charts/plottingEngine';
import { formatDuration } from '@/lib/format';
import type {
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsMetricResult,
  AdvancedAnalyticsSampleTimeActivityPreview,
  AdvancedAnalyticsTimeRangeConfig
} from '@/types';

import {
  AnalyticsChartTooltip,
  NoticeList,
  SAMPLE_TIME_PREVIEW_PAGE_SIZE,
  formatDateBucketLabel,
  timeRangeIndicator,
  trimOuterEmptyBuckets,
  useZoomableRows
} from './shared';

export function MetricPreview({
  metric,
  result,
  showChart = true,
  showSamplePreview = true,
  onTimeRangeChange
}: {
  metric: AdvancedAnalyticsMetricDefinition;
  result?: AdvancedAnalyticsMetricResult;
  showChart?: boolean;
  showSamplePreview?: boolean;
  onTimeRangeChange?: (timeRange: AdvancedAnalyticsTimeRangeConfig) => void;
}) {
  const isCompactOverviewCard = !showChart && !showSamplePreview && !onTimeRangeChange;
  const granularity = metricPreviewGranularity(metric);
  const points =
    granularity === 'day'
      ? result?.seriesByGranularity.day ?? []
      : granularity === 'week'
        ? result?.seriesByGranularity.week ?? []
        : result?.seriesByGranularity.month ?? [];
  const chartPoints = trimOuterEmptyBuckets(points, (point) => {
    if (point.value === null || point.value === undefined) {
      return false;
    }
    return Math.abs(point.value) > 1e-9;
  });
  const unit = metricResultUnit(metric, result);
  const rows = chartPoints.map((point) => ({ key: point.key, label: point.label, value: point.value }));
  const zoom = useZoomableRows(rows);

  return (
    <div className={isCompactOverviewCard ? 'space-y-3' : 'space-y-4'}>
      <div className={`rounded-xl border border-border bg-panel ${isCompactOverviewCard ? 'p-3' : 'p-4'}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={`font-semibold text-foreground ${isCompactOverviewCard ? 'text-lg' : 'text-xl'}`}>
            {metric.name || 'Untitled metric'}
          </h3>
          {!onTimeRangeChange ? (
            <p className="whitespace-nowrap text-xs text-muted">Range: {timeRangeIndicator(metric.timeRange)}</p>
          ) : null}
        </div>
        {onTimeRangeChange ? (
          <div className="mt-3">
            <TimeRangeControl
              value={metric.timeRange}
              onChange={onTimeRangeChange}
              compact
            />
          </div>
        ) : null}
        <p className={`font-semibold text-foreground ${isCompactOverviewCard ? 'mt-2 text-2xl' : 'mt-3 text-3xl'}`}>
          {formatAnalyticsValue(result?.scalarValue, unit)}
        </p>
        {showChart ? <p className="mt-1 text-xs text-muted">Preview granularity: {granularity}</p> : null}
      </div>

      {showChart && chartPoints.length > 0 ? (
        <div className="space-y-2">
          <div className="h-72 rounded-lg border border-border/80 bg-bg/30 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={zoom.visibleRows}
                onMouseDown={zoom.onMouseDown}
                onMouseMove={zoom.onMouseMove}
                onMouseUp={zoom.onMouseUp}
                onMouseLeave={zoom.onMouseLeave}
              >
                <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="key"
                  stroke={CHART_AXIS_STROKE}
                  tickFormatter={formatDateBucketLabel}
                  tick={{ fill: 'rgb(var(--color-muted))', fontSize: 12 }}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  stroke={CHART_AXIS_STROKE}
                  tick={{ fill: 'rgb(var(--color-muted))', fontSize: 12 }}
                  tickMargin={8}
                  width={58}
                />
                <Tooltip
                  cursor={CHART_TOOLTIP_CURSOR_LINE}
                  content={<AnalyticsChartTooltip unitsByKey={{ value: unit ?? '' }} />}
                  wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
                  isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                />
                {zoom.selectionDomain ? (
                  <ReferenceArea
                    x1={zoom.selectionDomain[0]}
                    x2={zoom.selectionDomain[1]}
                    fill={CHART_SELECTION_FILL}
                    fillOpacity={CHART_SELECTION_FILL_OPACITY}
                    stroke={CHART_SELECTION_STROKE}
                    strokeOpacity={CHART_SELECTION_STROKE_OPACITY}
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="rgb(var(--color-accent))"
                  strokeWidth={CHART_LINE_STROKE_WIDTH}
                  dot={false}
                  connectNulls
                  activeDot={CHART_LINE_ACTIVE_DOT}
                  isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted">
            Drag to zoom the x-axis. Click once to reset.
            {zoom.isZoomed ? ' Showing a zoomed range.' : ''}
          </p>
        </div>
      ) : showChart ? (
        <p className="text-sm text-muted">No series points for this metric in the selected range.</p>
      ) : null}

      <NoticeList title="Metric Errors" items={result?.errors ?? []} tone="error" />
      <NoticeList title="Metric Warnings" items={result?.warnings ?? []} />
      {showSamplePreview &&
      metric.kind === 'base' &&
      metric.base?.measure === 'sampleTime' &&
      result?.sampleTimePreview ? (
        <SampleTimeActivityPreview preview={result.sampleTimePreview} />
      ) : null}
    </div>
  );
}

function SampleTimeActivityPreview({
  preview
}: {
  preview: NonNullable<AdvancedAnalyticsMetricResult['sampleTimePreview']>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [visibleCount, setVisibleCount] = useState(SAMPLE_TIME_PREVIEW_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(SAMPLE_TIME_PREVIEW_PAGE_SIZE);
  }, [preview]);

  const hasActivities = preview.activities.length > 0;
  const visibleActivities = preview.activities.slice(0, visibleCount);
  const hasMore = visibleCount < preview.activities.length;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-panel p-4">
      <div className="space-y-1">
        <p className="text-sm text-muted">
          Considered activities: {preview.consideredActivityCount}. Showing {preview.sampledActivityCount}
          {preview.minimumContinuousMatchSeconds > 0
            ? ` with minimum continuous match ${formatDuration(preview.minimumContinuousMatchSeconds)}.`
            : ' (no minimum continuous match threshold).'}
        </p>
      </div>

      {hasActivities ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" />
              Included
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
              Filtered out (below minimum)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-border" />
              Tracked activity timeline
            </div>
          </div>

          {visibleActivities.map((activity) => (
            <SampleTimeActivityRow
              key={activity.activityId}
              activity={activity}
              onOpen={() =>
                navigate(`/activities/${activity.activityId}`, {
                  state: {
                    fromPath: location.pathname,
                    fromLabel: 'Back to Events Analytics'
                  }
                })
              }
            />
          ))}
          {preview.activities.length > SAMPLE_TIME_PREVIEW_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-xs text-muted">
                Showing {Math.min(visibleCount, preview.activities.length)} of {preview.activities.length} activities.
              </p>
              <div className="flex items-center gap-2">
                {visibleCount > SAMPLE_TIME_PREVIEW_PAGE_SIZE ? (
                  <button
                    type="button"
                    onClick={() => setVisibleCount(SAMPLE_TIME_PREVIEW_PAGE_SIZE)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-bg hover:text-foreground"
                  >
                    Show less
                  </button>
                ) : null}
                {hasMore ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setVisibleCount(preview.activities.length)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-bg"
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleCount((current) => current + SAMPLE_TIME_PREVIEW_PAGE_SIZE)}
                      className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-bg"
                    >
                      Show more
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">No activities matched for sample-time preview.</p>
      )}
    </section>
  );
}

function SampleTimeActivityRow({
  activity,
  onOpen
}: {
  activity: AdvancedAnalyticsSampleTimeActivityPreview;
  onOpen: () => void;
}) {
  const total = activity.totalTrackedSeconds;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full space-y-1.5 rounded-lg border border-border bg-bg/30 p-3 text-left transition-colors hover:border-accent/40 hover:bg-bg/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      aria-label={`Open activity details for ${activity.activityTitle || 'untitled activity'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{activity.activityTitle || 'Untitled activity'}</p>
        <p className="text-xs text-muted">{activity.activityStart.replace('T', ' ').replace('Z', '')}</p>
      </div>
      <p className="text-xs text-muted">
        Included {formatDuration(activity.includedSeconds)} · Filtered {formatDuration(activity.filteredOutSeconds)} ·
        Tracked {formatDuration(activity.totalTrackedSeconds)}
      </p>

      <div className="relative h-3 overflow-hidden rounded bg-border/80">
        {total > 0
          ? activity.segments.map((segment, index) => {
              const leftPercent = Math.max(0, Math.min(100, (segment.startElapsedSeconds / total) * 100));
              const widthPercent = Math.max(
                0.8,
                Math.min(100 - leftPercent, (segment.durationSeconds / total) * 100)
              );
              return (
                <div
                  key={`${activity.activityId}-${index}`}
                  className={`absolute top-0 h-full ${
                    segment.status === 'included' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
                  title={`${segment.status === 'included' ? 'Included' : 'Filtered out'}: ${formatDuration(
                    segment.durationSeconds
                  )}`}
                />
              );
            })
          : null}
      </div>
    </button>
  );
}
