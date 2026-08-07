import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let deriveSelectedActivity;
let server;

before(async () => {
  server = await createServer({
    appType: 'custom',
    server: { middlewareMode: true }
  });
  ({ deriveSelectedActivity } = await server.ssrLoadModule(
    '/src/lib/activityDetail/activityMetrics.ts'
  ));
});

after(async () => {
  await server?.close();
});

function fixture() {
  const records = Array.from({ length: 16 }, (_, index) => ({
    elapsedSeconds: index * 60,
    distanceM: index * 60,
    speedMps: 1,
    heartRate: 100 + index * 10,
    cadence: null,
    powerWatts: null,
    altitudeM: null,
    lat: null,
    lon: null,
    timestamp: null
  }));
  const detail = {
    summary: {
      id: 1,
      sourcePath: 'activity.fit',
      activityStart: '2026-08-07T10:00:00Z',
      title: 'Test activity',
      category: 'Running',
      sportType: 'Running',
      durationSeconds: 900,
      movingDurationSeconds: 840,
      distanceM: 900,
      elevationGainM: 0,
      avgSpeedMps: 1,
      maxSpeedMps: 1,
      avgHr: 175,
      minHr: 100,
      maxHr: 250,
      hasGps: false
    },
    track: [],
    pauseSegments: [
      {
        startElapsedSeconds: 360,
        endElapsedSeconds: 420,
        durationSeconds: 60,
        startTimestamp: null,
        endTimestamp: null
      }
    ],
    originalSampleCount: records.length
  };

  return { detail, records };
}

const zoneBounds = [120, 140, 160, 180];

test('clearing the selection restores authoritative full-workout metrics', () => {
  const { detail, records } = fixture();
  const selectedActivity = deriveSelectedActivity(detail, records, null, zoneBounds);

  assert.equal(selectedActivity.metrics.durationSeconds, 900);
  assert.equal(selectedActivity.metrics.movingDurationSeconds, 840);
  assert.equal(selectedActivity.metrics.avgHr, 175);
  assert.equal(selectedActivity.metrics.minHr, 100);
  assert.equal(selectedActivity.metrics.maxHr, 250);
  assert.equal(selectedActivity.metrics.heartRateZones.trackedSeconds, 840);
});

test('elapsed-time selections update duration, moving time, HR, and zones together', () => {
  const { detail, records } = fixture();
  const selectedActivity = deriveSelectedActivity(
    detail,
    records,
    { axis: 'elapsedTime', min: 300, max: 600 },
    zoneBounds
  );

  assert.equal(selectedActivity.metrics.durationSeconds, 300);
  assert.equal(selectedActivity.metrics.movingDurationSeconds, 240);
  assert.equal(selectedActivity.metrics.pausedDurationSeconds, 60);
  assert.equal(selectedActivity.metrics.avgHr, 175);
  assert.equal(selectedActivity.metrics.minHr, 150);
  assert.equal(selectedActivity.metrics.maxHr, 200);
  assert.equal(selectedActivity.overlappingPauseCount, 1);
  assert.equal(selectedActivity.metrics.heartRateZones.trackedSeconds, 240);
  assert.deepEqual(
    selectedActivity.metrics.heartRateZones.slices.map((slice) => slice.seconds),
    [0, 0, 60, 120, 60]
  );
});

test('moving-time and distance selections resolve to the corresponding record interval', () => {
  const { detail, records } = fixture();
  const movingSelection = deriveSelectedActivity(
    detail,
    records,
    { axis: 'movingTime', min: 300, max: 540 },
    zoneBounds
  );
  const distanceSelection = deriveSelectedActivity(
    detail,
    records,
    { axis: 'distance', min: 0.3, max: 0.6 },
    zoneBounds
  );

  assert.deepEqual(movingSelection.elapsedRange, [300, 600]);
  assert.equal(movingSelection.metrics.durationSeconds, 300);
  assert.equal(movingSelection.metrics.movingDurationSeconds, 240);
  assert.deepEqual(distanceSelection.elapsedRange, [300, 600]);
  assert.equal(distanceSelection.metrics.avgHr, 175);
});

test('changing the selected range produces a new metric set', () => {
  const { detail, records } = fixture();
  const selectedActivity = deriveSelectedActivity(
    detail,
    records,
    { axis: 'elapsedTime', min: 0, max: 180 },
    zoneBounds
  );

  assert.equal(selectedActivity.metrics.durationSeconds, 180);
  assert.equal(selectedActivity.metrics.movingDurationSeconds, 180);
  assert.equal(selectedActivity.metrics.avgHr, 115);
  assert.equal(selectedActivity.metrics.minHr, 100);
  assert.equal(selectedActivity.metrics.maxHr, 130);
  assert.equal(selectedActivity.overlappingPauseCount, 0);
});
