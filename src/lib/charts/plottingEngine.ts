import { useCallback, useEffect, useRef, useState } from 'react';

export const CHART_DRAG_CLICK_THRESHOLD_PX = 4;
export const CHART_GRID_STROKE = 'rgba(var(--color-border), 0.75)';
export const CHART_AXIS_STROKE = 'rgb(var(--color-muted))';
export const CHART_TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid rgba(var(--color-border), 0.9)',
  background: 'rgb(var(--color-panel))',
  color: 'rgb(var(--color-foreground))',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)'
};
export const CHART_TOOLTIP_WRAPPER_STYLE = {
  zIndex: 20,
  pointerEvents: 'none'
} as const;
export const CHART_TOOLTIP_CURSOR_LINE = { stroke: '#000000', strokeWidth: 1 } as const;
export const CHART_SELECTION_FILL = '#d1d5db';
export const CHART_SELECTION_FILL_OPACITY = 0.42;
export const CHART_SELECTION_STROKE = '#e5e7eb';
export const CHART_SELECTION_STROKE_OPACITY = 1;
export const CHART_IS_ANIMATION_ACTIVE = false;
export const CHART_LINE_STROKE_WIDTH = 2;
export const CHART_LINE_ACTIVE_DOT = { r: 3, strokeWidth: 0 } as const;

export type PlotDomain<T> = [T, T];
export type PlotPointer<T> = { value: T; chartX: number };

export function parseNumberChartLabel(label: unknown): number | null {
  if (typeof label !== 'number' && (typeof label !== 'string' || label.trim() === '')) return null;
  const value = Number(label);
  return Number.isFinite(value) ? value : null;
}

export function parseStringChartLabel(label: unknown): string | null {
  return typeof label === 'string' && label.length > 0 ? label : null;
}

export function readChartPointer<T>(
  event: unknown,
  parseLabel: (label: unknown) => T | null
): PlotPointer<T> | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const maybePointer = event as { activeLabel?: unknown; chartX?: unknown };
  const value = parseLabel(maybePointer.activeLabel);
  if (value == null) {
    return null;
  }

  if (maybePointer.chartX == null) return null;
  const chartX = Number(maybePointer.chartX);
  if (!Number.isFinite(chartX)) {
    return null;
  }

  return { value, chartX };
}

export function normalizePlotDomain<T>(
  a: T,
  b: T,
  compareValues: (left: T, right: T) => number
): PlotDomain<T> {
  return compareValues(a, b) <= 0 ? [a, b] : [b, a];
}

export function isValueInDomain<T>(
  value: T,
  domain: PlotDomain<T>,
  compareValues: (left: T, right: T) => number
): boolean {
  return compareValues(value, domain[0]) >= 0 && compareValues(value, domain[1]) <= 0;
}

export function areDomainsEqual<T>(
  a: PlotDomain<T> | null,
  b: PlotDomain<T> | null,
  areValuesEqual: (left: T, right: T) => boolean
): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return areValuesEqual(a[0], b[0]) && areValuesEqual(a[1], b[1]);
}

interface UsePlotDragZoomOptions<T> {
  parseLabel: (label: unknown) => T | null;
  compareValues: (left: T, right: T) => number;
  values?: readonly T[];
  normalizeDomain?: (anchor: T, current: T) => PlotDomain<T> | null;
  areValuesEqual?: (left: T, right: T) => boolean;
  areDomainsEqual?: (a: PlotDomain<T> | null, b: PlotDomain<T> | null) => boolean;
  clickThresholdPx?: number;
  onPointerMove?: (event: unknown) => void;
}

export function usePlotDragZoom<T>({
  parseLabel,
  compareValues,
  values,
  normalizeDomain,
  areValuesEqual,
  areDomainsEqual: customAreDomainsEqual,
  clickThresholdPx = CHART_DRAG_CLICK_THRESHOLD_PX,
  onPointerMove
}: UsePlotDragZoomOptions<T>) {
  const [zoomDomain, setZoomDomain] = useState<PlotDomain<T> | null>(null);
  const [selectionDomain, setSelectionDomain] = useState<PlotDomain<T> | null>(null);
  const dragAnchorRef = useRef<PlotPointer<T> | null>(null);
  const dragCurrentRef = useRef<PlotPointer<T> | null>(null);

  const valueEquals = areValuesEqual ?? ((left: T, right: T) => compareValues(left, right) === 0);
  const domainEquals =
    customAreDomainsEqual ??
    ((left: PlotDomain<T> | null, right: PlotDomain<T> | null) =>
      areDomainsEqual(left, right, valueEquals));
  const toDomain =
    normalizeDomain ?? ((anchor: T, current: T) => normalizePlotDomain(anchor, current, compareValues));

  useEffect(() => {
    if (!zoomDomain || !values || values.length === 0) {
      return;
    }
    if (!values.some((value) => isValueInDomain(value, zoomDomain, compareValues))) {
      setZoomDomain(null);
    }
  }, [compareValues, values, zoomDomain]);

  const clearSelection = useCallback(() => {
    dragAnchorRef.current = null;
    dragCurrentRef.current = null;
    setSelectionDomain(null);
  }, []);

  const onMouseDown = useCallback((event: unknown) => {
    const pointer = readChartPointer(event, parseLabel);
    if (!pointer) {
      clearSelection();
      return;
    }

    dragAnchorRef.current = pointer;
    dragCurrentRef.current = pointer;
    setSelectionDomain([pointer.value, pointer.value]);
  }, [clearSelection, parseLabel]);

  const onMouseMove = useCallback((event: unknown) => {
    onPointerMove?.(event);

    const anchor = dragAnchorRef.current;
    if (!anchor) {
      return;
    }

    const pointer = readChartPointer(event, parseLabel);
    if (!pointer) {
      return;
    }

    const previousPointer = dragCurrentRef.current;
    if (
      previousPointer &&
      Math.abs(previousPointer.chartX - pointer.chartX) < 1 &&
      valueEquals(previousPointer.value, pointer.value)
    ) {
      return;
    }

    dragCurrentRef.current = pointer;
    setSelectionDomain(toDomain(anchor.value, pointer.value));
  }, [onPointerMove, parseLabel, toDomain, valueEquals]);

  const onMouseUp = useCallback((event: unknown) => {
    const anchor = dragAnchorRef.current;
    if (!anchor) {
      return;
    }

    const pointer = readChartPointer(event, parseLabel) ?? dragCurrentRef.current ?? anchor;
    const pixelDelta = Math.abs(pointer.chartX - anchor.chartX);
    clearSelection();

    if (pixelDelta < clickThresholdPx) {
      setZoomDomain((current) => (current ? null : current));
      return;
    }

    const nextDomain = toDomain(anchor.value, pointer.value);
    if (!nextDomain) {
      return;
    }

    setZoomDomain((current) => (domainEquals(current, nextDomain) ? current : nextDomain));
  }, [clearSelection, clickThresholdPx, domainEquals, parseLabel, toDomain]);

  const onMouseLeave = useCallback(() => {
    if (!dragAnchorRef.current) {
      return;
    }

    clearSelection();
  }, [clearSelection]);

  return {
    zoomDomain,
    selectionDomain,
    isZoomed: zoomDomain != null,
    setZoomDomain,
    clearSelection,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave
  };
}
