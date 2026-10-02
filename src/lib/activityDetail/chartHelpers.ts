import { formatDuration } from '@/lib/format';
import { heartRateZoneIndexForBpm } from '@/lib/activityDetail/activityMetrics';

const COMBINED_CHART_OUTER_PADDING = 3;
const COMBINED_CHART_BAND_GAP = 4;

export const CHART_LINE_COLORS = {
  speed: '#2563EB',
  pace: '#2563EB',
  heartRate: '#DC2626',
  elevation: '#77C043',
  cadence: '#F59E0B',
  power: '#bd08ff'
} as const;

export const COMBINED_CHART_DOMAIN: [number, number] = [0, 100];
export const COMBINED_CHART_SERIES_ORDER: ChartSeriesKey[] = [
  'power',
  'speed',
  'heartRate',
  'cadence',
  'pace',
  'elevation'
];
export const CHART_MIN_ZOOM_SPAN_KM = 0.01;
export const CHART_MIN_ZOOM_SPAN_SECONDS = 15;

export type ChartSeriesKey = 'pace' | 'speed' | 'heartRate' | 'elevation' | 'cadence' | 'power';
export type SplitMetricKey =
  | 'paceSecondsPerKm'
  | 'speedKmh'
  | 'heartRate'
  | 'elevationM'
  | 'cadence'
  | 'powerWatts';
export type ChartMode = 'combined' | 'split';
export type ChartXAxisMode = 'distance' | 'time';

export type ChartSeriesVisibility = Record<ChartSeriesKey, boolean>;
export type ChartBand = { min: number; max: number };
export type ChartZoomDomain = [number, number];
export type RouteHoverCoordinate = { lat: number; lon: number } | null;
export type ZoneHighlightSegment = { start: number; end: number };

export interface CombinedChartPoint {
  distanceKm: number;
  distanceM: number;
  elapsedSeconds: number;
  lat: number | null;
  lon: number | null;
  speedKmh: number | null;
  paceSecondsPerKm: number | null;
  heartRate: number | null;
  cadence: number | null;
  powerWatts: number | null;
  elevationM: number | null;
  gradePct: number | null;
  pacePlot: number | null;
  speedPlot: number | null;
  heartRatePlot: number | null;
  cadencePlot: number | null;
  powerPlot: number | null;
  elevationPlot: number | null;
}

export type CombinedChartBasePoint = Omit<
  CombinedChartPoint,
  'pacePlot' | 'speedPlot' | 'heartRatePlot' | 'cadencePlot' | 'powerPlot' | 'elevationPlot'
>;

export interface CombinedChartModel {
  data: CombinedChartPoint[];
  has: Record<ChartSeriesKey, boolean>;
  maxDistanceKm: number;
  maxElapsedSeconds: number;
}

type OutlierBounds = {
  min?: number;
  max?: number;
};

const OUTLIER_BOUNDS_BY_KEY: Record<SplitMetricKey, OutlierBounds> = {
  paceSecondsPerKm: { min: 90, max: 3600 },
  speedKmh: { min: 0, max: 130 },
  heartRate: { min: 40, max: 240 },
  elevationM: {},
  cadence: { min: 20, max: 260 },
  powerWatts: { min: 0, max: 2500 }
};

const OUTLIER_WINDOW_RADIUS = 5;
const OUTLIER_MIN_WINDOW_SAMPLES = 7;
const OUTLIER_Z_THRESHOLD = 3.5;
const OUTLIER_MAD_EPSILON = 1e-6;

function median(values: number[]): number {
  if (values.length === 0) {
    return NaN;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function filterSeriesOutliers(values: Array<number | null>, bounds: OutlierBounds): Array<number | null> {
  const filtered: Array<number | null> = new Array(values.length).fill(null);

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value == null || !Number.isFinite(value)) {
      filtered[index] = null;
      continue;
    }

    if ((bounds.min != null && value < bounds.min) || (bounds.max != null && value > bounds.max)) {
      filtered[index] = null;
      continue;
    }

    const neighborhood: number[] = [];
    const start = Math.max(0, index - OUTLIER_WINDOW_RADIUS);
    const end = Math.min(values.length - 1, index + OUTLIER_WINDOW_RADIUS);
    for (let neighborIndex = start; neighborIndex <= end; neighborIndex += 1) {
      const neighborValue = values[neighborIndex];
      if (neighborValue != null && Number.isFinite(neighborValue)) {
        neighborhood.push(neighborValue);
      }
    }

    if (neighborhood.length < OUTLIER_MIN_WINDOW_SAMPLES) {
      filtered[index] = value;
      continue;
    }

    const center = median(neighborhood);
    if (!Number.isFinite(center)) {
      filtered[index] = value;
      continue;
    }

    const absoluteDeviations = neighborhood.map((entry) => Math.abs(entry - center));
    const mad = median(absoluteDeviations);
    if (!Number.isFinite(mad) || mad < OUTLIER_MAD_EPSILON) {
      filtered[index] = value;
      continue;
    }

    const robustZScore = Math.abs(value - center) / (1.4826 * mad);
    filtered[index] = robustZScore > OUTLIER_Z_THRESHOLD ? null : value;
  }

  return filtered;
}

export function removeCombinedChartOutliers(points: CombinedChartBasePoint[]): CombinedChartBasePoint[] {
  if (points.length === 0) {
    return points;
  }

  const paceValues = filterSeriesOutliers(
    points.map((point) => point.paceSecondsPerKm),
    OUTLIER_BOUNDS_BY_KEY.paceSecondsPerKm
  );
  const speedValues = filterSeriesOutliers(
    points.map((point) => point.speedKmh),
    OUTLIER_BOUNDS_BY_KEY.speedKmh
  );
  const heartRateValues = filterSeriesOutliers(
    points.map((point) => point.heartRate),
    OUTLIER_BOUNDS_BY_KEY.heartRate
  );
  const cadenceValues = filterSeriesOutliers(
    points.map((point) => point.cadence),
    OUTLIER_BOUNDS_BY_KEY.cadence
  );
  const powerValues = filterSeriesOutliers(
    points.map((point) => point.powerWatts),
    OUTLIER_BOUNDS_BY_KEY.powerWatts
  );
  const elevationValues = filterSeriesOutliers(
    points.map((point) => point.elevationM),
    OUTLIER_BOUNDS_BY_KEY.elevationM
  );

  return points.map((point, index) => ({
    ...point,
    paceSecondsPerKm: paceValues[index],
    speedKmh: speedValues[index],
    heartRate: heartRateValues[index],
    cadence: cadenceValues[index],
    powerWatts: powerValues[index],
    elevationM: elevationValues[index]
  }));
}

export function defaultChartSeriesVisibility(sportType?: string): ChartSeriesVisibility {
  const normalizedSport = (sportType ?? '').trim().toLowerCase();

  const isRunning =
    normalizedSport.includes('run') || normalizedSport.includes('jog') || normalizedSport.includes('trail run');
  const isCycling =
    normalizedSport.includes('bike') ||
    normalizedSport.includes('cycle') ||
    normalizedSport.includes('ride') ||
    normalizedSport.includes('cycling');

  if (isRunning) {
    return {
      pace: true,
      speed: false,
      heartRate: true,
      elevation: true,
      cadence: true,
      power: true
    };
  }

  if (isCycling) {
    return {
      pace: false,
      speed: true,
      heartRate: true,
      elevation: true,
      cadence: true,
      power: true
    };
  }

  return {
    pace: true,
    speed: true,
    heartRate: true,
    elevation: true,
    cadence: false,
    power: false
  };
}

export function readHoveredRouteCoordinate(event: unknown): RouteHoverCoordinate {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const maybeHover = event as {
    isTooltipActive?: unknown;
    activePayload?: Array<{ payload?: CombinedChartPoint }>;
  };

  if (maybeHover.isTooltipActive === false) {
    return null;
  }

  if (!Array.isArray(maybeHover.activePayload) || maybeHover.activePayload.length === 0) {
    return null;
  }

  for (const entry of maybeHover.activePayload) {
    const point = entry?.payload;
    if (!point) {
      continue;
    }

    if (Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
      return { lat: point.lat as number, lon: point.lon as number };
    }
  }

  return null;
}

export function routeHoverCoordinatesEqual(a: RouteHoverCoordinate, b: RouteHoverCoordinate): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
}

export function formatNumberTick(value: number, digits = 1): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits
  }).format(value);
}

export function formatDistanceAxisTick(km: number): string {
  return `${formatNumberTick(km, km >= 10 ? 0 : 1)} km`;
}

export function formatElapsedAxisTick(seconds: number): string {
  return formatDuration(seconds);
}

export function formatElapsedTooltip(seconds: number): string {
  return formatDuration(seconds);
}

export function formatPaceSeconds(secondsPerKm: number | null): string {
  if (secondsPerKm == null || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return 'n/a';
  }

  const rounded = Math.round(secondsPerKm);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
}

export function formatPaceTick(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return 'n/a';
  }

  const rounded = Math.round(secondsPerKm);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildHeartRateZoneHighlightSegments(
  points: CombinedChartPoint[],
  xAxisMode: ChartXAxisMode,
  xDomain: ChartZoomDomain,
  hoveredZoneIndex: number | null,
  upperBoundsBpm: number[]
): ZoneHighlightSegment[] {
  if (hoveredZoneIndex == null || points.length < 2) {
    return [];
  }

  const segments: ZoneHighlightSegment[] = [];
  let openStart: number | null = null;
  let previousX: number | null = null;

  for (const point of points) {
    const x = xAxisMode === 'distance' ? point.distanceKm : point.elapsedSeconds;
    const hr = point.heartRate;
    const inHoveredZone =
      hr != null && Number.isFinite(hr) && heartRateZoneIndexForBpm(hr, upperBoundsBpm) === hoveredZoneIndex;

    if (inHoveredZone) {
      if (openStart == null) {
        openStart = x;
      }
      previousX = x;
      continue;
    }

    if (openStart != null && previousX != null && previousX > openStart) {
      segments.push({ start: openStart, end: previousX });
    }
    openStart = null;
    previousX = null;
  }

  if (openStart != null && previousX != null && previousX > openStart) {
    segments.push({ start: openStart, end: previousX });
  }

  return segments
    .map((segment) => ({
      start: Math.max(segment.start, xDomain[0]),
      end: Math.min(segment.end, xDomain[1])
    }))
    .filter((segment) => segment.end > segment.start);
}

export function metricRange(values: Array<number | null | undefined>): [number, number] | null {
  const numeric = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (numeric.length === 0) {
    return null;
  }

  let min = Math.min(...numeric);
  let max = Math.max(...numeric);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.08, 1);
    return [min - pad, max + pad];
  }

  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;
  return [min, max];
}

export function metricRangeForVisibleDomain<T>(
  items: T[],
  xDomain: ChartZoomDomain,
  getX: (item: T) => number,
  getValue: (item: T) => number | null | undefined
): [number, number] | null {
  const visibleRange = metricRange(
    items
      .filter((item) => {
        const x = getX(item);
        return Number.isFinite(x) && x >= xDomain[0] && x <= xDomain[1];
      })
      .map(getValue)
  );

  return visibleRange ?? metricRange(items.map(getValue));
}

export function normalizeToBand(
  value: number | null,
  range: [number, number] | null,
  band: ChartBand | null | undefined,
  invert = false
): number | null {
  if (value == null || range == null || band == null) {
    return null;
  }

  const [rangeMin, rangeMax] = range;
  const ratio = Math.min(1, Math.max(0, (value - rangeMin) / (rangeMax - rangeMin)));
  const adjustedRatio = invert ? 1 - ratio : ratio;
  return band.min + adjustedRatio * (band.max - band.min);
}

export function buildCombinedChartBands(
  visibleSeries: ChartSeriesKey[]
): Partial<Record<ChartSeriesKey, ChartBand>> {
  if (visibleSeries.length === 0) {
    return {};
  }

  const [domainMin, domainMax] = COMBINED_CHART_DOMAIN;
  const domainHeight = domainMax - domainMin;
  const outerPadding = visibleSeries.length === 1 ? 2 : COMBINED_CHART_OUTER_PADDING;
  const bandGap = visibleSeries.length <= 1 ? 0 : COMBINED_CHART_BAND_GAP;
  const totalGapHeight = bandGap * Math.max(0, visibleSeries.length - 1);
  const usableHeight = Math.max(visibleSeries.length, domainHeight - outerPadding * 2 - totalGapHeight);
  const bandHeight = usableHeight / visibleSeries.length;
  const bands: Partial<Record<ChartSeriesKey, ChartBand>> = {};
  let currentTop = domainMax - outerPadding;

  for (const key of visibleSeries) {
    const bandMax = currentTop;
    const bandMin = currentTop - bandHeight;
    bands[key] = { min: bandMin, max: bandMax };
    currentTop = bandMin - bandGap;
  }

  return bands;
}
