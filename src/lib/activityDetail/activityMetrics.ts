import type {
  ActivityDetail,
  ActivityRange,
  ActivitySample,
  PauseSegment
} from '@/types';

const DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM = [120, 140, 160, 180] as const;
const HEART_RATE_ZONE_COLORS = ['#FEE2E2', '#FCA5A5', '#F87171', '#DC2626', '#7F1D1D'] as const;
const MOVING_SPEED_THRESHOLD_MPS = 0.5;
const MOVING_MAX_SAMPLE_GAP_SECONDS = 300;
const DOMAIN_EPSILON = 1e-6;

export type HeartRateZoneSlice = {
  zoneIndex: number;
  label: string;
  rangeLabel: string;
  color: string;
  seconds: number;
  percent: number;
};

export type HeartRateZoneBreakdown = {
  slices: HeartRateZoneSlice[];
  trackedSeconds: number;
};

export type SelectedActivityMetrics = {
  durationSeconds: number;
  movingDurationSeconds: number;
  pausedDurationSeconds: number;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  heartRateZones: HeartRateZoneBreakdown | null;
};

export type SelectedActivity = {
  records: ActivitySample[];
  elapsedRange: [number, number];
  selection: ActivityRange | null;
  overlappingPauseCount: number;
  metrics: SelectedActivityMetrics;
};

type AxisRecord = {
  elapsedSeconds: number;
  coordinate: number;
};

function finiteNonNegative(value: unknown, fallback = 0): number {
  if (value == null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function intervalOverlapSeconds(start: number, end: number, min: number, max: number): number {
  return Math.max(0, Math.min(end, max) - Math.max(start, min));
}

function pauseOverlapSeconds(start: number, end: number, pauseSegments: PauseSegment[]): number {
  return pauseSegments.reduce(
    (total, pause) =>
      total +
      intervalOverlapSeconds(
        start,
        end,
        finiteNonNegative(pause.startElapsedSeconds),
        finiteNonNegative(pause.endElapsedSeconds)
      ),
    0
  );
}

function activeIntervalSeconds(start: number, end: number, pauseSegments: PauseSegment[]): number {
  return Math.max(0, end - start - pauseOverlapSeconds(start, end, pauseSegments));
}

function isInsidePause(elapsedSeconds: number, pauseSegments: PauseSegment[]): boolean {
  return pauseSegments.some(
    (pause) =>
      elapsedSeconds >= finiteNonNegative(pause.startElapsedSeconds) &&
      elapsedSeconds < finiteNonNegative(pause.endElapsedSeconds)
  );
}

function sortedActivityRecords(records: ActivitySample[]): ActivitySample[] {
  const allRecordsAreValid = records.every((record) => Number.isFinite(Number(record.elapsedSeconds)));
  const validRecords = allRecordsAreValid
    ? records
    : records.filter((record) => Number.isFinite(Number(record.elapsedSeconds)));
  const alreadySorted = validRecords.every(
    (record, index) => index === 0 || validRecords[index - 1].elapsedSeconds <= record.elapsedSeconds
  );
  return alreadySorted
    ? validRecords
    : validRecords.slice().sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
}

function fullElapsedDuration(detail: ActivityDetail, records: ActivitySample[]): number {
  return Math.max(
    finiteNonNegative(detail.summary.durationSeconds),
    records.length > 0 ? finiteNonNegative(records[records.length - 1].elapsedSeconds) : 0
  );
}

function movingTimeAt(elapsedSeconds: number, pauseSegments: PauseSegment[]): number {
  const elapsed = finiteNonNegative(elapsedSeconds);
  return Math.max(0, elapsed - pauseOverlapSeconds(0, elapsed, pauseSegments));
}

function buildAxisRecords(
  detail: ActivityDetail,
  records: ActivitySample[],
  axis: ActivityRange['axis'],
  endElapsedSeconds: number
): AxisRecord[] {
  if (axis === 'elapsedTime') {
    return [
      { elapsedSeconds: 0, coordinate: 0 },
      { elapsedSeconds: endElapsedSeconds, coordinate: endElapsedSeconds }
    ];
  }

  const totalDistanceM = finiteNonNegative(detail.summary.distanceM);
  const durationSeconds = Math.max(1, finiteNonNegative(detail.summary.durationSeconds, endElapsedSeconds));
  let lastDistanceM = 0;
  const axisRecords: AxisRecord[] = [{ elapsedSeconds: 0, coordinate: 0 }];

  for (const record of records) {
    const elapsedSeconds = finiteNonNegative(record.elapsedSeconds);
    const coordinate =
      axis === 'movingTime'
        ? movingTimeAt(elapsedSeconds, detail.pauseSegments)
        : (() => {
            const estimatedDistanceM = (elapsedSeconds / durationSeconds) * totalDistanceM;
            lastDistanceM = Math.max(lastDistanceM, finiteNonNegative(record.distanceM, estimatedDistanceM));
            return lastDistanceM / 1000;
          })();

    axisRecords.push({ elapsedSeconds, coordinate });
  }

  const endCoordinate =
    axis === 'movingTime'
      ? movingTimeAt(endElapsedSeconds, detail.pauseSegments)
      : Math.max(lastDistanceM / 1000, totalDistanceM / 1000);
  axisRecords.push({ elapsedSeconds: endElapsedSeconds, coordinate: endCoordinate });
  axisRecords.sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
  return axisRecords;
}

function elapsedAtCoordinate(
  axisRecords: AxisRecord[],
  coordinate: number,
  boundary: 'start' | 'end'
): number {
  const target = finiteNonNegative(coordinate);
  const exactMatches = axisRecords.filter(
    (record) => Math.abs(record.coordinate - target) <= DOMAIN_EPSILON
  );
  if (exactMatches.length > 0) {
    return boundary === 'start'
      ? Math.max(...exactMatches.map((record) => record.elapsedSeconds))
      : Math.min(...exactMatches.map((record) => record.elapsedSeconds));
  }

  for (let index = 1; index < axisRecords.length; index += 1) {
    const previous = axisRecords[index - 1];
    const current = axisRecords[index];
    if (current.coordinate <= previous.coordinate || target >= current.coordinate) {
      continue;
    }
    if (target <= previous.coordinate) {
      return previous.elapsedSeconds;
    }

    const ratio = (target - previous.coordinate) / (current.coordinate - previous.coordinate);
    return previous.elapsedSeconds + ratio * (current.elapsedSeconds - previous.elapsedSeconds);
  }

  return target <= axisRecords[0].coordinate
    ? axisRecords[0].elapsedSeconds
    : axisRecords[axisRecords.length - 1].elapsedSeconds;
}

function resolveElapsedRange(
  detail: ActivityDetail,
  records: ActivitySample[],
  selection: ActivityRange | null
): [number, number] {
  const endElapsedSeconds = fullElapsedDuration(detail, records);
  if (!selection) {
    return [0, endElapsedSeconds];
  }

  if (selection.axis === 'elapsedTime') {
    const start = Math.min(endElapsedSeconds, finiteNonNegative(selection.min));
    const end = Math.min(endElapsedSeconds, finiteNonNegative(selection.max));
    return [Math.min(start, end), Math.max(start, end)];
  }

  const axisRecords = buildAxisRecords(detail, records, selection.axis, endElapsedSeconds);
  const start = elapsedAtCoordinate(axisRecords, selection.min, 'start');
  const end = elapsedAtCoordinate(axisRecords, selection.max, 'end');
  return [Math.min(start, end), Math.max(start, end)];
}

export function normalizeHeartRateZoneUpperBounds(rawBounds: number[] | undefined): number[] {
  if (!Array.isArray(rawBounds) || rawBounds.length !== 4) {
    return [...DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM];
  }

  const parsed = rawBounds.map((value) => Math.round(Number(value)));
  if (parsed.some((value) => !Number.isFinite(value) || value < 40 || value > 260)) {
    return [...DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM];
  }

  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index] <= parsed[index - 1]) {
      return [...DEFAULT_HEART_RATE_ZONE_UPPER_BOUNDS_BPM];
    }
  }

  return parsed;
}

export function heartRateZoneIndexForBpm(bpm: number, upperBoundsBpm: number[]): number {
  for (let index = 0; index < upperBoundsBpm.length; index += 1) {
    if (bpm <= upperBoundsBpm[index]) {
      return index;
    }
  }

  return upperBoundsBpm.length;
}

function heartRateZoneRangeLabel(zoneIndex: number, upperBoundsBpm: number[]): string {
  if (zoneIndex === 0) {
    return `≤ ${upperBoundsBpm[0]} bpm`;
  }

  if (zoneIndex < upperBoundsBpm.length) {
    return `${upperBoundsBpm[zoneIndex - 1] + 1}-${upperBoundsBpm[zoneIndex]} bpm`;
  }

  return `≥ ${upperBoundsBpm[upperBoundsBpm.length - 1] + 1} bpm`;
}

export function calculateHeartRateZoneBreakdown(
  records: ActivitySample[],
  elapsedRange: [number, number],
  pauseSegments: PauseSegment[],
  upperBoundsBpm: number[]
): HeartRateZoneBreakdown | null {
  if (records.length < 2 || elapsedRange[1] <= elapsedRange[0]) {
    return null;
  }

  const zoneSeconds = [0, 0, 0, 0, 0];
  let previousHeartRateSample: { elapsedSeconds: number; heartRate: number } | null = null;

  for (const record of records) {
    const elapsedSeconds = finiteNonNegative(record.elapsedSeconds);
    if (isInsidePause(elapsedSeconds, pauseSegments)) {
      continue;
    }

    if (previousHeartRateSample != null && elapsedSeconds > previousHeartRateSample.elapsedSeconds) {
      const intervalStart = Math.max(previousHeartRateSample.elapsedSeconds, elapsedRange[0]);
      const intervalEnd = Math.min(elapsedSeconds, elapsedRange[1]);
      if (intervalEnd > intervalStart) {
        const zoneIndex = heartRateZoneIndexForBpm(previousHeartRateSample.heartRate, upperBoundsBpm);
        zoneSeconds[zoneIndex] += activeIntervalSeconds(intervalStart, intervalEnd, pauseSegments);
      }
    }

    const heartRate = Number(record.heartRate);
    if (Number.isFinite(heartRate) && heartRate > 0) {
      previousHeartRateSample = { elapsedSeconds, heartRate };
    }

    if (elapsedSeconds >= elapsedRange[1]) {
      break;
    }
  }

  const trackedSeconds = zoneSeconds.reduce((sum, seconds) => sum + seconds, 0);
  if (trackedSeconds <= 0) {
    return null;
  }

  const slices: HeartRateZoneSlice[] = zoneSeconds.map((seconds, zoneIndex) => ({
    zoneIndex,
    label: `Z${zoneIndex + 1}`,
    rangeLabel: heartRateZoneRangeLabel(zoneIndex, upperBoundsBpm),
    color: HEART_RATE_ZONE_COLORS[zoneIndex],
    seconds,
    percent: seconds / trackedSeconds
  }));

  return { slices, trackedSeconds };
}

function calculateHeartRateStats(records: ActivitySample[]): {
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
} {
  const values = records
    .map((record) => Number(record.heartRate))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    return { avgHr: null, minHr: null, maxHr: null };
  }

  return {
    avgHr: values.reduce((sum, value) => sum + value, 0) / values.length,
    minHr: Math.min(...values),
    maxHr: Math.max(...values)
  };
}

function estimateMovingDurationSeconds(
  records: ActivitySample[],
  elapsedRange: [number, number],
  pauseSegments: PauseSegment[]
): number {
  let movingSeconds = 0;

  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1];
    const current = records[index];
    const start = finiteNonNegative(previous.elapsedSeconds);
    const end = finiteNonNegative(current.elapsedSeconds);
    const intervalSeconds = end - start;
    if (intervalSeconds <= 0 || intervalSeconds > MOVING_MAX_SAMPLE_GAP_SECONDS) {
      continue;
    }

    const distanceDelta =
      previous.distanceM != null && current.distanceM != null && current.distanceM >= previous.distanceM
        ? current.distanceM - previous.distanceM
        : null;
    const speedMps = current.speedMps ?? (distanceDelta != null ? distanceDelta / intervalSeconds : null);
    if (speedMps == null || speedMps < MOVING_SPEED_THRESHOLD_MPS) {
      continue;
    }

    const clippedStart = Math.max(start, elapsedRange[0]);
    const clippedEnd = Math.min(end, elapsedRange[1]);
    if (clippedEnd > clippedStart) {
      movingSeconds += activeIntervalSeconds(clippedStart, clippedEnd, pauseSegments);
    }
  }

  return movingSeconds;
}

function calculateSelectedMovingDuration(
  detail: ActivityDetail,
  records: ActivitySample[],
  elapsedRange: [number, number]
): number {
  const selectedDurationSeconds = Math.max(0, elapsedRange[1] - elapsedRange[0]);
  const fullDurationSeconds = finiteNonNegative(detail.summary.durationSeconds);
  const fullMovingDurationSeconds = finiteNonNegative(detail.summary.movingDurationSeconds);

  if (detail.pauseSegments.length > 0) {
    const selectedActiveSeconds = activeIntervalSeconds(
      elapsedRange[0],
      elapsedRange[1],
      detail.pauseSegments
    );
    const fullActiveSeconds = activeIntervalSeconds(0, fullDurationSeconds, detail.pauseSegments);
    const timerScale = fullActiveSeconds > 0 ? Math.min(1, fullMovingDurationSeconds / fullActiveSeconds) : 0;
    return Math.min(selectedDurationSeconds, selectedActiveSeconds * timerScale);
  }

  if (fullDurationSeconds <= 0 || fullMovingDurationSeconds >= fullDurationSeconds - 0.5) {
    return selectedDurationSeconds;
  }

  return Math.min(
    selectedDurationSeconds,
    estimateMovingDurationSeconds(records, elapsedRange, detail.pauseSegments)
  );
}

export function deriveSelectedActivity(
  detail: ActivityDetail,
  activityRecords: ActivitySample[],
  selection: ActivityRange | null,
  heartRateZoneUpperBoundsBpm: number[]
): SelectedActivity {
  const records = sortedActivityRecords(activityRecords);
  const elapsedRange = resolveElapsedRange(detail, records, selection);
  const selectedRecords = records.filter(
    (record) =>
      record.elapsedSeconds >= elapsedRange[0] - DOMAIN_EPSILON &&
      record.elapsedSeconds <= elapsedRange[1] + DOMAIN_EPSILON
  );
  const selectedHeartRateStats = selection ? calculateHeartRateStats(selectedRecords) : null;
  const durationSeconds = selection
    ? Math.max(0, elapsedRange[1] - elapsedRange[0])
    : finiteNonNegative(detail.summary.durationSeconds);
  const movingDurationSeconds = selection
    ? calculateSelectedMovingDuration(detail, records, elapsedRange)
    : finiteNonNegative(detail.summary.movingDurationSeconds);

  return {
    records: selectedRecords,
    elapsedRange,
    selection,
    overlappingPauseCount: detail.pauseSegments.filter(
      (pause) =>
        intervalOverlapSeconds(
          elapsedRange[0],
          elapsedRange[1],
          finiteNonNegative(pause.startElapsedSeconds),
          finiteNonNegative(pause.endElapsedSeconds)
        ) > 0
    ).length,
    metrics: {
      durationSeconds,
      movingDurationSeconds,
      pausedDurationSeconds: Math.max(0, durationSeconds - movingDurationSeconds),
      avgHr: selection ? selectedHeartRateStats?.avgHr ?? null : detail.summary.avgHr,
      minHr: selectedHeartRateStats?.minHr ?? (selection ? null : detail.summary.minHr),
      maxHr: selectedHeartRateStats?.maxHr ?? (selection ? null : detail.summary.maxHr),
      heartRateZones: calculateHeartRateZoneBreakdown(
        records,
        elapsedRange,
        detail.pauseSegments,
        heartRateZoneUpperBoundsBpm
      )
    }
  };
}
