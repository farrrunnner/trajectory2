import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { FeatureCollection, LineString, Point } from 'geojson';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';

import { getActivity, getActivitySamples, getAerobicDecoupling } from '@/lib/tauri';
import {
  formatDateTime,
  formatDistanceKm,
  formatDuration,
  formatPaceMinKm,
  formatSpeedKmh
} from '@/lib/format';
import {
  CHART_IS_ANIMATION_ACTIVE,
  CHART_LINE_ACTIVE_DOT,
  CHART_SELECTION_FILL,
  CHART_SELECTION_FILL_OPACITY,
  CHART_SELECTION_STROKE,
  CHART_SELECTION_STROKE_OPACITY,
  CHART_AXIS_STROKE,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CURSOR_LINE,
  CHART_TOOLTIP_STYLE,
  CHART_TOOLTIP_WRAPPER_STYLE,
  areDomainsEqual,
  parseNumberChartLabel,
  usePlotDragZoom
} from '@/lib/charts/plottingEngine';
import {
  CHART_LINE_COLORS,
  CHART_MIN_ZOOM_SPAN_KM,
  CHART_MIN_ZOOM_SPAN_SECONDS,
  COMBINED_CHART_DOMAIN,
  COMBINED_CHART_SERIES_ORDER,
  type ChartMode,
  type ChartSeriesKey,
  type ChartSeriesVisibility,
  type ChartXAxisMode,
  type ChartZoomDomain,
  type CombinedChartModel,
  type CombinedChartPoint,
  type HeartRateZoneSlice,
  type RouteHoverCoordinate,
  type SplitMetricKey,
  type ZoneHighlightSegment,
  buildCombinedChartBands,
  buildHeartRateZoneBreakdown,
  buildHeartRateZoneHighlightSegments,
  defaultChartSeriesVisibility,
  formatDistanceAxisTick,
  formatElapsedAxisTick,
  formatElapsedTooltip,
  formatNumberTick,
  formatPaceSeconds,
  formatPaceTick,
  metricRange,
  metricRangeForVisibleDomain,
  normalizeHeartRateZoneUpperBounds,
  normalizeToBand,
  removeCombinedChartOutliers,
  readHoveredRouteCoordinate,
  routeHoverCoordinatesEqual
} from '@/lib/activityDetail/chartHelpers';
import { US_DEFAULT_CENTER, US_DEFAULT_ZOOM } from '@/lib/mapStyles';
import { getAccentThemePalette } from '@/lib/theme';
import { useManagedMapLibre } from '@/lib/useManagedMapLibre';
import { MaximizableMapFrame } from '@/components/MaximizableMapFrame';
import { MetricCard } from '@/components/MetricCard';
import { useAppStore } from '@/store/useAppStore';
import type {
  ActivityDetail,
  ActivitySample,
  AerobicDecouplingMode,
  AerobicDecouplingRange,
  AerobicDecouplingResponse,
  TrackPoint
} from '@/types';

const ACTIVITY_ROUTE_SOURCE_ID = 'activity-route-source';
const ACTIVITY_ROUTE_LAYER_ID = 'activity-route-layer';
const ACTIVITY_ROUTE_HOVER_SOURCE_ID = 'activity-route-hover-source';
const ACTIVITY_ROUTE_HOVER_OUTER_LAYER_ID = 'activity-route-hover-outer-layer';
const ACTIVITY_ROUTE_HOVER_INNER_LAYER_ID = 'activity-route-hover-inner-layer';
const ROUTE_HOVER_MARKER_SMOOTHING_MS = 10;
const EMPTY_DECOUPLING_RESULT: AerobicDecouplingResponse = {
  paceHrDecouplingPct: null,
  heartRateDriftPct: null
};
type ActivityRouteMapHandle = {
  setHoverTarget: (coordinate: RouteHoverCoordinate) => void;
  clearHoverTarget: () => void;
};

function SeriesToggle({
  label,
  color,
  enabled,
  disabled,
  onToggle
}: {
  label: string;
  color: string;
  enabled: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={enabled}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed border-border/60 text-muted/60'
          : enabled
            ? 'border-accent/50 bg-accent/10 text-foreground'
            : 'border-border text-muted hover:text-foreground'
      }`}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{
          backgroundColor: color,
          opacity: disabled ? 0.35 : 1
        }}
      />
      {label}
    </button>
  );
}

function ChartModeToggle({
  mode,
  onChange
}: {
  mode: ChartMode;
  onChange: (mode: ChartMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg/40 p-1">
      <button
        type="button"
        onClick={() => onChange('combined')}
        aria-pressed={mode === 'combined'}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          mode === 'combined' ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
        }`}
      >
        Combined
      </button>
      <button
        type="button"
        onClick={() => onChange('split')}
        aria-pressed={mode === 'split'}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          mode === 'split' ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
        }`}
      >
        Split
      </button>
    </div>
  );
}

function XAxisModeToggle({
  mode,
  showDistance,
  onChange
}: {
  mode: ChartXAxisMode;
  showDistance: boolean;
  onChange: (mode: ChartXAxisMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg/40 p-1">
      {showDistance ? (
        <button
          type="button"
          onClick={() => onChange('distance')}
          aria-pressed={mode === 'distance'}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            mode === 'distance' ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
          }`}
        >
          Distance
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onChange('time')}
        aria-pressed={mode === 'time'}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          mode === 'time' ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
        }`}
      >
        Time
      </button>
    </div>
  );
}

function PauseVisibilityToggle({
  hidePauses,
  onChange
}: {
  hidePauses: boolean;
  onChange: (hidePauses: boolean) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg/40 p-1">
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={hidePauses}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          hidePauses ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
        }`}
      >
        Moving only
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={!hidePauses}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          !hidePauses ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
        }`}
      >
        Include pause
      </button>
    </div>
  );
}

function DecouplingModeToggle({
  mode,
  onChange
}: {
  mode: AerobicDecouplingMode;
  onChange: (mode: AerobicDecouplingMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-bg/40 p-1">
      {(['outdoor', 'treadmill'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={mode === option}
          className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
            mode === option ? 'bg-panel text-foreground shadow-sm' : 'text-muted hover:text-foreground'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function formatDriftPercentage(value: number): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized.toFixed(1)}%`;
}

function CombinedChartTooltip({
  active,
  payload,
  xAxisMode
}: {
  active?: boolean;
  payload?: Array<{ payload?: CombinedChartPoint }>;
  xAxisMode: ChartXAxisMode;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }

  const point = payload[0].payload;
  const metricRows = [
    point.paceSecondsPerKm == null
      ? null
      : { label: 'Pace', value: formatPaceSeconds(point.paceSecondsPerKm) },
    point.speedKmh == null ? null : { label: 'Speed', value: `${formatNumberTick(point.speedKmh, 1)} km/h` },
    point.heartRate == null ? null : { label: 'Heart rate', value: `${Math.round(point.heartRate)} bpm` },
    point.cadence == null ? null : { label: 'Cadence', value: `${Math.round(point.cadence)} rpm` },
    point.powerWatts == null ? null : { label: 'Power', value: `${Math.round(point.powerWatts)} W` },
    point.elevationM == null ? null : { label: 'Elevation', value: `${Math.round(point.elevationM)} m` },
    point.gradePct == null
      ? null
      : { label: 'Grade', value: `${point.gradePct >= 0 ? '+' : ''}${formatNumberTick(point.gradePct, 1)}%` }
  ].filter((row): row is { label: string; value: string } => row != null);

  return (
    <div style={CHART_TOOLTIP_STYLE} className="min-w-[13rem] p-3 text-sm leading-tight">
      <p className="font-semibold text-foreground">{formatElapsedTooltip(point.elapsedSeconds)}</p>
      <div className="mt-2 space-y-1 text-foreground">
        {xAxisMode === 'distance' ? (
          <p>
            Dist: <span className="font-semibold">{formatNumberTick(point.distanceKm, 2)} km</span>
          </p>
        ) : null}
        {metricRows.map((row) => (
          <p key={row.label}>
            {row.label}: <span className="font-semibold">{row.value}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

function SplitMetricTooltip({
  active,
  payload,
  metricKey,
  metricLabel,
  formatValue,
  xAxisMode
}: {
  active?: boolean;
  payload?: Array<{ payload?: CombinedChartPoint }>;
  metricKey: SplitMetricKey;
  metricLabel: string;
  formatValue: (value: number | null) => string;
  xAxisMode: ChartXAxisMode;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }

  const point = payload[0].payload;
  const rawValue = point[metricKey] as number | null;

  return (
    <div style={CHART_TOOLTIP_STYLE} className="min-w-[12rem] p-3 text-sm leading-tight">
      <p className="font-semibold text-foreground">{formatElapsedTooltip(point.elapsedSeconds)}</p>
      <div className="mt-2 space-y-1 text-foreground">
        {xAxisMode === 'distance' ? (
          <p>
            Dist: <span className="font-semibold">{formatNumberTick(point.distanceKm, 2)} km</span>
          </p>
        ) : null}
        {rawValue == null ? null : (
          <p>
            {metricLabel}: <span className="font-semibold">{formatValue(rawValue)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function SplitMetricChart({
  title,
  unitLabel,
  data,
  hasData,
  dataKey,
  color,
  valueLabel,
  valueFormatter,
  yTickFormatter,
  xDomain,
  xAxisMode,
  syncId,
  selectionDomain,
  pauseHighlightSegments,
  zoneHighlightSegments,
  onChartMouseDown,
  onChartMouseMove,
  onChartMouseLeave,
  onChartMouseUp,
  variant = 'line'
}: {
  title: string;
  unitLabel: string;
  data: CombinedChartPoint[];
  hasData: boolean;
  dataKey: SplitMetricKey;
  color: string;
  valueLabel: string;
  valueFormatter: (value: number | null) => string;
  yTickFormatter: (value: number) => string;
  xDomain: ChartZoomDomain;
  xAxisMode: ChartXAxisMode;
  syncId: string;
  selectionDomain?: ChartZoomDomain | null;
  pauseHighlightSegments?: ZoneHighlightSegment[];
  zoneHighlightSegments?: ZoneHighlightSegment[];
  onChartMouseDown?: (event: unknown) => void;
  onChartMouseMove?: (event: unknown) => void;
  onChartMouseLeave?: () => void;
  onChartMouseUp?: (event: unknown) => void;
  variant?: 'line' | 'area';
}) {
  const yDomain = useMemo<[number, number] | undefined>(() => {
    const range = metricRangeForVisibleDomain(
      data,
      xDomain,
      (point) => (xAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point[dataKey] as number | null
    );
    return range ?? undefined;
  }, [data, dataKey, xAxisMode, xDomain]);

  return (
    <div className="rounded-lg border border-border/80 bg-bg/30 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        <p className="text-[11px] text-muted">{unitLabel}</p>
      </div>
      <div className="mt-2 h-40">
        {!hasData ? (
          <p className="text-sm text-muted">No {title.toLowerCase()} data available.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              syncId={syncId}
              margin={{ top: 8, right: 8, left: -6, bottom: 2 }}
              onMouseDown={onChartMouseDown}
              onMouseMove={onChartMouseMove}
              onMouseLeave={onChartMouseLeave}
              onMouseUp={onChartMouseUp}
            >
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                type="number"
                dataKey={xAxisMode === 'distance' ? 'distanceKm' : 'elapsedSeconds'}
                stroke={CHART_AXIS_STROKE}
                tickFormatter={(value) =>
                  xAxisMode === 'distance'
                    ? formatDistanceAxisTick(Number(value))
                    : formatElapsedAxisTick(Number(value))
                }
                tickMargin={8}
                minTickGap={24}
                domain={xDomain}
                allowDataOverflow
              />
              <YAxis
                stroke={CHART_AXIS_STROKE}
                tickFormatter={(value) => yTickFormatter(Number(value))}
                tickMargin={8}
                width={58}
                domain={yDomain ?? ['auto', 'auto']}
                allowDataOverflow={Boolean(yDomain)}
              />
              <Tooltip
                cursor={CHART_TOOLTIP_CURSOR_LINE}
                content={
                  <SplitMetricTooltip
                    metricKey={dataKey}
                    metricLabel={valueLabel}
                    formatValue={valueFormatter}
                    xAxisMode={xAxisMode}
                  />
                }
                wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
                isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
              />
              {selectionDomain ? (
                <ReferenceArea
                  x1={selectionDomain[0]}
                  x2={selectionDomain[1]}
                  fill={CHART_SELECTION_FILL}
                  fillOpacity={CHART_SELECTION_FILL_OPACITY}
                  stroke={CHART_SELECTION_STROKE}
                  strokeOpacity={CHART_SELECTION_STROKE_OPACITY}
                  ifOverflow="extendDomain"
                />
              ) : null}
              {pauseHighlightSegments?.map((segment, index) => (
                <ReferenceArea
                  key={`pause-highlight-${segment.start}-${segment.end}-${index}`}
                  x1={segment.start}
                  x2={segment.end}
                  fill="rgba(148, 163, 184, 0.18)"
                  stroke="rgba(148, 163, 184, 0.28)"
                  ifOverflow="extendDomain"
                />
              ))}
              {zoneHighlightSegments?.map((segment, index) => (
                <ReferenceArea
                  key={`zone-highlight-${segment.start}-${segment.end}-${index}`}
                  x1={segment.start}
                  x2={segment.end}
                  fill="rgba(220, 38, 38, 0.12)"
                  stroke="rgba(220, 38, 38, 0.2)"
                  ifOverflow="extendDomain"
                />
              ))}
              {variant === 'area' ? (
                <Area
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  fill={color}
                  fillOpacity={0.18}
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  activeDot={CHART_LINE_ACTIVE_DOT}
                  isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                />
              ) : (
                <Line
                  type="monotone"
                  dataKey={dataKey}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  activeDot={CHART_LINE_ACTIVE_DOT}
                  isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function HeartRateZonesCard({
  slices,
  trackedSeconds,
  hoveredZoneIndex,
  onHoverZoneChange
}: {
  slices: HeartRateZoneSlice[];
  trackedSeconds: number;
  hoveredZoneIndex: number | null;
  onHoverZoneChange: (zoneIndex: number | null) => void;
}) {
  const nonEmptySlices = slices.filter((slice) => slice.seconds > 0);

  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Heart Rate Zones</h3>
          <p className="mt-1 text-xs text-muted">
            Time in zone based on recorded heart-rate sample intervals, excluding paused time.
          </p>
        </div>
        <p className="text-sm text-muted">
          Tracked HR time: <span className="font-semibold text-foreground">{formatDuration(trackedSeconds)}</span>
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={nonEmptySlices}
                dataKey="seconds"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="52%"
                outerRadius="82%"
                paddingAngle={2}
                stroke="rgba(var(--color-panel), 1)"
                strokeWidth={2}
                isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                onMouseEnter={(entry) => {
                  const slice = entry as HeartRateZoneSlice | undefined;
                  onHoverZoneChange(slice?.zoneIndex ?? null);
                }}
                onMouseLeave={() => onHoverZoneChange(null)}
              >
                {nonEmptySlices.map((slice) => (
                  <Cell
                    key={slice.label}
                    fill={slice.color}
                    fillOpacity={hoveredZoneIndex == null || hoveredZoneIndex === slice.zoneIndex ? 1 : 0.45}
                    strokeWidth={hoveredZoneIndex === slice.zoneIndex ? 3 : 2}
                  />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => formatDuration(Number(value))}
                labelFormatter={(_, payload) => {
                  const entry = payload?.[0]?.payload as HeartRateZoneSlice | undefined;
                  return entry ? `${entry.label} • ${entry.rangeLabel}` : '';
                }}
                contentStyle={CHART_TOOLTIP_STYLE}
                wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
                isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-2">
          {slices.map((slice) => (
            <div
              key={slice.label}
              onMouseEnter={() => onHoverZoneChange(slice.zoneIndex)}
              onMouseLeave={() => onHoverZoneChange(null)}
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                hoveredZoneIndex === slice.zoneIndex
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-border/70 bg-bg/30'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: slice.color, opacity: slice.seconds > 0 ? 1 : 0.35 }}
                  />
                  <span className="text-sm font-medium text-foreground">{slice.label}</span>
                  <span className="truncate text-xs text-muted">{slice.rangeLabel}</span>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-foreground">{formatDuration(slice.seconds)}</p>
                <p className="text-xs text-muted">{(slice.percent * 100).toFixed(1)}%</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function toRouteFeatureCollection(track: TrackPoint[]): FeatureCollection<LineString> {
  const coordinates = track.map((point) => [point.lon, point.lat] as [number, number]);
  if (coordinates.length < 2) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates
        }
      }
    ]
  };
}

function toRouteHoverFeatureCollection(point: RouteHoverCoordinate): FeatureCollection<Point> {
  if (!point) {
    return { type: 'FeatureCollection', features: [] };
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Point',
          coordinates: [point.lon, point.lat]
        }
      }
    ]
  };
}

function fitMapToTrack(map: maplibregl.Map, track: TrackPoint[]) {
  if (track.length === 0) {
    map.jumpTo({
      center: US_DEFAULT_CENTER,
      zoom: US_DEFAULT_ZOOM
    });
    return;
  }

  if (track.length === 1) {
    map.jumpTo({
      center: [track[0].lon, track[0].lat],
      zoom: 14
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds(
    [track[0].lon, track[0].lat],
    [track[0].lon, track[0].lat]
  );
  for (const point of track) {
    bounds.extend([point.lon, point.lat]);
  }

  map.fitBounds(bounds, {
    padding: 40,
    duration: 0,
    maxZoom: 15
  });
}

const ActivityRouteMap = forwardRef<
  ActivityRouteMapHandle,
  {
    track: TrackPoint[];
    reducedComplexity: boolean;
    routeLineColorHex: string;
  }
>(function ActivityRouteMap({ track, reducedComplexity, routeLineColorHex }, ref) {
  const { containerRef, mapRef } = useManagedMapLibre({
    reducedComplexity,
    initialCenter: US_DEFAULT_CENTER,
    initialZoom: US_DEFAULT_ZOOM
  });
  const trackSource = useMemo(() => toRouteFeatureCollection(track), [track]);
  const hoverTargetRef = useRef<RouteHoverCoordinate>(null);
  const hoverDisplayedRef = useRef<RouteHoverCoordinate>(null);
  const hoverAnimationFrameRef = useRef<number | null>(null);
  const hoverLastFrameTimeRef = useRef<number | null>(null);

  const setHoverPointSourceData = (point: RouteHoverCoordinate) => {
    const map = mapRef.current;
    if (!map || !map.getSource(ACTIVITY_ROUTE_HOVER_SOURCE_ID)) {
      return;
    }

    (map.getSource(ACTIVITY_ROUTE_HOVER_SOURCE_ID) as GeoJSONSource).setData(
      toRouteHoverFeatureCollection(point)
    );
  };

  const cancelHoverAnimation = () => {
    if (hoverAnimationFrameRef.current == null) {
      return;
    }

    cancelAnimationFrame(hoverAnimationFrameRef.current);
    hoverAnimationFrameRef.current = null;
  };

  const scheduleHoverAnimation = () => {
    if (hoverAnimationFrameRef.current != null) {
      return;
    }

    hoverAnimationFrameRef.current = requestAnimationFrame((timestamp) => {
      hoverAnimationFrameRef.current = null;

      const target = hoverTargetRef.current;
      const current = hoverDisplayedRef.current;

      if (!target) {
        hoverLastFrameTimeRef.current = null;
        if (current) {
          hoverDisplayedRef.current = null;
          setHoverPointSourceData(null);
        }
        return;
      }

      if (!current) {
        hoverDisplayedRef.current = { ...target };
        hoverLastFrameTimeRef.current = timestamp;
        setHoverPointSourceData(hoverDisplayedRef.current);
        return;
      }

      const previousTimestamp = hoverLastFrameTimeRef.current ?? timestamp;
      hoverLastFrameTimeRef.current = timestamp;
      const dt = Math.max(1, Math.min(64, timestamp - previousTimestamp));
      const alpha = 1 - Math.exp(-dt / ROUTE_HOVER_MARKER_SMOOTHING_MS);

      const nextPoint = {
        lat: current.lat + (target.lat - current.lat) * alpha,
        lon: current.lon + (target.lon - current.lon) * alpha
      };

      const closeToTarget =
        Math.abs(target.lat - nextPoint.lat) < 1e-6 && Math.abs(target.lon - nextPoint.lon) < 1e-6;
      hoverDisplayedRef.current = closeToTarget ? { ...target } : nextPoint;
      setHoverPointSourceData(hoverDisplayedRef.current);

      if (!routeHoverCoordinatesEqual(hoverDisplayedRef.current, hoverTargetRef.current)) {
        scheduleHoverAnimation();
      }
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      setHoverTarget: (coordinate) => {
        const normalized = coordinate ? { ...coordinate } : null;
        if (routeHoverCoordinatesEqual(hoverTargetRef.current, normalized)) {
          return;
        }

        hoverTargetRef.current = normalized;
        if (!normalized) {
          cancelHoverAnimation();
          hoverLastFrameTimeRef.current = null;
          hoverDisplayedRef.current = null;
          setHoverPointSourceData(null);
          return;
        }

        scheduleHoverAnimation();
      },
      clearHoverTarget: () => {
        hoverTargetRef.current = null;
        cancelHoverAnimation();
        hoverLastFrameTimeRef.current = null;
        hoverDisplayedRef.current = null;
        setHoverPointSourceData(null);
      }
    }),
    []
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const syncTrack = () => {
      if (!map.getSource(ACTIVITY_ROUTE_SOURCE_ID)) {
        map.addSource(ACTIVITY_ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: trackSource
        });
      } else {
        (map.getSource(ACTIVITY_ROUTE_SOURCE_ID) as GeoJSONSource).setData(trackSource);
      }

      if (!map.getLayer(ACTIVITY_ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ACTIVITY_ROUTE_LAYER_ID,
          type: 'line',
          source: ACTIVITY_ROUTE_SOURCE_ID,
          paint: {
            'line-color': routeLineColorHex,
            'line-width': 4,
            'line-opacity': 0.95
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          }
        });
      }

      map.setPaintProperty(ACTIVITY_ROUTE_LAYER_ID, 'line-color', routeLineColorHex);
    };

    if (map.isStyleLoaded()) {
      syncTrack();
      return undefined;
    }

    map.once('load', syncTrack);
    return () => {
      map.off('load', syncTrack);
    };
  }, [track, trackSource, reducedComplexity, routeLineColorHex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const syncHoverPointLayer = () => {
      if (!map.getSource(ACTIVITY_ROUTE_HOVER_SOURCE_ID)) {
        map.addSource(ACTIVITY_ROUTE_HOVER_SOURCE_ID, {
          type: 'geojson',
          data: toRouteHoverFeatureCollection(hoverDisplayedRef.current)
        });
      }

      if (!map.getLayer(ACTIVITY_ROUTE_HOVER_OUTER_LAYER_ID)) {
        map.addLayer({
          id: ACTIVITY_ROUTE_HOVER_OUTER_LAYER_ID,
          type: 'circle',
          source: ACTIVITY_ROUTE_HOVER_SOURCE_ID,
          paint: {
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-opacity': 0.95,
            'circle-stroke-width': 2,
            'circle-stroke-color': 'rgba(15, 23, 42, 0.8)'
          }
        });
      }

      if (!map.getLayer(ACTIVITY_ROUTE_HOVER_INNER_LAYER_ID)) {
        map.addLayer({
          id: ACTIVITY_ROUTE_HOVER_INNER_LAYER_ID,
          type: 'circle',
          source: ACTIVITY_ROUTE_HOVER_SOURCE_ID,
          paint: {
            'circle-radius': 3.25,
            'circle-color': routeLineColorHex,
            'circle-opacity': 1
          }
        });
      }

      map.setPaintProperty(ACTIVITY_ROUTE_HOVER_INNER_LAYER_ID, 'circle-color', routeLineColorHex);
      map.moveLayer(ACTIVITY_ROUTE_HOVER_OUTER_LAYER_ID);
      map.moveLayer(ACTIVITY_ROUTE_HOVER_INNER_LAYER_ID);
      setHoverPointSourceData(hoverDisplayedRef.current);
    };

    if (map.isStyleLoaded()) {
      syncHoverPointLayer();
      return undefined;
    }

    map.once('load', syncHoverPointLayer);
    return () => {
      map.off('load', syncHoverPointLayer);
    };
  }, [routeLineColorHex]);

  useEffect(() => {
    hoverTargetRef.current = null;
    hoverDisplayedRef.current = null;
    hoverLastFrameTimeRef.current = null;
    cancelHoverAnimation();
    setHoverPointSourceData(null);
  }, [track]);

  useEffect(
    () => () => {
      cancelHoverAnimation();
    },
    []
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const fitTrack = () => {
      fitMapToTrack(map, track);
    };

    if (map.isStyleLoaded()) {
      fitTrack();
      return undefined;
    }

    map.once('load', fitTrack);
    return () => {
      map.off('load', fitTrack);
    };
  }, [track]);

  return <div ref={containerRef} className="h-full w-full" />;
});

function ReducedComplexityMapToggle({
  enabled,
  onChange
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs backdrop-blur transition-colors ${
        enabled
          ? 'border-accent/60 bg-panel/90 text-foreground'
          : 'border-border bg-panel/80 text-muted hover:text-foreground'
      }`}
    >
      <span
        className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] leading-none ${
          enabled ? 'border-accent bg-accent text-white' : 'border-border bg-bg/90 text-transparent'
        }`}
      >
        ✓
      </span>
      Reduced complexity
    </button>
  );
}

export function ActivityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [chartSamples, setChartSamples] = useState<ActivitySample[]>([]);
  const [heartRateZoneSamples, setHeartRateZoneSamples] = useState<ActivitySample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reducedMapComplexity, setReducedMapComplexity] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>('combined');
  const [selectedChartXAxisMode, setSelectedChartXAxisMode] = useState<ChartXAxisMode>('time');
  const [hidePausedTime, setHidePausedTime] = useState(false);
  const [chartSeriesVisibility, setChartSeriesVisibility] = useState<ChartSeriesVisibility>(() =>
    defaultChartSeriesVisibility()
  );
  const [decouplingMode, setDecouplingMode] = useState<AerobicDecouplingMode>('outdoor');
  const [treadmillSectionOne, setTreadmillSectionOne] = useState<ChartZoomDomain | null>(null);
  const [treadmillSectionTwo, setTreadmillSectionTwo] = useState<ChartZoomDomain | null>(null);
  const [decouplingResult, setDecouplingResult] = useState<AerobicDecouplingResponse>(
    EMPTY_DECOUPLING_RESULT
  );
  const [hoveredHeartRateZoneIndex, setHoveredHeartRateZoneIndex] = useState<number | null>(null);
  const chartSamplesRequestRef = useRef(0);
  const heartRateZoneSamplesRequestRef = useRef(0);
  const decouplingRequestRef = useRef(0);
  const routeMapRef = useRef<ActivityRouteMapHandle | null>(null);
  const accentTheme = useAppStore((state) => state.settings?.accentTheme);
  const chartMaxSamples = useAppStore((state) => state.settings?.chartMaxSamples ?? 2000);
  const chartOutlierRemoval = useAppStore((state) => state.settings?.chartOutlierRemoval ?? true);
  const heartRateZoneUpperBoundsBpm = useAppStore((state) =>
    normalizeHeartRateZoneUpperBounds(state.settings?.heartRateZoneUpperBoundsBpm)
  );
  const accentPalette = useMemo(() => getAccentThemePalette(accentTheme), [accentTheme]);
  const hasGpsTrack = Boolean(detail?.summary.hasGps && detail.track.length > 0);
  const chartXAxisMode: ChartXAxisMode = hasGpsTrack ? selectedChartXAxisMode : 'time';
  const shouldHidePausedTime = chartXAxisMode === 'time' && hidePausedTime;
  const hasPauseSegments = Boolean(detail && detail.pauseSegments.length > 0);
  const isFitRunningActivity = Boolean(
    detail &&
      detail.summary.sourcePath.toLowerCase().endsWith('.fit') &&
      detail.summary.category.toLowerCase() === 'running' &&
      (detail.summary.avgHr != null || detail.summary.minHr != null || detail.summary.maxHr != null)
  );

  useEffect(() => {
    if (!id) {
      return;
    }

    chartSamplesRequestRef.current += 1;
    heartRateZoneSamplesRequestRef.current += 1;
    setChartSamples([]);
    setHeartRateZoneSamples([]);

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await getActivity(Number(id));
        setDetail(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    setChartSeriesVisibility(defaultChartSeriesVisibility(detail.summary.sportType));
    routeMapRef.current?.clearHoverTarget();
  }, [detail?.summary.id, detail?.summary.sportType]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    setSelectedChartXAxisMode(detail.summary.hasGps && detail.track.length > 0 ? 'distance' : 'time');
    setHidePausedTime(!detail.summary.hasGps);
    setDecouplingMode(detail.summary.hasGps ? 'outdoor' : 'treadmill');
    setTreadmillSectionOne(null);
    setTreadmillSectionTwo(null);
    setDecouplingResult(EMPTY_DECOUPLING_RESULT);
  }, [detail]);

  const combinedChart = useMemo<CombinedChartModel>(() => {
    if (!detail) {
      return {
        data: [],
        has: { pace: false, speed: false, heartRate: false, elevation: false, cadence: false, power: false },
        maxDistanceKm: 0,
        maxElapsedSeconds: 0
      };
    }

    const totalDistanceM = Math.max(detail.summary.distanceM, 0);
    const totalDurationSeconds = Math.max(
      shouldHidePausedTime ? detail.summary.movingDurationSeconds : detail.summary.durationSeconds,
      1
    );
    let lastDistanceM = 0;
    let previousElevationPoint: { distanceM: number; elevationM: number } | null = null;

    const basePoints: Array<
      Omit<
        CombinedChartPoint,
        'pacePlot' | 'speedPlot' | 'heartRatePlot' | 'cadencePlot' | 'powerPlot' | 'elevationPlot'
      >
    > =
      chartSamples.map((sample) => {
        const estimatedDistanceM =
          totalDistanceM > 0 ? (sample.elapsedSeconds / totalDurationSeconds) * totalDistanceM : lastDistanceM;
        const distanceM = Math.max(lastDistanceM, sample.distanceM ?? estimatedDistanceM);
        lastDistanceM = distanceM;

        const speedKmh = sample.speedMps != null ? sample.speedMps * 3.6 : null;
        const paceSecondsPerKm =
          sample.speedMps != null && sample.speedMps > 0 ? 1000 / sample.speedMps : null;

        let gradePct: number | null = null;
        if (
          sample.altitudeM != null &&
          previousElevationPoint != null &&
          distanceM - previousElevationPoint.distanceM >= 5
        ) {
          gradePct = ((sample.altitudeM - previousElevationPoint.elevationM) / (distanceM - previousElevationPoint.distanceM)) * 100;
        }
        if (sample.altitudeM != null) {
          previousElevationPoint = { distanceM, elevationM: sample.altitudeM };
        }

        return {
          distanceKm: distanceM / 1000,
          distanceM,
          elapsedSeconds: sample.elapsedSeconds,
          lat: sample.lat,
          lon: sample.lon,
          speedKmh,
          paceSecondsPerKm,
          heartRate: sample.heartRate,
          cadence: sample.cadence,
          powerWatts: sample.powerWatts,
          elevationM: sample.altitudeM,
          gradePct
        };
      });

    const filteredBasePoints = chartOutlierRemoval ? removeCombinedChartOutliers(basePoints) : basePoints;

    const paceRange = metricRange(filteredBasePoints.map((point) => point.paceSecondsPerKm));
    const speedRange = metricRange(filteredBasePoints.map((point) => point.speedKmh));
    const heartRateRange = metricRange(filteredBasePoints.map((point) => point.heartRate));
    const cadenceRange = metricRange(filteredBasePoints.map((point) => point.cadence));
    const powerRange = metricRange(filteredBasePoints.map((point) => point.powerWatts));
    const elevationRange = metricRange(filteredBasePoints.map((point) => point.elevationM));
    const has = {
      pace: paceRange != null,
      speed: speedRange != null,
      heartRate: heartRateRange != null,
      cadence: cadenceRange != null,
      power: powerRange != null,
      elevation: elevationRange != null
    } satisfies Record<ChartSeriesKey, boolean>;
    const visibleSeries = COMBINED_CHART_SERIES_ORDER.filter(
      (key) => has[key] && chartSeriesVisibility[key]
    );
    const bands = buildCombinedChartBands(visibleSeries);

    const data: CombinedChartPoint[] = filteredBasePoints.map((point) => ({
      ...point,
      pacePlot: normalizeToBand(point.paceSecondsPerKm, paceRange, bands.pace, true),
      speedPlot: normalizeToBand(point.speedKmh, speedRange, bands.speed),
      heartRatePlot: normalizeToBand(point.heartRate, heartRateRange, bands.heartRate),
      cadencePlot: normalizeToBand(point.cadence, cadenceRange, bands.cadence),
      powerPlot: normalizeToBand(point.powerWatts, powerRange, bands.power),
      elevationPlot: normalizeToBand(point.elevationM, elevationRange, bands.elevation)
    }));

    const maxDistanceKm = Math.max(
      ...data.map((point) => point.distanceKm),
      totalDistanceM > 0 ? totalDistanceM / 1000 : 0
    );
    const maxElapsedSeconds = Math.max(
      ...data.map((point) => point.elapsedSeconds),
      totalDurationSeconds
    );

    return {
      data,
      has,
      maxDistanceKm,
      maxElapsedSeconds
    };
  }, [chartOutlierRemoval, chartSamples, detail, chartSeriesVisibility, shouldHidePausedTime]);

  const fullChartXAxisDomain = useMemo<ChartZoomDomain>(() => {
    if (chartXAxisMode === 'time') {
      const summaryDurationSeconds = detail
        ? Math.max(
            0,
            shouldHidePausedTime ? detail.summary.movingDurationSeconds : detail.summary.durationSeconds
          )
        : 0;
      return [0, Math.max(60, summaryDurationSeconds, combinedChart.maxElapsedSeconds)];
    }

    const summaryDistanceKm = detail ? Math.max(0, detail.summary.distanceM) / 1000 : 0;
    return [0, Math.max(0.1, summaryDistanceKm, combinedChart.maxDistanceKm)];
  }, [chartXAxisMode, combinedChart.maxDistanceKm, combinedChart.maxElapsedSeconds, detail, shouldHidePausedTime]);
  const minChartZoomSpan = chartXAxisMode === 'distance' ? CHART_MIN_ZOOM_SPAN_KM : CHART_MIN_ZOOM_SPAN_SECONDS;
  const chartXAxisValues = useMemo(
    () =>
      combinedChart.data.map((point) =>
        chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds
      ),
    [chartXAxisMode, combinedChart.data]
  );
  const chartZoom = usePlotDragZoom<number>({
    parseLabel: parseNumberChartLabel,
    compareValues: (left, right) => left - right,
    values: chartXAxisValues,
    normalizeDomain: (anchor, current) => {
      const min = Math.max(0, Math.min(anchor, current));
      const max = Math.min(fullChartXAxisDomain[1], Math.max(anchor, current));

      if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < minChartZoomSpan) {
        return null;
      }

      return [min, max];
    },
    areValuesEqual: (left, right) => Math.abs(left - right) < 1e-6,
    areDomainsEqual: (left, right) =>
      areDomainsEqual(left, right, (first, second) => Math.abs(first - second) < Number.EPSILON * 100),
    onPointerMove: (event) => {
      routeMapRef.current?.setHoverTarget(readHoveredRouteCoordinate(event));
    }
  });

  const chartZoomDomain = chartZoom.zoomDomain;
  const chartSelectionDomain = chartZoom.selectionDomain;
  const setChartZoomDomain = chartZoom.setZoomDomain;
  const activeChartXAxisDomain = chartZoomDomain ?? fullChartXAxisDomain;
  const chartSampleDistanceZoomDomain = chartXAxisMode === 'distance' ? chartZoomDomain : null;

  useEffect(() => {
    decouplingRequestRef.current += 1;
    const requestId = decouplingRequestRef.current;

    if (!detail || !isFitRunningActivity) {
      setDecouplingResult(EMPTY_DECOUPLING_RESULT);
      return;
    }

    let outdoorRange: AerobicDecouplingRange | undefined;
    if (decouplingMode === 'outdoor' && chartZoomDomain) {
      outdoorRange = {
        axis:
          chartXAxisMode === 'distance'
            ? 'distance'
            : shouldHidePausedTime
              ? 'movingTime'
              : 'elapsedTime',
        min: chartZoomDomain[0],
        max: chartZoomDomain[1]
      };
    }

    if (
      decouplingMode === 'treadmill' &&
      (!treadmillSectionOne ||
        !treadmillSectionTwo ||
        treadmillSectionTwo[0] < treadmillSectionOne[1])
    ) {
      setDecouplingResult(EMPTY_DECOUPLING_RESULT);
      return;
    }

    setDecouplingResult(EMPTY_DECOUPLING_RESULT);
    const loadDecoupling = async () => {
      try {
        const response = await getAerobicDecoupling({
          activityId: detail.summary.id,
          mode: decouplingMode,
          outdoorRange,
          treadmillSectionOne:
            decouplingMode === 'treadmill' && treadmillSectionOne
              ? { axis: 'movingTime', min: treadmillSectionOne[0], max: treadmillSectionOne[1] }
              : undefined,
          treadmillSectionTwo:
            decouplingMode === 'treadmill' && treadmillSectionTwo
              ? { axis: 'movingTime', min: treadmillSectionTwo[0], max: treadmillSectionTwo[1] }
              : undefined
        });
        if (decouplingRequestRef.current === requestId) {
          setDecouplingResult(response);
        }
      } catch (err) {
        if (decouplingRequestRef.current === requestId) {
          setDecouplingResult(EMPTY_DECOUPLING_RESULT);
          console.error('Failed to calculate aerobic decoupling', err);
        }
      }
    };

    void loadDecoupling();
  }, [
    chartXAxisMode,
    chartZoomDomain,
    decouplingMode,
    detail,
    isFitRunningActivity,
    shouldHidePausedTime,
    treadmillSectionOne,
    treadmillSectionTwo
  ]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    setChartZoomDomain(null);
    chartZoom.clearSelection();
  }, [chartXAxisMode, chartZoom.clearSelection, detail?.summary.id, setChartZoomDomain, shouldHidePausedTime]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const query = {
      distanceMinKm: chartSampleDistanceZoomDomain?.[0],
      distanceMaxKm: chartSampleDistanceZoomDomain?.[1],
      maxSamples: chartMaxSamples,
      hidePauses: shouldHidePausedTime
    };
    const requestId = chartSamplesRequestRef.current + 1;
    chartSamplesRequestRef.current = requestId;

    const loadSamples = async () => {
      try {
        const response = await getActivitySamples(detail.summary.id, query);
        if (chartSamplesRequestRef.current !== requestId) {
          return;
        }

        setChartSamples(response.samples);
      } catch (err) {
        if (chartSamplesRequestRef.current !== requestId) {
          return;
        }
        console.error('Failed to refresh chart samples', err);
      }
    };

    void loadSamples();
  }, [chartMaxSamples, chartSampleDistanceZoomDomain, detail?.summary.id, shouldHidePausedTime]);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const hasHeartRateSummary =
      detail.summary.avgHr != null || detail.summary.minHr != null || detail.summary.maxHr != null;
    if (!hasHeartRateSummary) {
      setHeartRateZoneSamples([]);
      return;
    }

    const requestId = heartRateZoneSamplesRequestRef.current + 1;
    heartRateZoneSamplesRequestRef.current = requestId;

    const loadZoneSamples = async () => {
      try {
        const response = await getActivitySamples(detail.summary.id, { hidePauses: true });
        if (heartRateZoneSamplesRequestRef.current !== requestId) {
          return;
        }
        setHeartRateZoneSamples(response.samples);
      } catch (err) {
        if (heartRateZoneSamplesRequestRef.current !== requestId) {
          return;
        }
        console.error('Failed to load heart rate zone samples', err);
      }
    };

    void loadZoneSamples();
  }, [detail?.summary.avgHr, detail?.summary.id, detail?.summary.maxHr, detail?.summary.minHr]);

  const heartRateZoneBreakdown = useMemo(
    () => buildHeartRateZoneBreakdown(heartRateZoneSamples, heartRateZoneUpperBoundsBpm),
    [heartRateZoneSamples, heartRateZoneUpperBoundsBpm]
  );
  const heartRateZoneHighlightSegments = useMemo(
    () =>
      buildHeartRateZoneHighlightSegments(
        combinedChart.data,
        chartXAxisMode,
        activeChartXAxisDomain,
        hoveredHeartRateZoneIndex,
        heartRateZoneUpperBoundsBpm
      ),
    [
      activeChartXAxisDomain,
      chartXAxisMode,
      combinedChart.data,
      heartRateZoneUpperBoundsBpm,
      hoveredHeartRateZoneIndex
    ]
  );
  const pauseHighlightSegments = useMemo<ZoneHighlightSegment[]>(
    () =>
      chartXAxisMode === 'time' && !shouldHidePausedTime && detail
        ? detail.pauseSegments
            .map((segment) => ({
              start: Math.max(segment.startElapsedSeconds, activeChartXAxisDomain[0]),
              end: Math.min(segment.endElapsedSeconds, activeChartXAxisDomain[1])
            }))
            .filter((segment) => segment.end > segment.start)
        : [],
    [activeChartXAxisDomain, chartXAxisMode, detail, shouldHidePausedTime]
  );

  const combinedChartDisplayData = useMemo<CombinedChartPoint[]>(() => {
    if (combinedChart.data.length === 0) {
      return combinedChart.data;
    }

    const visibleSeries = COMBINED_CHART_SERIES_ORDER.filter(
      (key) => combinedChart.has[key] && chartSeriesVisibility[key]
    );
    const bands = buildCombinedChartBands(visibleSeries);

    const paceRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.paceSecondsPerKm
    );
    const speedRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.speedKmh
    );
    const heartRateRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.heartRate
    );
    const cadenceRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.cadence
    );
    const powerRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.powerWatts
    );
    const elevationRange = metricRangeForVisibleDomain(
      combinedChart.data,
      activeChartXAxisDomain,
      (point) => (chartXAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds),
      (point) => point.elevationM
    );

    return combinedChart.data.map((point) => ({
      ...point,
      pacePlot: normalizeToBand(point.paceSecondsPerKm, paceRange, bands.pace, true),
      speedPlot: normalizeToBand(point.speedKmh, speedRange, bands.speed),
      heartRatePlot: normalizeToBand(point.heartRate, heartRateRange, bands.heartRate),
      cadencePlot: normalizeToBand(point.cadence, cadenceRange, bands.cadence),
      powerPlot: normalizeToBand(point.powerWatts, powerRange, bands.power),
      elevationPlot: normalizeToBand(point.elevationM, elevationRange, bands.elevation)
    }));
  }, [activeChartXAxisDomain, chartSeriesVisibility, chartXAxisMode, combinedChart.data, combinedChart.has]);

  const handleChartMouseDown = chartZoom.onMouseDown;
  const handleChartMouseMove = chartZoom.onMouseMove;
  const handleChartMouseUp = chartZoom.onMouseUp;
  const handleChartMouseLeave = () => {
    routeMapRef.current?.clearHoverTarget();
    chartZoom.onMouseLeave();
  };
  const handleDecouplingModeChange = (mode: AerobicDecouplingMode) => {
    setDecouplingMode(mode);
    setTreadmillSectionOne(null);
    setTreadmillSectionTwo(null);
    setDecouplingResult(EMPTY_DECOUPLING_RESULT);
    setChartZoomDomain(null);
    chartZoom.clearSelection();
    if (mode === 'treadmill') {
      setSelectedChartXAxisMode('time');
      setHidePausedTime(true);
    }
  };
  const captureTreadmillSection = (section: 1 | 2) => {
    if (!chartZoomDomain) {
      return;
    }
    if (section === 1) {
      setTreadmillSectionOne(chartZoomDomain);
    } else {
      setTreadmillSectionTwo(chartZoomDomain);
    }
    setChartZoomDomain(null);
    chartZoom.clearSelection();
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading activity...</p>;
  }

  if (error) {
    return <p className="rounded-lg bg-accent/20 p-3 text-sm text-accent">{error}</p>;
  }

  if (!detail) {
    return <p className="text-sm text-muted">Activity not found.</p>;
  }

  const navigationState = location.state as { fromPath?: string; fromLabel?: string } | null;
  const backPath = navigationState?.fromPath ?? '/activities';
  const backLabel = navigationState?.fromLabel ?? 'Back to Activities';
  const backToAnalytics = backPath === '/analytics';

  const showDistance = detail.summary.distanceM > 0;
  const showElevationGain = detail.summary.elevationGainM > 0;
  const showAvgSpeedPace = detail.summary.avgSpeedMps != null && detail.summary.avgSpeedMps > 0;
  const hasAnyHeartRate =
    detail.summary.avgHr != null || detail.summary.minHr != null || detail.summary.maxHr != null;
  const pausedDurationSeconds = Math.max(
    0,
    detail.summary.durationSeconds - detail.summary.movingDurationSeconds
  );
  const showPausedTime = hasPauseSegments && pausedDurationSeconds > 0.5;
  const chartTitle =
    chartXAxisMode === 'distance'
      ? 'Performance vs Distance'
      : shouldHidePausedTime
        ? 'Performance vs Moving Time'
        : 'Performance vs Elapsed Time';
  const chartXAxisDescription =
    chartXAxisMode === 'distance'
      ? 'X-axis uses kilometers.'
      : shouldHidePausedTime
        ? 'X-axis uses moving time with paused segments collapsed.'
        : 'X-axis uses elapsed time with paused segments visible.';

  let heartRateValue: string | null = null;
  let heartRateSubLabel: string | undefined;

  if (hasAnyHeartRate) {
    if (detail.summary.avgHr != null) {
      heartRateValue = `Avg ${Math.round(detail.summary.avgHr)} bpm`;
      const heartRateDetails = [
        detail.summary.minHr != null ? `Min ${Math.round(detail.summary.minHr)} bpm` : null,
        detail.summary.maxHr != null ? `Max ${Math.round(detail.summary.maxHr)} bpm` : null
      ].filter((part): part is string => part != null);
      heartRateSubLabel = heartRateDetails.length > 0 ? heartRateDetails.join(' · ') : undefined;
    } else if (detail.summary.minHr != null && detail.summary.maxHr != null) {
      heartRateValue = `${Math.round(detail.summary.minHr)}-${Math.round(detail.summary.maxHr)} bpm`;
    } else if (detail.summary.minHr != null) {
      heartRateValue = `Min ${Math.round(detail.summary.minHr)} bpm`;
    } else if (detail.summary.maxHr != null) {
      heartRateValue = `Max ${Math.round(detail.summary.maxHr)} bpm`;
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Activity Detail</p>
          <h2 className="mt-2 text-3xl font-semibold text-foreground">{detail.summary.title}</h2>
          <p className="mt-1 text-sm text-muted">
            {detail.summary.category} · {detail.summary.sportType} · {formatDateTime(detail.summary.activityStart)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (backToAnalytics && window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate(backPath);
          }}
          className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          {backLabel}
        </button>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 space-y-6 xl:order-1">
          {hasGpsTrack ? (
            <section className="overflow-hidden rounded-xl border border-border bg-panel">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-lg font-semibold text-foreground">Route</h3>
              </div>
              <MaximizableMapFrame
                label="route map"
                collapsedHeightClassName="h-96"
                topLeftActions={
                  <ReducedComplexityMapToggle
                    enabled={reducedMapComplexity}
                    onChange={setReducedMapComplexity}
                  />
                }
              >
                <ActivityRouteMap
                  ref={routeMapRef}
                  track={detail.track}
                  reducedComplexity={reducedMapComplexity}
                  routeLineColorHex={accentPalette.routeLineHex}
                />
              </MaximizableMapFrame>
            </section>
          ) : null}

          <section className="select-none rounded-xl border border-border bg-panel p-4">
            <div className="space-y-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground">{chartTitle}</h3>
                <p className="mt-1 text-xs text-muted">
                  {chartXAxisDescription}{' '}
                  Drag across a region to zoom. Y-scales auto-resize to the visible range. Click once on a chart to reset the zoom.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                {chartMode === 'combined' ? (
                  <div className="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-2">
                    <SeriesToggle
                      label="Power"
                      color={CHART_LINE_COLORS.power}
                      enabled={chartSeriesVisibility.power}
                      disabled={!combinedChart.has.power}
                      onToggle={() => setChartSeriesVisibility((current) => ({ ...current, power: !current.power }))}
                    />
                    <SeriesToggle
                      label="Cadence"
                      color={CHART_LINE_COLORS.cadence}
                      enabled={chartSeriesVisibility.cadence}
                      disabled={!combinedChart.has.cadence}
                      onToggle={() =>
                        setChartSeriesVisibility((current) => ({ ...current, cadence: !current.cadence }))
                      }
                    />
                    <SeriesToggle
                      label="Elevation"
                      color={CHART_LINE_COLORS.elevation}
                      enabled={chartSeriesVisibility.elevation}
                      disabled={!combinedChart.has.elevation}
                      onToggle={() =>
                        setChartSeriesVisibility((current) => ({ ...current, elevation: !current.elevation }))
                      }
                    />
                    <SeriesToggle
                      label="Pace"
                      color={CHART_LINE_COLORS.pace}
                      enabled={chartSeriesVisibility.pace}
                      disabled={!combinedChart.has.pace}
                      onToggle={() => setChartSeriesVisibility((current) => ({ ...current, pace: !current.pace }))}
                    />
                    <SeriesToggle
                      label="Heart Rate"
                      color={CHART_LINE_COLORS.heartRate}
                      enabled={chartSeriesVisibility.heartRate}
                      disabled={!combinedChart.has.heartRate}
                      onToggle={() =>
                        setChartSeriesVisibility((current) => ({ ...current, heartRate: !current.heartRate }))
                      }
                    />
                    <SeriesToggle
                      label="Speed"
                      color={CHART_LINE_COLORS.speed}
                      enabled={chartSeriesVisibility.speed}
                      disabled={!combinedChart.has.speed}
                      onToggle={() => setChartSeriesVisibility((current) => ({ ...current, speed: !current.speed }))}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-start justify-end gap-2">
                  {hasPauseSegments &&
                  chartXAxisMode === 'time' &&
                  (!isFitRunningActivity || decouplingMode !== 'treadmill') ? (
                    <div className="shrink-0">
                      <PauseVisibilityToggle hidePauses={hidePausedTime} onChange={setHidePausedTime} />
                    </div>
                  ) : null}
                  {hasGpsTrack ? (
                    <div className="shrink-0">
                      <XAxisModeToggle
                        mode={chartXAxisMode}
                        showDistance={hasGpsTrack}
                        onChange={setSelectedChartXAxisMode}
                      />
                    </div>
                  ) : null}
                  <div className="shrink-0">
                    <ChartModeToggle mode={chartMode} onChange={setChartMode} />
                  </div>
                </div>
              </div>
            </div>

            {isFitRunningActivity ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <DecouplingModeToggle mode={decouplingMode} onChange={handleDecouplingModeChange} />
                  {decouplingMode === 'treadmill' ? (
                    <>
                      <button
                        type="button"
                        disabled={!chartZoomDomain}
                        onClick={() => captureTreadmillSection(1)}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted enabled:hover:text-foreground disabled:opacity-50"
                      >
                        Set Section 1{treadmillSectionOne ? ' ✓' : ''}
                      </button>
                      <button
                        type="button"
                        disabled={!chartZoomDomain}
                        onClick={() => captureTreadmillSection(2)}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted enabled:hover:text-foreground disabled:opacity-50"
                      >
                        Set Section 2{treadmillSectionTwo ? ' ✓' : ''}
                      </button>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm font-medium text-foreground">
                  {decouplingMode === 'outdoor' && decouplingResult.paceHrDecouplingPct != null ? (
                    <span>
                      Pace–HR decoupling: {formatDriftPercentage(decouplingResult.paceHrDecouplingPct)}
                    </span>
                  ) : null}
                  {decouplingResult.heartRateDriftPct != null ? (
                    <span>Heart Rate Drift: {formatDriftPercentage(decouplingResult.heartRateDriftPct)}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {chartMode === 'combined' ? (
              <>
                <div className="mt-3 h-72">
                  {combinedChart.data.length === 0 ? (
                    <p className="text-sm text-muted">No chart samples available.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={combinedChartDisplayData}
                        margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                        onMouseDown={handleChartMouseDown}
                        onMouseMove={handleChartMouseMove}
                        onMouseLeave={handleChartMouseLeave}
                        onMouseUp={handleChartMouseUp}
                      >
                        <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
                        <XAxis
                          type="number"
                          dataKey={chartXAxisMode === 'distance' ? 'distanceKm' : 'elapsedSeconds'}
                          stroke={CHART_AXIS_STROKE}
                          tickFormatter={(value) =>
                            chartXAxisMode === 'distance'
                              ? formatDistanceAxisTick(Number(value))
                              : formatElapsedAxisTick(Number(value))
                          }
                          tickMargin={8}
                          minTickGap={24}
                          domain={activeChartXAxisDomain}
                          allowDataOverflow
                        />
                        <YAxis hide type="number" domain={COMBINED_CHART_DOMAIN} />
                        <Tooltip
                          cursor={CHART_TOOLTIP_CURSOR_LINE}
                          content={<CombinedChartTooltip xAxisMode={chartXAxisMode} />}
                          wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
                          isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                        />
                        {chartSelectionDomain ? (
                          <ReferenceArea
                            x1={chartSelectionDomain[0]}
                            x2={chartSelectionDomain[1]}
                            fill={CHART_SELECTION_FILL}
                            fillOpacity={CHART_SELECTION_FILL_OPACITY}
                            stroke={CHART_SELECTION_STROKE}
                            strokeOpacity={CHART_SELECTION_STROKE_OPACITY}
                            ifOverflow="extendDomain"
                          />
                        ) : null}
                        {pauseHighlightSegments.map((segment, index) => (
                          <ReferenceArea
                            key={`combined-pause-${segment.start}-${segment.end}-${index}`}
                            x1={segment.start}
                            x2={segment.end}
                            fill="rgba(148, 163, 184, 0.18)"
                            stroke="rgba(148, 163, 184, 0.28)"
                            ifOverflow="extendDomain"
                          />
                        ))}
                        {heartRateZoneHighlightSegments.map((segment, index) => (
                          <ReferenceArea
                            key={`combined-zone-${segment.start}-${segment.end}-${index}`}
                            x1={segment.start}
                            x2={segment.end}
                            fill="rgba(220, 38, 38, 0.12)"
                            stroke="rgba(220, 38, 38, 0.2)"
                            ifOverflow="extendDomain"
                          />
                        ))}

                        {chartSeriesVisibility.elevation && combinedChart.has.elevation ? (
                          <Area
                            type="monotone"
                            dataKey="elevationPlot"
                            stroke="rgba(119, 192, 67, 0.45)"
                            fill="rgba(148, 163, 184, 0.24)"
                            fillOpacity={1}
                            strokeWidth={1}
                            dot={false}
                            activeDot={false}
                            connectNulls
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}

                        {chartSeriesVisibility.pace && combinedChart.has.pace ? (
                          <Line
                            type="monotone"
                            dataKey="pacePlot"
                            stroke={CHART_LINE_COLORS.pace}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            activeDot={CHART_LINE_ACTIVE_DOT}
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}

                        {chartSeriesVisibility.heartRate && combinedChart.has.heartRate ? (
                          <Line
                            type="monotone"
                            dataKey="heartRatePlot"
                            stroke={CHART_LINE_COLORS.heartRate}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            activeDot={CHART_LINE_ACTIVE_DOT}
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}

                        {chartSeriesVisibility.cadence && combinedChart.has.cadence ? (
                          <Line
                            type="monotone"
                            dataKey="cadencePlot"
                            stroke={CHART_LINE_COLORS.cadence}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            activeDot={CHART_LINE_ACTIVE_DOT}
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}

                        {chartSeriesVisibility.power && combinedChart.has.power ? (
                          <Line
                            type="monotone"
                            dataKey="powerPlot"
                            stroke={CHART_LINE_COLORS.power}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            activeDot={CHART_LINE_ACTIVE_DOT}
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}

                        {chartSeriesVisibility.speed && combinedChart.has.speed ? (
                          <Line
                            type="monotone"
                            dataKey="speedPlot"
                            stroke={CHART_LINE_COLORS.speed}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                            activeDot={CHART_LINE_ACTIVE_DOT}
                            isAnimationActive={CHART_IS_ANIMATION_ACTIVE}
                          />
                        ) : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted">
                  Visible series are normalized into adaptive visual bands and re-scaled to the current zoom window; hover to view exact values.
                </p>
              </>
            ) : (
              <div className="mt-4 space-y-4">
                {combinedChart.has.pace ? (
                  <SplitMetricChart
                    title="Pace"
                    unitLabel="min/km"
                    data={combinedChart.data}
                    hasData={combinedChart.has.pace}
                    dataKey="paceSecondsPerKm"
                    color={CHART_LINE_COLORS.pace}
                    valueLabel="Pace"
                    valueFormatter={formatPaceSeconds}
                    yTickFormatter={formatPaceTick}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                  />
                ) : null}
                {combinedChart.has.speed ? (
                  <SplitMetricChart
                    title="Speed"
                    unitLabel="km/h"
                    data={combinedChart.data}
                    hasData={combinedChart.has.speed}
                    dataKey="speedKmh"
                    color={CHART_LINE_COLORS.speed}
                    valueLabel="Speed"
                    valueFormatter={(value) =>
                      value == null ? 'n/a' : `${formatNumberTick(value, 1)} km/h`
                    }
                    yTickFormatter={(value) => formatNumberTick(value, 1)}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                  />
                ) : null}
                {combinedChart.has.heartRate ? (
                  <SplitMetricChart
                    title="Heart Rate"
                    unitLabel="bpm"
                    data={combinedChart.data}
                    hasData={combinedChart.has.heartRate}
                    dataKey="heartRate"
                    color={CHART_LINE_COLORS.heartRate}
                    valueLabel="Heart rate"
                    valueFormatter={(value) => (value == null ? 'n/a' : `${Math.round(value)} bpm`)}
                    yTickFormatter={(value) => `${Math.round(value)}`}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                  />
                ) : null}
                {combinedChart.has.cadence ? (
                  <SplitMetricChart
                    title="Cadence"
                    unitLabel="rpm"
                    data={combinedChart.data}
                    hasData={combinedChart.has.cadence}
                    dataKey="cadence"
                    color={CHART_LINE_COLORS.cadence}
                    valueLabel="Cadence"
                    valueFormatter={(value) => (value == null ? 'n/a' : `${Math.round(value)} rpm`)}
                    yTickFormatter={(value) => `${Math.round(value)}`}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                  />
                ) : null}
                {combinedChart.has.power ? (
                  <SplitMetricChart
                    title="Power"
                    unitLabel="W"
                    data={combinedChart.data}
                    hasData={combinedChart.has.power}
                    dataKey="powerWatts"
                    color={CHART_LINE_COLORS.power}
                    valueLabel="Power"
                    valueFormatter={(value) => (value == null ? 'n/a' : `${Math.round(value)} W`)}
                    yTickFormatter={(value) => `${Math.round(value)}`}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                  />
                ) : null}
                {combinedChart.has.elevation ? (
                  <SplitMetricChart
                    title="Elevation"
                    unitLabel="m"
                    data={combinedChart.data}
                    hasData={combinedChart.has.elevation}
                    dataKey="elevationM"
                    color={CHART_LINE_COLORS.elevation}
                    valueLabel="Elevation"
                    valueFormatter={(value) => (value == null ? 'n/a' : `${Math.round(value)} m`)}
                    yTickFormatter={(value) => `${Math.round(value)}`}
                    xDomain={activeChartXAxisDomain}
                    xAxisMode={chartXAxisMode}
                    syncId={`activity-${chartXAxisMode}-split-charts`}
                    selectionDomain={chartSelectionDomain}
                    pauseHighlightSegments={pauseHighlightSegments}
                    zoneHighlightSegments={heartRateZoneHighlightSegments}
                    onChartMouseDown={handleChartMouseDown}
                    onChartMouseMove={handleChartMouseMove}
                    onChartMouseLeave={handleChartMouseLeave}
                    onChartMouseUp={handleChartMouseUp}
                    variant="area"
                  />
                ) : null}
                {!combinedChart.has.pace &&
                !combinedChart.has.speed &&
                !combinedChart.has.heartRate &&
                !combinedChart.has.cadence &&
                !combinedChart.has.power &&
                !combinedChart.has.elevation ? (
                  <p className="rounded-lg border border-border/70 bg-bg/30 p-4 text-sm text-muted">
                    No chart samples available.
                  </p>
                ) : null}
              </div>
            )}
          </section>

          {heartRateZoneBreakdown ? (
            <HeartRateZonesCard
              slices={heartRateZoneBreakdown.slices}
              trackedSeconds={heartRateZoneBreakdown.trackedSeconds}
              hoveredZoneIndex={hoveredHeartRateZoneIndex}
              onHoverZoneChange={setHoveredHeartRateZoneIndex}
            />
          ) : null}
        </div>

        <aside className="order-1 xl:order-2">
          <div className="space-y-4 xl:sticky xl:top-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <MetricCard label="Duration" value={formatDuration(detail.summary.durationSeconds)} />
              <MetricCard
                label="Moving Time"
                value={formatDuration(detail.summary.movingDurationSeconds)}
              />
              {showPausedTime ? (
                <MetricCard
                  label="Paused Time"
                  value={formatDuration(pausedDurationSeconds)}
                  subLabel={
                    detail.pauseSegments.length === 1
                      ? '1 manual pause'
                      : `${detail.pauseSegments.length} manual pauses`
                  }
                />
              ) : null}
              {showDistance ? (
                <MetricCard label="Distance" value={formatDistanceKm(detail.summary.distanceM)} />
              ) : null}
              {showAvgSpeedPace ? (
                <MetricCard
                  label="Avg Speed / Pace"
                  value={`${formatSpeedKmh(detail.summary.avgSpeedMps)} · ${formatPaceMinKm(detail.summary.avgSpeedMps)}`}
                />
              ) : null}
              {showElevationGain ? (
                <MetricCard
                  label="Elevation Gain"
                  value={`${Math.round(detail.summary.elevationGainM)} m`}
                />
              ) : null}
              {heartRateValue ? (
                <MetricCard label="Heart Rate" value={heartRateValue} subLabel={heartRateSubLabel} />
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
