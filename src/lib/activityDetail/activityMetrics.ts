import type { ActivityDetail, ActivityRange, ActivitySample, PauseSegment } from '@/types';
import {
  activeSeconds, clipActivityRecords, isInsidePause,
  MAX_SAMPLE_GAP_SECONDS, normalizePauseSegments, pauseOverlapSeconds,
  prepareActivityRecords, RANGE_EPSILON, resolveActivityRange, type ElapsedRange
} from '@/lib/activityDetail/activityData';

const DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM = [120, 140, 160, 180] as const;
const HEART_RATE_ZONE_COLORS = ['#FEE2E2', '#FCA5A5', '#F87171', '#DC2626', '#7F1D1D'] as const;
const MIN_SENSOR_COVERAGE = 0.8;
const MOVING_SPEED_THRESHOLD_MPS = 0.5;

export type HeartRateZoneSlice = {
  zoneIndex: number;
  label: string;
  rangeLabel: string;
  color: string;
  seconds: number;
  percent: number;
};
export type HeartRateZoneBreakdown = { slices: HeartRateZoneSlice[]; trackedSeconds: number };
export type SelectedActivityMetrics = {
  durationSeconds: number | null;
  movingDurationSeconds: number | null;
  pausedDurationSeconds: number | null;
  distanceM: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  avgPowerWatts: number | null;
  heartRateZones: HeartRateZoneBreakdown | null;
};
export type SelectedActivity = {
  records: ActivitySample[];
  elapsedRange: ElapsedRange | null;
  selection: ActivityRange | null;
  overlappingPauseCount: number;
  metrics: SelectedActivityMetrics;
};

const EMPTY_METRICS: SelectedActivityMetrics = {
  durationSeconds: null, movingDurationSeconds: null, pausedDurationSeconds: null,
  distanceM: null, avgSpeedMps: null, maxSpeedMps: null, elevationGainM: null, elevationLossM: null,
  avgHr: null, minHr: null, maxHr: null, avgCadence: null, avgPowerWatts: null, heartRateZones: null
};

export function normalizeHeartRateZoneUpperBounds(rawBounds: number[] | undefined): number[] {
  if (!Array.isArray(rawBounds) || rawBounds.length !== 4) return [...DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM];
  const parsed = rawBounds.map((value) => Math.round(Number(value)));
  if (parsed.some((value, index) => !Number.isFinite(value) || value < 40 || value > 260 ||
    (index > 0 && value <= parsed[index - 1]))) return [...DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM];
  return parsed;
}

export function heartRateZoneIndexForBpm(bpm: number, upperBoundsBpm: number[]): number {
  const index = upperBoundsBpm.findIndex((bound) => bpm <= bound);
  return index < 0 ? upperBoundsBpm.length : index;
}

function zoneRangeLabel(index: number, bounds: number[]): string {
  if (index === 0) return `≤ ${bounds[0]} bpm`;
  if (index < bounds.length) return `${bounds[index - 1] + 1}-${bounds[index]} bpm`;
  return `≥ ${bounds[bounds.length - 1] + 1} bpm`;
}

function forEachInterval(
  records: ActivitySample[], range: ElapsedRange, pauses: PauseSegment[],
  visit: (previous: ActivitySample, current: ActivitySample, seconds: number, intervalSeconds: number) => void
) {
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    const intervalSeconds = current.elapsedSeconds - previous.elapsedSeconds;
    if (intervalSeconds <= 0 || intervalSeconds > MAX_SAMPLE_GAP_SECONDS) continue;
    const start = Math.max(previous.elapsedSeconds, range[0]);
    const end = Math.min(current.elapsedSeconds, range[1]);
    if (end <= start) continue;
    const seconds = activeSeconds(start, end, pauses);
    if (seconds > 0) visit(previous, current, seconds, intervalSeconds);
  }
}

export function calculateHeartRateZoneBreakdown(
  rawRecords: ActivitySample[], range: ElapsedRange, rawPauses: PauseSegment[], upperBoundsBpm: number[]
): HeartRateZoneBreakdown | null {
  const records = prepareActivityRecords(rawRecords);
  const pauses = normalizePauseSegments(rawPauses);
  const bounds = normalizeHeartRateZoneUpperBounds(upperBoundsBpm);
  const zoneSeconds = [0, 0, 0, 0, 0];
  // Each adjacent interval is counted once. Missing readings break the held HR value.
  forEachInterval(records, range, pauses, (previous, _current, seconds) => {
    if (previous.heartRate != null && !isInsidePause(previous.elapsedSeconds, pauses)) {
      zoneSeconds[heartRateZoneIndexForBpm(previous.heartRate, bounds)] += seconds;
    }
  });
  const trackedSeconds = zoneSeconds.reduce((sum, seconds) => sum + seconds, 0);
  if (trackedSeconds <= 0) return null;
  return {
    trackedSeconds,
    slices: zoneSeconds.map((seconds, zoneIndex) => ({
      zoneIndex, label: `Z${zoneIndex + 1}`, rangeLabel: zoneRangeLabel(zoneIndex, bounds),
      color: HEART_RATE_ZONE_COLORS[zoneIndex], seconds, percent: seconds / trackedSeconds
    }))
  };
}

type SensorField = 'heartRate' | 'cadence' | 'powerWatts' | 'speedMps';
function sensorStats(records: ActivitySample[], range: ElapsedRange, pauses: PauseSegment[], field: SensorField) {
  let covered = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  forEachInterval(records, range, pauses, (previous, _current, seconds) => {
    const value = previous[field];
    if (value == null || isInsidePause(previous.elapsedSeconds, pauses)) return;
    covered += seconds;
    sum += value * seconds;
    min = Math.min(min, value);
    max = Math.max(max, value);
  });
  const duration = activeSeconds(range[0], range[1], pauses);
  if (covered <= 0 || covered + RANGE_EPSILON < duration * MIN_SENSOR_COVERAGE) {
    return { avg: null, min: null, max: null };
  }
  // Include actual endpoint observations for extrema, without assigning them extra time.
  for (const record of records) {
    const value = record[field];
    if (record.elapsedSeconds >= range[0] && record.elapsedSeconds <= range[1] && value != null &&
      !isInsidePause(record.elapsedSeconds, pauses)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return { avg: sum / covered, min, max };
}

function selectedDistance(records: ActivitySample[], range: ElapsedRange): number | null {
  const clipped = clipActivityRecords(records, range);
  const first = clipped[0];
  const last = clipped[clipped.length - 1];
  if (!first || !last || Math.abs(first.elapsedSeconds - range[0]) > RANGE_EPSILON ||
    Math.abs(last.elapsedSeconds - range[1]) > RANGE_EPSILON || first.distanceM == null || last.distanceM == null) return null;
  let previous = first.distanceM;
  for (const record of clipped) {
    if (record.distanceM == null) continue;
    if (record.distanceM < previous) return null;
    previous = record.distanceM;
  }
  return last.distanceM - first.distanceM;
}

function elevationChange(records: ActivitySample[], range: ElapsedRange, pauses: PauseSegment[]) {
  let covered = 0;
  let gain = 0;
  let loss = 0;
  forEachInterval(records, range, pauses, (previous, current, seconds, intervalSeconds) => {
    if (previous.altitudeM == null || current.altitudeM == null) return;
    covered += seconds;
    const change = (current.altitudeM - previous.altitudeM) * seconds / intervalSeconds;
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  });
  const duration = activeSeconds(range[0], range[1], pauses);
  if (duration <= 0 || covered + RANGE_EPSILON < duration) return { gain: null, loss: null };
  return { gain, loss };
}

function selectedMovingDuration(detail: ActivityDetail, records: ActivitySample[], range: ElapsedRange): number | null {
  if (records.length < 2) return null;
  const duration = range[1] - range[0];
  // Explicit timer pauses locate stopped time. Do not scale a segment by a whole-workout ratio.
  if (detail.pauseSegments.length > 0) return activeSeconds(range[0], range[1], detail.pauseSegments);
  if (detail.summary.movingDurationSeconds >= detail.summary.durationSeconds - 0.5) return duration;
  let moving = 0;
  let covered = 0;
  forEachInterval(records, range, [], (previous, current, seconds, intervalSeconds) => {
    const speed = previous.distanceM != null && current.distanceM != null && current.distanceM >= previous.distanceM
      ? (current.distanceM - previous.distanceM) / intervalSeconds : previous.speedMps;
    if (speed == null) return;
    covered += seconds;
    if (speed >= MOVING_SPEED_THRESHOLD_MPS) moving += seconds;
  });
  return covered + RANGE_EPSILON >= duration ? moving : null;
}

export function deriveSelectedActivity(
  rawDetail: ActivityDetail, activityRecords: ActivitySample[], selection: ActivityRange | null,
  heartRateZoneUpperBoundsBpm: number[]
): SelectedActivity {
  const records = prepareActivityRecords(activityRecords);
  const detail = { ...rawDetail, pauseSegments: normalizePauseSegments(rawDetail.pauseSegments) };
  const resolved = resolveActivityRange(detail, records, selection);
  const range = resolved.elapsedRange;
  if (!range) return { ...resolved, records: [], overlappingPauseCount: 0, metrics: { ...EMPTY_METRICS } };
  const isSegment = resolved.selection != null;
  const durationSeconds = isSegment ? range[1] - range[0] : detail.summary.durationSeconds;
  const movingDurationSeconds = isSegment
    ? selectedMovingDuration(detail, records, range) : detail.summary.movingDurationSeconds;
  const distanceM = isSegment ? selectedDistance(records, range) : detail.summary.distanceM;
  const hr = sensorStats(records, range, detail.pauseSegments, 'heartRate');
  const elevation = elevationChange(records, range, detail.pauseSegments);
  return {
    ...resolved,
    records: clipActivityRecords(records, range),
    overlappingPauseCount: detail.pauseSegments.filter((pause) => pauseOverlapSeconds(range[0], range[1], [pause]) > 0).length,
    metrics: {
      durationSeconds, movingDurationSeconds, distanceM,
      pausedDurationSeconds: movingDurationSeconds == null ? null : Math.max(0, durationSeconds - movingDurationSeconds),
      avgSpeedMps: isSegment
        ? distanceM != null && movingDurationSeconds != null && movingDurationSeconds > 0 ? distanceM / movingDurationSeconds : null
        : detail.summary.avgSpeedMps,
      maxSpeedMps: isSegment ? sensorStats(records, range, detail.pauseSegments, 'speedMps').max : detail.summary.maxSpeedMps,
      elevationGainM: isSegment ? elevation.gain : detail.summary.elevationGainM,
      elevationLossM: elevation.loss,
      avgHr: isSegment ? hr.avg : detail.summary.avgHr,
      minHr: isSegment ? hr.min : detail.summary.minHr,
      maxHr: isSegment ? hr.max : detail.summary.maxHr,
      avgCadence: sensorStats(records, range, detail.pauseSegments, 'cadence').avg,
      avgPowerWatts: sensorStats(records, range, detail.pauseSegments, 'powerWatts').avg,
      heartRateZones: calculateHeartRateZoneBreakdown(records, range, detail.pauseSegments, heartRateZoneUpperBoundsBpm)
    }
  };
}

export function activityMetricLabel(label: string, isSegment: boolean): string {
  return isSegment ? `${label} (Segment)` : label;
}
