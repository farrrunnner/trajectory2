import type { ActivityDetail, ActivityRange, ActivitySample, PauseSegment } from '@/types';

// Do not interpolate through long recording gaps. Decoupling uses a stricter limit.
export const MAX_SAMPLE_GAP_SECONDS = 300;
export const RANGE_EPSILON = 1e-6;
export type ElapsedRange = [number, number];

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function prepareActivityRecords(records: ActivitySample[]): ActivitySample[] {
  // Loaded records are already normalized. Avoid copying/sorting them on every drag event.
  const nonNegative = ['distanceM', 'speedMps', 'cadence', 'powerWatts'] as const;
  const signed = ['altitudeM', 'lat', 'lon'] as const;
  if (records.every((record, index) => isFiniteNumber(record.elapsedSeconds) && record.elapsedSeconds >= 0 &&
    (index === 0 || record.elapsedSeconds > records[index - 1].elapsedSeconds) &&
    nonNegative.every((key) => record[key] == null || (isFiniteNumber(record[key]) && record[key]! >= 0)) &&
    signed.every((key) => record[key] == null || isFiniteNumber(record[key])) &&
    (record.heartRate == null || (isFiniteNumber(record.heartRate) && record.heartRate > 0)))) return records;
  const sorted = records
    .filter((record) => isFiniteNumber(record.elapsedSeconds) && record.elapsedSeconds >= 0)
    .map((record) => ({ ...record }))
    .sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  const result: ActivitySample[] = [];
  const nonNegativeFields = ['distanceM', 'speedMps', 'heartRate', 'cadence', 'powerWatts'] as const;
  const signedFields = ['altitudeM', 'lat', 'lon'] as const;
  for (const record of sorted) {
    for (const field of nonNegativeFields) {
      const value = record[field];
      if (!isFiniteNumber(value) || value < 0) record[field] = null;
    }
    if (record.heartRate === 0) record.heartRate = null;
    for (const field of signedFields) {
      if (!isFiniteNumber(record[field])) record[field] = null;
    }
    const previous = result[result.length - 1];
    if (previous?.elapsedSeconds === record.elapsedSeconds) {
      // Devices may emit separate sensor records at the same timestamp.
      for (const field of [...nonNegativeFields, ...signedFields]) {
        if (record[field] != null) previous[field] = record[field];
      }
      previous.timestamp = record.timestamp ?? previous.timestamp;
    } else {
      result.push(record);
    }
  }
  return result;
}

export function normalizePauseSegments(pauses: PauseSegment[]): PauseSegment[] {
  const result: PauseSegment[] = [];
  const valid = pauses
    .filter((pause) => isFiniteNumber(pause.startElapsedSeconds) && isFiniteNumber(pause.endElapsedSeconds))
    .map((pause) => ({ ...pause, startElapsedSeconds: Math.max(0, pause.startElapsedSeconds) }))
    .filter((pause) => pause.endElapsedSeconds > pause.startElapsedSeconds)
    .sort((left, right) => left.startElapsedSeconds - right.startElapsedSeconds);
  for (const pause of valid) {
    const previous = result[result.length - 1];
    if (previous && pause.startElapsedSeconds <= previous.endElapsedSeconds) {
      previous.endElapsedSeconds = Math.max(previous.endElapsedSeconds, pause.endElapsedSeconds);
      previous.durationSeconds = previous.endElapsedSeconds - previous.startElapsedSeconds;
    } else {
      result.push({ ...pause, durationSeconds: pause.endElapsedSeconds - pause.startElapsedSeconds });
    }
  }
  return result;
}

export function pauseOverlapSeconds(start: number, end: number, pauses: PauseSegment[]): number {
  return pauses.reduce((seconds, pause) => seconds + Math.max(
    0, Math.min(end, pause.endElapsedSeconds) - Math.max(start, pause.startElapsedSeconds)
  ), 0);
}

export const activeSeconds = (start: number, end: number, pauses: PauseSegment[]) =>
  Math.max(0, end - start - pauseOverlapSeconds(start, end, pauses));

export const movingTimeAt = (elapsed: number, pauses: PauseSegment[]) => activeSeconds(0, elapsed, pauses);

export const isInsidePause = (elapsed: number, pauses: PauseSegment[]) =>
  pauses.some((pause) => elapsed >= pause.startElapsedSeconds && elapsed < pause.endElapsedSeconds);

export function fullElapsedDuration(detail: ActivityDetail, records: ActivitySample[]): number {
  return Math.max(0, detail.summary.durationSeconds, records[records.length - 1]?.elapsedSeconds ?? 0);
}

export function hasDistanceData(records: ActivitySample[]): boolean {
  let first: number | null = null;
  let last: number | null = null;
  for (const record of records) {
    if (!isFiniteNumber(record.distanceM)) continue;
    if (last != null && record.distanceM < last) return false;
    first ??= record.distanceM;
    last = record.distanceM;
  }
  return first != null && last != null && last > first;
}

export function activityAxisDomain(
  detail: ActivityDetail, records: ActivitySample[], axis: ActivityRange['axis']
): [number, number] {
  const duration = fullElapsedDuration(detail, records);
  if (axis === 'elapsedTime') return [0, duration];
  if (axis === 'movingTime') return [0, movingTimeAt(duration, detail.pauseSegments)];
  const distances = records.filter((record) => record.distanceM != null);
  return [(distances[0]?.distanceM ?? 0) / 1000, (distances[distances.length - 1]?.distanceM ?? 0) / 1000];
}

function elapsedAtCoordinate(
  anchors: Array<{ elapsed: number; coordinate: number }>, target: number,
  boundary: 'start' | 'end', maxGap = Infinity
): number | null {
  const exact = anchors.filter((anchor) => Math.abs(anchor.coordinate - target) <= RANGE_EPSILON);
  if (exact.length) return boundary === 'start' ? exact[exact.length - 1].elapsed : exact[0].elapsed;
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1];
    const current = anchors[index];
    if (target > previous.coordinate && target < current.coordinate) {
      if (current.elapsed - previous.elapsed > maxGap) return null;
      return previous.elapsed + (target - previous.coordinate) /
        (current.coordinate - previous.coordinate) * (current.elapsed - previous.elapsed);
    }
  }
  return null;
}

export function resolveActivityRange(
  detail: ActivityDetail, records: ActivitySample[], selection: ActivityRange | null
): { selection: ActivityRange | null; elapsedRange: ElapsedRange | null } {
  const duration = fullElapsedDuration(detail, records);
  if (!selection) return { selection: null, elapsedRange: [0, duration] };
  if (!isFiniteNumber(selection.min) || !isFiniteNumber(selection.max)) {
    return { selection, elapsedRange: null };
  }
  if (selection.axis === 'distance' && !hasDistanceData(records)) {
    return { selection, elapsedRange: null };
  }
  const domain = activityAxisDomain(detail, records, selection.axis);
  const min = Math.max(domain[0], Math.min(selection.min, selection.max));
  const max = Math.min(domain[1], Math.max(selection.min, selection.max));
  if (max <= min) return { selection, elapsedRange: null };
  if (min <= domain[0] + RANGE_EPSILON && max >= domain[1] - RANGE_EPSILON) {
    return { selection: null, elapsedRange: [0, duration] };
  }
  const normalized = { ...selection, min, max };
  if (selection.axis === 'elapsedTime') return { selection: normalized, elapsedRange: [min, max] };
  const anchors = selection.axis === 'movingTime'
    ? [0, duration, ...detail.pauseSegments.flatMap((pause) => [pause.startElapsedSeconds, pause.endElapsedSeconds])]
      .filter((elapsed) => elapsed >= 0 && elapsed <= duration)
      .sort((left, right) => left - right)
      .map((elapsed) => ({ elapsed, coordinate: movingTimeAt(elapsed, detail.pauseSegments) }))
    : records.filter((record) => record.distanceM != null)
      .map((record) => ({ elapsed: record.elapsedSeconds, coordinate: record.distanceM! / 1000 }));
  const gap = selection.axis === 'distance' ? MAX_SAMPLE_GAP_SECONDS : Infinity;
  const start = elapsedAtCoordinate(anchors, min, 'start', gap);
  const end = elapsedAtCoordinate(anchors, max, 'end', gap);
  return {
    selection: normalized,
    elapsedRange: start != null && end != null && end > start ? [start, end] : null
  };
}

export function sampleAtElapsed(records: ActivitySample[], elapsed: number): ActivitySample | null {
  for (let index = 0; index < records.length; index += 1) {
    const current = records[index];
    if (Math.abs(current.elapsedSeconds - elapsed) <= RANGE_EPSILON) return { ...current, elapsedSeconds: elapsed };
    if (current.elapsedSeconds < elapsed) continue;
    const previous = records[index - 1];
    if (!previous || current.elapsedSeconds - previous.elapsedSeconds > MAX_SAMPLE_GAP_SECONDS) return null;
    const fraction = (elapsed - previous.elapsedSeconds) / (current.elapsedSeconds - previous.elapsedSeconds);
    const result = { ...previous, elapsedSeconds: elapsed, timestamp: null };
    for (const key of ['distanceM', 'altitudeM', 'lat', 'lon'] as const) {
      const left = previous[key];
      const right = current[key];
      result[key] = left != null && right != null ? left + (right - left) * fraction : null;
    }
    return result;
  }
  return null;
}

export function clipActivityRecords(records: ActivitySample[], range: ElapsedRange): ActivitySample[] {
  const result = records.filter((record) => record.elapsedSeconds > range[0] && record.elapsedSeconds < range[1]);
  const first = sampleAtElapsed(records, range[0]);
  const last = sampleAtElapsed(records, range[1]);
  if (first) result.unshift(first);
  if (last && range[1] > range[0]) result.push(last);
  return result;
}

export function activityChartSamples(
  detail: ActivityDetail, records: ActivitySample[], range: ElapsedRange | null,
  hidePauses: boolean, maxSamples: number
): ActivitySample[] {
  const visible = range ? clipActivityRecords(records, range) : records;
  const points = hidePauses
    ? visible.filter((record) => !isInsidePause(record.elapsedSeconds, detail.pauseSegments))
      .map((record) => ({ ...record, elapsedSeconds: movingTimeAt(record.elapsedSeconds, detail.pauseSegments) }))
    : visible;
  const cap = Math.max(2, Math.min(20_000, Math.floor(maxSamples) || 2000));
  if (points.length <= cap) return points;
  return Array.from({ length: cap }, (_, index) => points[Math.round(index * (points.length - 1) / (cap - 1))]);
}
