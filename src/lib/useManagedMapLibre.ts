import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';

import { getMapStyle } from '@/lib/mapStyles';

type UseManagedMapLibreOptions = {
  reducedComplexity: boolean;
  initialCenter: [number, number];
  initialZoom: number;
};

type MapViewState = {
  center: [number, number];
  zoom: number;
};

export function useManagedMapLibre({
  reducedComplexity,
  initialCenter,
  initialZoom
}: UseManagedMapLibreOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const viewRef = useRef<MapViewState>({
    center: initialCenter,
    zoom: initialZoom
  });

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(reducedComplexity),
      center: viewRef.current.center,
      zoom: viewRef.current.zoom,
      pitchWithRotate: false,
      dragRotate: false
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.scrollZoom.setWheelZoomRate(1 / 520);
    map.scrollZoom.setZoomRate(1 / 130);

    return () => {
      const center = map.getCenter();
      viewRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom()
      };

      map.remove();
      mapRef.current = null;
    };
  }, [initialCenter, initialZoom, reducedComplexity]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [reducedComplexity]);

  return { containerRef, mapRef };
}
