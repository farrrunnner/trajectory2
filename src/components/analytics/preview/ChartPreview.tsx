import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Rectangle,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { TimeRangeControl } from '@/components/analytics/TimeRangeControl';
import { metricResultUnit } from '@/lib/analytics/formatting';
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
import type {
  AdvancedAnalyticsChartDefinition,
  AdvancedAnalyticsChartResult,
  AdvancedAnalyticsMetricDefinition,
  AdvancedAnalyticsMetricResult,
  AdvancedAnalyticsTimeRangeConfig
} from '@/types';

import {
  AnalyticsChartTooltip,
  CHART_COLORS,
  type ChartRow,
  NoticeList,
  formatDateBucketLabel,
  timeRangeIndicator,
  trimOuterEmptyBuckets,
  useZoomableRows
} from './shared';

export function ChartPreview({
  chart,
  result,
  metricsById,
  metricResults,
  onTimeRangeChange
}: {
  chart: AdvancedAnalyticsChartDefinition;
  result?: AdvancedAnalyticsChartResult;
  metricsById: Map<string, AdvancedAnalyticsMetricDefinition>;
  metricResults: Record<string, AdvancedAnalyticsMetricResult | undefined>;
  onTimeRangeChange?: (timeRange: AdvancedAnalyticsTimeRangeConfig) => void;
}) {
  const rows: ChartRow[] = (result?.points ?? []).map((point) => ({
    key: point.key,
    label: point.label,
    ...point.values
  }));
  const visibleRows = trimOuterEmptyBuckets(rows, (row) => {
    if (chart.chartType === 'bar' || chart.chartType === 'stackedBar') {
      return chart.metricIds.some((metricId) => {
        const value = row[metricId];
        return typeof value === 'number' && Math.abs(value) > 1e-9;
      });
    }

    return chart.metricIds.some((metricId) => row[metricId] !== null && row[metricId] !== undefined);
  });
  const zoom = useZoomableRows(visibleRows);
  const chartUnitsByMetricId = useMemo(
    () =>
      Object.fromEntries(
        chart.metricIds.map((metricId) => [
          metricId,
          metricResultUnit(metricsById.get(metricId), metricResults[metricId]) ?? ''
        ])
      ),
    [chart.metricIds, metricResults, metricsById]
  );
  const stackedTopMetricIdByRowKey = useMemo(() => {
    if (chart.chartType !== 'stackedBar') {
      return new Map<string, string>();
    }

    const topByKey = new Map<string, string>();
    for (const row of zoom.visibleRows) {
      for (let index = chart.metricIds.length - 1; index >= 0; index -= 1) {
        const metricId = chart.metricIds[index];
        const value = row[metricId];
        if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) <= 1e-9) {
          continue;
        }
        topByKey.set(row.key, metricId);
        break;
      }
    }

    return topByKey;
  }, [chart.chartType, chart.metricIds, zoom.visibleRows]);

  return (
    <section className="space-y-3 rounded-xl border border-border bg-panel p-4">
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-foreground">{chart.name || 'Untitled chart'}</h3>
        {onTimeRangeChange ? (
          <div className="mt-3">
            <TimeRangeControl
              value={chart.timeRange}
              onChange={onTimeRangeChange}
              compact
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Range: {timeRangeIndicator(chart.timeRange)}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="rounded-full border border-border bg-bg/40 px-2 py-0.5">{chart.chartType}</span>
          <span className="rounded-full border border-border bg-bg/40 px-2 py-0.5">{chart.granularity}</span>
          <span className="rounded-full border border-border bg-bg/40 px-2 py-0.5">
            {chart.metricIds.length} metric{chart.metricIds.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="space-y-2">
          <div className="h-64 rounded-lg border border-border/80 bg-bg/30 p-2.5">
            <ResponsiveContainer width="100%" height="100%">
              {chart.chartType === 'line' ? (
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
                    content={<AnalyticsChartTooltip unitsByKey={chartUnitsByMetricId} />}
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
                  {chart.metricIds.length > 1 ? (
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 12, lineHeight: '20px', paddingBottom: 4 }}
                    />
                  ) : null}
                  {chart.metricIds.slice(0, 1).map((metricId, index) => (
                    <Line
                      key={metricId}
                      type="monotone"
                      dataKey={metricId}
                      name={metricsById.get(metricId)?.name ?? metricId}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]}
                      strokeWidth={CHART_LINE_STROKE_WIDTH}
                      dot={false}
                      connectNulls
                      activeDot={CHART_LINE_ACTIVE_DOT}
                      isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart
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
                    cursor={{ fill: 'transparent' }}
                    content={<AnalyticsChartTooltip unitsByKey={chartUnitsByMetricId} />}
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
                  {chart.metricIds.length > 1 ? (
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 12, lineHeight: '20px', paddingBottom: 4 }}
                    />
                  ) : null}
                  {chart.metricIds.map((metricId, index) => {
                    const isStacked = chart.chartType === 'stackedBar';
                    return (
                      <Bar
                        key={metricId}
                        dataKey={metricId}
                        name={metricsById.get(metricId)?.name ?? metricId}
                        stackId={isStacked ? 'stack' : undefined}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        radius={isStacked ? [0, 0, 0, 0] : [3, 3, 0, 0]}
                        shape={
                          isStacked
                            ? ((shapeProps: unknown) => {
                                const props = shapeProps as { payload?: { key?: string } } & Record<string, unknown>;
                                const rowKey = props.payload?.key;
                                const roundTop =
                                  typeof rowKey === 'string' &&
                                  stackedTopMetricIdByRowKey.get(rowKey) === metricId;
                                return <Rectangle {...props} radius={roundTop ? [3, 3, 0, 0] : [0, 0, 0, 0]} />;
                              })
                            : undefined
                        }
                        isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                      />
                    );
                  })}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted">
            Drag to zoom the x-axis. Click once to reset.
            {zoom.isZoomed ? ' Showing a zoomed range.' : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">No chart points for this chart in the selected range.</p>
      )}

      <NoticeList title="Chart Errors" items={result?.errors ?? []} tone="error" />
      <NoticeList title="Chart Warnings" items={result?.warnings ?? []} />
    </section>
  );
}
