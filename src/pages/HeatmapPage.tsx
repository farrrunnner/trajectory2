import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import type { FeatureCollection, LineString } from 'geojson';
import maplibregl, { type GeoJSONSource } from 'maplibre-gl';

import { CountryActivityMap } from '@/components/CountryActivityMap';
import { MaximizableMapFrame } from '@/components/MaximizableMapFrame';
import { formatDuration } from '@/lib/format';
import { getCountryActivityData, getHeatmapData, listActivities } from '@/lib/tauri';
import { US_DEFAULT_CENTER, US_DEFAULT_ZOOM } from '@/lib/mapStyles';
import { type AccentThemePalette, getAccentThemePalette } from '@/lib/theme';
import { useManagedMapLibre } from '@/lib/useManagedMapLibre';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';
import type {
  ActivityFilters,
  ActivitySummary,
  CountryActivityData,
  HeatmapData,
  HeatmapFilters,
  HeatmapViewMode,
  TrackPoint
} from '@/types';

type TimeSpan = 'all' | '30d' | '90d' | '365d' | 'custom';

const TIME_SPAN_OPTIONS: Array<{ value: TimeSpan; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '1 year' },
  { value: 'custom', label: 'Custom' }
];

const CATEGORY_OPTIONS = [
  'Running',
  'Biking',
  'Strength',
  'Walking',
  'Hiking',
  'Swimming',
  'Rowing',
  'Mobility',
  'Other'
];

const VIEW_OPTIONS: Array<{ value: HeatmapViewMode; label: string; description: string }> = [
  { value: 'routes', label: 'Routes', description: 'Show individual GPS tracks' },
  { value: 'countries', label: 'Countries', description: 'Highlight every country with activity' },
  { value: 'time', label: 'Time spent', description: 'Shade countries by activity time' }
];

const HEATMAP_SOURCE_ID = 'heatmap-track-source';
const HEATMAP_BASE_LAYER_ID = 'heatmap-track-base-layer';
const HEATMAP_TOP_LAYER_ID = 'heatmap-track-top-layer';

function resolveDateRange(
  span: TimeSpan,
  customStartDate: string,
  customEndDate: string
): { startDate?: string; endDate?: string } {
  const today = format(new Date(), 'yyyy-MM-dd');

  if (span === 'all') {
    return {};
  }

  if (span === 'custom') {
    const startDate = customStartDate || undefined;
    const endDate = customEndDate || undefined;

    if (startDate && endDate && startDate > endDate) {
      return { startDate: endDate, endDate: startDate };
    }

    return {
      startDate,
      endDate
    };
  }

  const days = span === '30d' ? 30 : span === '90d' ? 90 : 365;
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');

  return { startDate, endDate: today };
}

function flattenBoundsPoints(tracks: TrackPoint[][]): TrackPoint[] {
  if (tracks.length === 0) {
    return [];
  }

  const sampled: TrackPoint[] = [];

  for (const track of tracks) {
    if (track.length === 0) {
      continue;
    }

    const stride = Math.max(1, Math.ceil(track.length / 60));
    for (let index = 0; index < track.length; index += stride) {
      sampled.push(track[index]);
    }

    const last = track[track.length - 1];
    if (sampled[sampled.length - 1] !== last) {
      sampled.push(last);
    }
  }

  return sampled;
}

function resolveHeatmapStyle(
  trackCount: number,
  fullOpacity: boolean
): { baseOpacity: number; topOpacity: number; weight: number } {
  if (fullOpacity) {
    if (trackCount <= 20) {
      return { baseOpacity: 1, topOpacity: 1, weight: 5 };
    }

    if (trackCount <= 80) {
      return { baseOpacity: 1, topOpacity: 1, weight: 4 };
    }

    if (trackCount <= 250) {
      return { baseOpacity: 1, topOpacity: 1, weight: 3 };
    }

    return { baseOpacity: 1, topOpacity: 1, weight: 2.5 };
  }

  if (trackCount <= 1) {
    return { baseOpacity: 0.72, topOpacity: 0.92, weight: 5 };
  }

  if (trackCount <= 20) {
    return { baseOpacity: 0.4, topOpacity: 0.58, weight: 5 };
  }

  if (trackCount <= 80) {
    return { baseOpacity: 0.3, topOpacity: 0.45, weight: 4 };
  }

  if (trackCount <= 250) {
    return { baseOpacity: 0.2, topOpacity: 0.32, weight: 3 };
  }

  return { baseOpacity: 0.12, topOpacity: 0.22, weight: 2.5 };
}

function toHeatmapFeatureCollection(tracks: TrackPoint[][]): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: tracks
      .map((track, index) => {
        const coordinates = track.map((point) => [point.lon, point.lat] as [number, number]);
        if (coordinates.length < 2) {
          return null;
        }

        return {
          type: 'Feature' as const,
          id: index,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates
          }
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature != null)
  };
}

function fitMapToBounds(map: maplibregl.Map, points: TrackPoint[]) {
  if (points.length === 0) {
    return;
  }

  if (points.length === 1) {
    map.jumpTo({
      center: [points[0].lon, points[0].lat],
      zoom: 11
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds(
    [points[0].lon, points[0].lat],
    [points[0].lon, points[0].lat]
  );

  for (const point of points) {
    bounds.extend([point.lon, point.lat]);
  }

  map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 13 });
}

function HeatmapMap({
  tracks,
  boundsPoints,
  heatStyle,
  reducedComplexity,
  accentPalette
}: {
  tracks: TrackPoint[][];
  boundsPoints: TrackPoint[];
  heatStyle: { baseOpacity: number; topOpacity: number; weight: number };
  reducedComplexity: boolean;
  accentPalette: AccentThemePalette;
}) {
  const { containerRef, mapRef } = useManagedMapLibre({
    reducedComplexity,
    initialCenter: US_DEFAULT_CENTER,
    initialZoom: US_DEFAULT_ZOOM
  });

  const sourceData = useMemo(() => toHeatmapFeatureCollection(tracks), [tracks]);

  const syncTracks = useCallback(
    (map: maplibregl.Map) => {
      if (!map.getSource(HEATMAP_SOURCE_ID)) {
        map.addSource(HEATMAP_SOURCE_ID, {
          type: 'geojson',
          data: sourceData
        });
      } else {
        (map.getSource(HEATMAP_SOURCE_ID) as GeoJSONSource).setData(sourceData);
      }

      if (!map.getLayer(HEATMAP_BASE_LAYER_ID)) {
        map.addLayer({
          id: HEATMAP_BASE_LAYER_ID,
          type: 'line',
          source: HEATMAP_SOURCE_ID,
          paint: {
            'line-color': accentPalette.heatmapBaseLineHex,
            'line-opacity': heatStyle.baseOpacity,
            'line-width': heatStyle.weight + 3
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          }
        });
      }

      if (!map.getLayer(HEATMAP_TOP_LAYER_ID)) {
        map.addLayer({
          id: HEATMAP_TOP_LAYER_ID,
          type: 'line',
          source: HEATMAP_SOURCE_ID,
          paint: {
            'line-color': accentPalette.heatmapTopLineHex,
            'line-opacity': heatStyle.topOpacity,
            'line-width': heatStyle.weight
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          }
        });
      }

      map.setPaintProperty(HEATMAP_BASE_LAYER_ID, 'line-color', accentPalette.heatmapBaseLineHex);
      map.setPaintProperty(HEATMAP_BASE_LAYER_ID, 'line-opacity', heatStyle.baseOpacity);
      map.setPaintProperty(HEATMAP_BASE_LAYER_ID, 'line-width', heatStyle.weight + 3);
      map.setPaintProperty(HEATMAP_TOP_LAYER_ID, 'line-color', accentPalette.heatmapTopLineHex);
      map.setPaintProperty(HEATMAP_TOP_LAYER_ID, 'line-opacity', heatStyle.topOpacity);
      map.setPaintProperty(HEATMAP_TOP_LAYER_ID, 'line-width', heatStyle.weight);
    },
    [
      accentPalette.heatmapBaseLineHex,
      accentPalette.heatmapTopLineHex,
      heatStyle.baseOpacity,
      heatStyle.topOpacity,
      heatStyle.weight,
      sourceData
    ]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const applyTracks = () => {
      syncTracks(map);
    };

    if (map.isStyleLoaded()) {
      applyTracks();
      return undefined;
    }

    map.once('load', applyTracks);
    return () => {
      map.off('load', applyTracks);
    };
  }, [syncTracks, reducedComplexity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const applyBounds = () => {
      fitMapToBounds(map, boundsPoints);
    };

    if (map.isStyleLoaded()) {
      applyBounds();
      return undefined;
    }

    map.once('load', applyBounds);
    return () => {
      map.off('load', applyBounds);
    };
  }, [boundsPoints]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function HeatmapMapOverlayControls({
  reducedMapComplexity,
  onReducedMapComplexityChange,
  accentPalette,
  viewMode
}: {
  reducedMapComplexity: boolean;
  onReducedMapComplexityChange: (checked: boolean) => void;
  accentPalette: AccentThemePalette;
  viewMode: HeatmapViewMode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onReducedMapComplexityChange(!reducedMapComplexity)}
        aria-pressed={reducedMapComplexity}
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs backdrop-blur transition-colors ${
          reducedMapComplexity
            ? 'border-accent/60 bg-panel/90 text-foreground'
            : 'border-border bg-panel/80 text-muted hover:text-foreground'
        }`}
      >
        <span
          className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[10px] leading-none ${
            reducedMapComplexity
              ? 'border-accent bg-accent text-white'
              : 'border-border bg-bg/90 text-transparent'
          }`}
        >
          ✓
        </span>
        Reduced complexity
      </button>
      {viewMode === 'countries' ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel/80 px-2.5 py-1.5 text-xs text-muted backdrop-blur">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accentPalette.accentHex }} />
          Activity recorded
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel/80 px-2.5 py-1.5 text-xs text-muted backdrop-blur">
          <span>Low</span>
          <span
            className="h-2 w-24 rounded-full"
            style={{
              backgroundImage: `linear-gradient(to right, ${accentPalette.accentTintHex}, ${accentPalette.accentSoftHex}, ${accentPalette.accentHex})`
            }}
          />
          <span>High</span>
        </div>
      )}
    </div>
  );
}

export function HeatmapPage() {
  const dataVersion = useAppStore((state) => `${state.settings?.importFolderPath ?? ''}:${state.settings?.lastScanTimestamp ?? ''}`);
  const heatmapFullOpacity = useAppStore((state) => state.settings?.heatmapFullOpacity ?? false);
  const accentTheme = useAppStore((state) => state.settings?.accentTheme);
  const timeSpan = useUiStateStore((state) => state.heatmapTimeSpan) as TimeSpan;
  const setTimeSpan = useUiStateStore((state) => state.setHeatmapTimeSpan);
  const customStartDate = useUiStateStore((state) => state.heatmapCustomStartDate);
  const setCustomStartDate = useUiStateStore((state) => state.setHeatmapCustomStartDate);
  const customEndDate = useUiStateStore((state) => state.heatmapCustomEndDate);
  const setCustomEndDate = useUiStateStore((state) => state.setHeatmapCustomEndDate);
  const category = useUiStateStore((state) => state.heatmapCategory);
  const setCategory = useUiStateStore((state) => state.setHeatmapCategory);
  const sportType = useUiStateStore((state) => state.heatmapSportType);
  const setSportType = useUiStateStore((state) => state.setHeatmapSportType);
  const reducedMapComplexity = useUiStateStore((state) => state.heatmapReducedMapComplexity);
  const setReducedMapComplexity = useUiStateStore((state) => state.setHeatmapReducedMapComplexity);
  const viewMode = useUiStateStore((state) => state.heatmapViewMode);
  const setViewMode = useUiStateStore((state) => state.setHeatmapViewMode);
  const [availableActivities, setAvailableActivities] = useState<ActivitySummary[]>([]);
  const [activityOptionsLoading, setActivityOptionsLoading] = useState(false);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [countryDataLoading, setCountryDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null);
  const [countryData, setCountryData] = useState<CountryActivityData | null>(null);
  const accentPalette = useMemo(() => getAccentThemePalette(accentTheme), [accentTheme]);
  const countryViewEnabled = viewMode !== 'routes';

  const resolvedRange = useMemo(
    () => resolveDateRange(timeSpan, customStartDate, customEndDate),
    [customEndDate, customStartDate, timeSpan]
  );

  const activityQuery = useMemo<ActivityFilters>(
    () => ({
      startDate: resolvedRange.startDate,
      endDate: resolvedRange.endDate,
      category: category || undefined
    }),
    [category, resolvedRange.endDate, resolvedRange.startDate]
  );

  useEffect(() => {
    let cancelled = false;

    const loadActivities = async () => {
      setActivityOptionsLoading(true);
      setError(null);

      try {
        const activities = await listActivities(activityQuery);
        if (!cancelled) {
          setAvailableActivities(activities);
        }
      } catch (err) {
        if (!cancelled) {
          setAvailableActivities([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setActivityOptionsLoading(false);
        }
      }
    };

    void loadActivities();

    return () => {
      cancelled = true;
    };
  }, [activityQuery, dataVersion]);

  const sportOptions = useMemo(
    () =>
      Array.from(new Set(availableActivities.map((activity) => activity.sportType)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [availableActivities]
  );

  useEffect(() => {
    if (sportType && !sportOptions.includes(sportType)) {
      setSportType('');
    }
  }, [sportOptions, sportType]);

  const heatmapFilters = useMemo<HeatmapFilters>(
    () => ({
      startDate: resolvedRange.startDate,
      endDate: resolvedRange.endDate,
      category: category || undefined,
      sportType: sportType || undefined,
      maxPoints: 80_000
    }),
    [category, resolvedRange.endDate, resolvedRange.startDate, sportType]
  );

  useEffect(() => {
    if (viewMode !== 'routes') {
      return undefined;
    }

    let cancelled = false;

    const loadHeatmapData = async () => {
      setHeatmapLoading(true);
      setError(null);

      try {
        const data = await getHeatmapData(heatmapFilters);
        if (!cancelled) {
          setHeatmapData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setHeatmapData(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setHeatmapLoading(false);
        }
      }
    };

    void loadHeatmapData();

    return () => {
      cancelled = true;
    };
  }, [heatmapFilters, viewMode, dataVersion]);

  useEffect(() => {
    if (!countryViewEnabled) {
      return undefined;
    }

    let cancelled = false;

    const loadCountryData = async () => {
      setCountryDataLoading(true);
      setError(null);

      try {
        const data = await getCountryActivityData(heatmapFilters);
        if (!cancelled) {
          setCountryData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setCountryData(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setCountryDataLoading(false);
        }
      }
    };

    void loadCountryData();

    return () => {
      cancelled = true;
    };
  }, [countryViewEnabled, heatmapFilters, dataVersion]);

  const trackCount = heatmapData?.tracks.length ?? 0;
  const heatStyle = useMemo(
    () => resolveHeatmapStyle(trackCount, heatmapFullOpacity),
    [heatmapFullOpacity, trackCount]
  );
  const heatBoundsPoints = useMemo(
    () => flattenBoundsPoints(heatmapData?.tracks ?? []),
    [heatmapData?.tracks]
  );

  const loading =
    activityOptionsLoading || (viewMode === 'routes' ? heatmapLoading : countryDataLoading);
  const countryCount = countryData?.countries.length ?? 0;
  const totalCountryDuration = useMemo(
    () => countryData?.countries.reduce((total, country) => total + country.durationSeconds, 0) ?? 0,
    [countryData]
  );
  const activeView = VIEW_OPTIONS.find((option) => option.value === viewMode) ?? VIEW_OPTIONS[0];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Heatmap</p>
        <h2 className="mt-2 text-3xl font-semibold text-foreground">Global Activity Heatmap</h2>
        <p className="mt-2 text-sm text-muted">
          Explore matching activities as routes, visited countries, or time spent in each country.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-panel p-4">
        <div className="mb-4 border-b border-border pb-4">
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted">Map view</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Map view">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setViewMode(option.value)}
                aria-pressed={viewMode === option.value}
                title={option.description}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                  viewMode === option.value
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-bg text-muted hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{activeView.description}</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <p className="mb-2 text-xs uppercase tracking-[0.14em] text-muted">Time span</p>
            <div className="flex flex-wrap gap-2">
              {TIME_SPAN_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTimeSpan(option.value)}
                  className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                    timeSpan === option.value
                      ? 'border-accent bg-accent text-white'
                      : 'border-border bg-bg text-muted hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {timeSpan === 'custom' ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-muted">Start</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(event) => setCustomStartDate(event.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs uppercase tracking-[0.12em] text-muted">End</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(event) => setCustomEndDate(event.target.value)}
                    className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                  />
                </label>
              </div>
            ) : null}
          </div>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.14em] text-muted">Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.14em] text-muted">Sport type</span>
            <select
              value={sportType}
              onChange={(event) => setSportType(event.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            >
              <option value="">All sport types</option>
              {sportOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? <p className="rounded-lg bg-accent/20 p-3 text-sm text-accent">{error}</p> : null}

      <section className="overflow-hidden rounded-xl border border-border bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{activeView.label}</h3>
            {viewMode === 'routes' ? (
              <p className="text-sm text-muted">
                Activities: {heatmapData?.activityCount ?? 0} · Tracks: {trackCount} · Points:{' '}
                {heatmapData?.returnedPointCount ?? 0}
                {heatmapData && heatmapData.returnedPointCount < heatmapData.originalPointCount
                  ? ` (downsampled from ${heatmapData.originalPointCount})`
                  : ''}
              </p>
            ) : (
              <p className="text-sm text-muted">
                Activities: {countryData?.activityCount ?? 0} · Countries: {countryCount} · Time in
                countries: {formatDuration(totalCountryDuration)}
              </p>
            )}
            {viewMode === 'routes' && heatmapFullOpacity ? (
              <p className="text-xs text-muted">Appearance: full-opacity heatmap enabled</p>
            ) : null}
          </div>
        </div>

        <MaximizableMapFrame
          label={`${activeView.label.toLowerCase()} heatmap`}
          collapsedHeightClassName="h-[36rem]"
          topLeftActions={
            <HeatmapMapOverlayControls
              reducedMapComplexity={reducedMapComplexity}
              onReducedMapComplexityChange={setReducedMapComplexity}
              accentPalette={accentPalette}
              viewMode={viewMode}
            />
          }
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              Loading {viewMode === 'routes' ? 'heatmap' : 'country totals'}...
            </div>
          ) : viewMode === 'routes' && !trackCount ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No GPS points for the selected filters.
            </div>
          ) : viewMode !== 'routes' && !countryCount ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No countries found for the selected filters.
            </div>
          ) : viewMode === 'routes' ? (
            <HeatmapMap
              tracks={heatmapData?.tracks ?? []}
              boundsPoints={heatBoundsPoints}
              heatStyle={heatStyle}
              reducedComplexity={reducedMapComplexity}
              accentPalette={accentPalette}
            />
          ) : countryData ? (
            <CountryActivityMap
              data={countryData}
              viewMode={viewMode}
              reducedComplexity={reducedMapComplexity}
              accentPalette={accentPalette}
            />
          ) : null}
        </MaximizableMapFrame>
      </section>
    </div>
  );
}
