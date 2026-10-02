import type { StyleSpecification } from 'maplibre-gl';

export const US_DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283];
export const US_DEFAULT_ZOOM = 4;

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function createRasterStyle(
  tiles: string[],
  attribution: string,
  paint?: Record<string, number>
): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution
      }
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        ...(paint ? { paint } : {})
      }
    ]
  };
}

export const STANDARD_MAP_STYLE = createRasterStyle(
  [
    'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
  ],
  OSM_ATTRIBUTION
);

export const REDUCED_COMPLEXITY_MAP_STYLE = createRasterStyle(
  [
    'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    'https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    'https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
    'https://d.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'
  ],
  CARTO_ATTRIBUTION,
  {
    'raster-opacity': 0.72,
    'raster-saturation': -1,
    'raster-contrast': 0.15,
    'raster-brightness-max': 0.82
  }
);

export function getMapStyle(reducedComplexity: boolean): StyleSpecification {
  const style = reducedComplexity ? REDUCED_COMPLEXITY_MAP_STYLE : STANDARD_MAP_STYLE;
  return JSON.parse(JSON.stringify(style)) as StyleSpecification;
}
