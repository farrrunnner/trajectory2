import { useCallback, useEffect, useMemo } from 'react';
import type { FeatureCollection, Geometry } from 'geojson';
import maplibregl, { type ExpressionSpecification, type GeoJSONSource } from 'maplibre-gl';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import worldCountries from 'world-atlas/countries-110m.json';

import { formatDuration } from '@/lib/format';
import { US_DEFAULT_CENTER, US_DEFAULT_ZOOM } from '@/lib/mapStyles';
import type { AccentThemePalette } from '@/lib/theme';
import { useManagedMapLibre } from '@/lib/useManagedMapLibre';
import type {
  CountryActivityBounds,
  CountryActivityData,
  CountryActivitySummary,
  HeatmapViewMode
} from '@/types';

const COUNTRY_SOURCE_ID = 'country-activity-source';
const COUNTRY_FILL_LAYER_ID = 'country-activity-fill-layer';
const COUNTRY_OUTLINE_LAYER_ID = 'country-activity-outline-layer';

type CountryProperties = {
  name: string;
  visited?: boolean;
  durationSeconds?: number;
  activityCount?: number;
  intensity?: number;
};

type WorldTopology = Topology<{
  countries: GeometryCollection<{ name: string }>;
}>;

const COUNTRY_BOUNDARIES = feature(
  worldCountries as unknown as WorldTopology,
  (worldCountries as unknown as WorldTopology).objects.countries
) as FeatureCollection<Geometry, { name: string }>;

function buildCountryFeatures(data: CountryActivityData): FeatureCollection<Geometry, CountryProperties> {
  const statsByNumericCode = new Map<number, CountryActivitySummary>();
  let minimumPositiveDuration = Number.POSITIVE_INFINITY;
  let maximumDuration = 0;

  for (const country of data.countries) {
    statsByNumericCode.set(country.numericCode, country);
    if (country.durationSeconds > 0) {
      minimumPositiveDuration = Math.min(minimumPositiveDuration, country.durationSeconds);
    }
    maximumDuration = Math.max(maximumDuration, country.durationSeconds);
  }

  const minimumLogDuration = Number.isFinite(minimumPositiveDuration)
    ? Math.log1p(minimumPositiveDuration)
    : 0;
  const durationLogRange = Math.log1p(maximumDuration) - minimumLogDuration;

  return {
    type: 'FeatureCollection',
    features: COUNTRY_BOUNDARIES.features.map((country) => {
      const numericCode = Number(country.id);
      const stats = statsByNumericCode.get(numericCode);

      return {
        ...country,
        properties: {
          name: stats?.name ?? country.properties.name,
          visited: stats != null,
          durationSeconds: stats?.durationSeconds ?? 0,
          activityCount: stats?.activityCount ?? 0,
          intensity: stats
            ? durationLogRange > 0
              ? (Math.log1p(stats.durationSeconds) - minimumLogDuration) / durationLogRange
              : 1
            : 0
        }
      };
    })
  };
}

function fitMapToActivityBounds(map: maplibregl.Map, bounds: CountryActivityBounds | null) {
  if (!bounds) {
    return;
  }

  if (bounds.minLat === bounds.maxLat && bounds.minLon === bounds.maxLon) {
    map.jumpTo({ center: [bounds.minLon, bounds.minLat], zoom: 5 });
    return;
  }

  map.fitBounds(
    [
      [bounds.minLon, bounds.minLat],
      [bounds.maxLon, bounds.maxLat]
    ],
    { padding: 56, duration: 0, maxZoom: 5 }
  );
}

function createPopupContent(properties: CountryProperties) {
  const container = document.createElement('div');
  container.className = 'country-map-popup';

  const title = document.createElement('strong');
  title.textContent = properties.name;
  container.appendChild(title);

  const details = document.createElement('span');
  const activityCount = properties.activityCount ?? 0;
  details.textContent = `${activityCount} ${activityCount === 1 ? 'activity' : 'activities'} · ${formatDuration(
    properties.durationSeconds ?? 0
  )}`;
  container.appendChild(details);

  return container;
}

export function CountryActivityMap({
  data,
  viewMode,
  reducedComplexity,
  accentPalette
}: {
  data: CountryActivityData;
  viewMode: Exclude<HeatmapViewMode, 'routes'>;
  reducedComplexity: boolean;
  accentPalette: AccentThemePalette;
}) {
  const { containerRef, mapRef } = useManagedMapLibre({
    reducedComplexity,
    initialCenter: US_DEFAULT_CENTER,
    initialZoom: US_DEFAULT_ZOOM
  });
  const sourceData = useMemo(() => buildCountryFeatures(data), [data]);

  const fillColor = useMemo<string | ExpressionSpecification>(
    () =>
      viewMode === 'countries'
        ? accentPalette.accentHex
        : [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0,
            accentPalette.accentTintHex,
            0.35,
            accentPalette.accentSoftHex,
            0.7,
            accentPalette.accentHex,
            1,
            accentPalette.accentHex
          ],
    [
      accentPalette.accentHex,
      accentPalette.accentSoftHex,
      accentPalette.accentTintHex,
      viewMode
    ]
  );

  const syncCountries = useCallback(
    (map: maplibregl.Map) => {
      if (!map.getSource(COUNTRY_SOURCE_ID)) {
        map.addSource(COUNTRY_SOURCE_ID, {
          type: 'geojson',
          data: sourceData
        });
      } else {
        (map.getSource(COUNTRY_SOURCE_ID) as GeoJSONSource).setData(sourceData);
      }

      if (!map.getLayer(COUNTRY_FILL_LAYER_ID)) {
        map.addLayer({
          id: COUNTRY_FILL_LAYER_ID,
          type: 'fill',
          source: COUNTRY_SOURCE_ID,
          filter: ['==', ['get', 'visited'], true],
          paint: {
            'fill-color': fillColor,
            'fill-opacity':
              viewMode === 'countries'
                ? 0.62
                : ['interpolate', ['linear'], ['get', 'intensity'], 0, 0.38, 0.5, 0.68, 1, 0.92]
          }
        });
      }

      if (!map.getLayer(COUNTRY_OUTLINE_LAYER_ID)) {
        map.addLayer({
          id: COUNTRY_OUTLINE_LAYER_ID,
          type: 'line',
          source: COUNTRY_SOURCE_ID,
          filter: ['==', ['get', 'visited'], true],
          paint: {
            'line-color': accentPalette.accentHex,
            'line-opacity': 0.95,
            'line-width': 1.4
          }
        });
      }

      map.setPaintProperty(COUNTRY_FILL_LAYER_ID, 'fill-color', fillColor);
      map.setPaintProperty(
        COUNTRY_FILL_LAYER_ID,
        'fill-opacity',
        viewMode === 'countries'
          ? 0.62
          : ['interpolate', ['linear'], ['get', 'intensity'], 0, 0.38, 0.5, 0.68, 1, 0.92]
      );
      map.setPaintProperty(COUNTRY_OUTLINE_LAYER_ID, 'line-color', accentPalette.accentHex);
    },
    [accentPalette.accentHex, fillColor, sourceData, viewMode]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    let popup: maplibregl.Popup | null = null;

    const onMouseMove = (event: maplibregl.MapLayerMouseEvent) => {
      const renderedFeature = event.features?.[0];
      if (!renderedFeature?.properties) {
        return;
      }

      map.getCanvas().style.cursor = 'pointer';
      popup ??= new maplibregl.Popup({
        className: 'country-activity-popup',
        closeButton: false,
        closeOnClick: false,
        maxWidth: '260px',
        offset: 12
      });
      popup
        .setLngLat(event.lngLat)
        .setDOMContent(createPopupContent(renderedFeature.properties as CountryProperties))
        .addTo(map);
    };

    const onMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      popup?.remove();
      popup = null;
    };

    const applyCountries = () => {
      syncCountries(map);
      map.on('mousemove', COUNTRY_FILL_LAYER_ID, onMouseMove);
      map.on('mouseleave', COUNTRY_FILL_LAYER_ID, onMouseLeave);
    };

    if (map.isStyleLoaded()) {
      applyCountries();
    } else {
      map.once('load', applyCountries);
    }

    return () => {
      popup?.remove();
      if (mapRef.current !== map) {
        return;
      }

      map.off('load', applyCountries);
      if (map.getLayer(COUNTRY_FILL_LAYER_ID)) {
        map.off('mousemove', COUNTRY_FILL_LAYER_ID, onMouseMove);
        map.off('mouseleave', COUNTRY_FILL_LAYER_ID, onMouseLeave);
      }
    };
  }, [reducedComplexity, syncCountries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return undefined;
    }

    const applyBounds = () => fitMapToActivityBounds(map, data.bounds);
    if (map.isStyleLoaded()) {
      applyBounds();
      return undefined;
    }

    map.once('load', applyBounds);
    return () => {
      if (mapRef.current === map) {
        map.off('load', applyBounds);
      }
    };
  }, [data.bounds, reducedComplexity]);

  return <div ref={containerRef} className="h-full w-full" />;
}
