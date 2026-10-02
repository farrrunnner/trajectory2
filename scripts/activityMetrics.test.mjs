import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create } from 'react-test-renderer';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';

let deriveSelectedActivity;
let server;
let data, ActivityMetricsPanel, useActivityData, useActivityDecoupling, plotting, cache;

before(async () => {
  server = await createServer({
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, entries: [] }
  });
  ({ deriveSelectedActivity } = await server.ssrLoadModule(
    '/src/lib/activityDetail/activityMetrics.ts'
  ));
  data = await server.ssrLoadModule('/src/lib/activityDetail/activityData.ts');
  ({ ActivityMetricsPanel } = await server.ssrLoadModule('/src/components/activityDetail/ActivityMetricsPanel.tsx'));
  ({ useActivityData } = await server.ssrLoadModule('/src/lib/activityDetail/useActivityData.ts'));
  ({ useActivityDecoupling } = await server.ssrLoadModule('/src/lib/activityDetail/useActivityDecoupling.ts'));
  plotting = await server.ssrLoadModule('/src/lib/charts/plottingEngine.ts');
  cache = await server.ssrLoadModule('/src/lib/analytics/cacheKey.ts');
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
      activityStart: '2000-01-01T10:00:00Z',
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
  assert.equal(selectedActivity.metrics.avgHr, 172.5);
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
  assert.equal(distanceSelection.metrics.avgHr, 172.5);
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
  assert.equal(selectedActivity.metrics.avgHr, 110);
  assert.equal(selectedActivity.metrics.minHr, 100);
  assert.equal(selectedActivity.metrics.maxHr, 130);
  assert.equal(selectedActivity.overlappingPauseCount, 0);
});

const range = (min, max, axis = 'elapsedTime') => ({ axis, min, max });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const select = ({ detail, records }, selection) => deriveSelectedActivity(detail, records, selection, zoneBounds);
function sensorFixture() {
  const f = fixture();
  f.detail.pauseSegments = [];
  f.detail.summary.movingDurationSeconds = 900;
  f.records.forEach((r, i) => {
    r.altitudeM = i <= 5 ? i * 10 : 100 - i * 10;
    r.cadence = 60 + i;
    r.powerWatts = i * 10;
  });
  return f;
}

test('sub-sample boundaries interpolate distance and elevation; speed is distance per moving second', () => {
  const f = sensorFixture();
  const selected = select(f, range(270, 330));
  assert.deepEqual(selected.elapsedRange, [270, 330]);
  close(selected.metrics.distanceM, 60);
  close(selected.metrics.avgSpeedMps, 1);
  close(selected.metrics.elevationGainM, 5);
  close(selected.metrics.elevationLossM, 5);
  close(selected.metrics.avgHr, 145);
  close(selected.metrics.avgCadence, 64.5);
  close(selected.metrics.avgPowerWatts, 45);
  const paused = select(fixture(), range(300, 600));
  close(paused.metrics.avgSpeedMps, 300 / 240);
});

test('a very short selection inside two samples stays selected and shares chart endpoints', () => {
  const f = sensorFixture();
  const selected = select(f, range(10.25, 11.75));
  close(selected.metrics.durationSeconds, 1.5);
  close(selected.metrics.distanceM, 1.5);
  const points = data.activityChartSamples(f.detail, f.records, selected.elapsedRange, false, 100);
  assert.deepEqual(points.map(p => p.elapsedSeconds), [10.25, 11.75]);
  assert.deepEqual(points.map(p => p.distanceM), [10.25, 11.75]);
});

test('distance and moving-time boundaries exclude stationary plateaus at selection edges', () => {
  const f = fixture();
  f.records = f.records.filter(r => r.elapsedSeconds !== 360 && r.elapsedSeconds !== 420);
  assert.deepEqual(select(f, range(360, 480, 'movingTime')).elapsedRange, [420, 540]);
  assert.deepEqual(select(f, range(240, 360, 'movingTime')).elapsedRange, [240, 360]);
  f.records = fixture().records.map(r => ({ ...r, distanceM: Math.min(r.elapsedSeconds, 360) + Math.max(0, r.elapsedSeconds - 420) }));
  assert.deepEqual(select(f, range(0.36, 0.48, 'distance')).elapsedRange, [420, 540]);
  assert.deepEqual(select(f, range(0.24, 0.36, 'distance')).elapsedRange, [240, 360]);
});

test('reversed ranges normalize, ranges clamp, and full-domain selection restores summary scope', () => {
  const f = fixture();
  assert.deepEqual(select(f, range(600, 300)).elapsedRange, [300, 600]);
  assert.deepEqual(select(f, range(-20, 180)).elapsedRange, [0, 180]);
  const full = select(f, range(-20, 1000));
  assert.equal(full.selection, null);
  assert.equal(full.metrics.avgHr, f.detail.summary.avgHr);
  for (const invalid of [range(5, 5), range(1000, 1200), range(NaN, 100), range(0.1, Infinity, 'distance')]) {
    const result = select(f, invalid);
    assert.equal(result.elapsedRange, null);
    assert.ok(Object.values(result.metrics).every(v => v === null));
    assert.notEqual(result.selection, null);
  }
});

test('missing or reset distance is unavailable rather than inferred from whole-workout totals', () => {
  const f = fixture();
  f.records.forEach(r => { r.distanceM = null; });
  assert.equal(select(f, range(60, 180)).metrics.distanceM, null);
  assert.equal(select(f, range(0.06, 0.18, 'distance')).elapsedRange, null);
  const reset = fixture();
  reset.records[2].distanceM = 10;
  assert.equal(select(reset, range(60, 180)).metrics.distanceM, null);
  assert.equal(data.hasDistanceData(reset.records), false);
});

test('missing sensors never fall back to summary HR, speed, or elevation', () => {
  const f = sensorFixture();
  f.records.forEach(r => { if (r.elapsedSeconds >= 60 && r.elapsedSeconds <= 300) {
    r.heartRate = null; r.speedMps = null; r.altitudeM = null; r.cadence = null; r.powerWatts = null;
  } });
  const metrics = select(f, range(60, 300)).metrics;
  for (const key of ['avgHr', 'minHr', 'maxHr', 'maxSpeedMps', 'elevationGainM', 'elevationLossM', 'avgCadence', 'avgPowerWatts']) {
    assert.equal(metrics[key], null, key);
  }
  assert.equal(metrics.distanceM, 240);
});

test('missing HR breaks interval holding and each interval contributes once', () => {
  const f = fixture();
  f.detail.pauseSegments = [];
  f.records = f.records.slice(0, 4).map((r, i) => ({ ...r, elapsedSeconds: i * 10, heartRate: i === 1 ? null : 140 }));
  const selected = select(f, range(0, 30));
  assert.equal(selected.metrics.heartRateZones.trackedSeconds, 20);
  assert.equal(selected.metrics.avgHr, null); // only two thirds covered
});

test('irregular sensor averages use interval durations and include valid zero power/cadence', () => {
  const f = sensorFixture();
  f.records = [0, 10, 90, 100].map((t, i) => ({ ...f.records[i], elapsedSeconds: t,
    distanceM: t, heartRate: i === 0 ? 100 : 200, cadence: 0, powerWatts: 0 }));
  const metrics = select(f, range(0, 100)).metrics;
  assert.equal(metrics.avgHr, 190);
  assert.equal(metrics.avgCadence, 0);
  assert.equal(metrics.avgPowerWatts, 0);
});

test('long recording gaps and missing leading/trailing coverage are unavailable', () => {
  const f = sensorFixture();
  f.records = [f.records[0], f.records[10], f.records[15]];
  const result = select(f, range(100, 200));
  assert.equal(result.metrics.avgHr, null);
  assert.equal(result.metrics.distanceM, null);
  assert.equal(result.metrics.elevationGainM, null);
  assert.equal(select(f, range(0.1, 0.2, 'distance')).elapsedRange, null);
  f.records = sensorFixture().records.slice(2, 5);
  const edges = select(f, range(0, 300));
  assert.equal(edges.metrics.avgHr, null);
  assert.equal(edges.metrics.distanceM, null);
});

test('overlapping pauses are merged and a fully paused selection has zero active time', () => {
  const f = fixture();
  f.detail.pauseSegments.push({ ...f.detail.pauseSegments[0], startElapsedSeconds: 390, endElapsedSeconds: 450 });
  const metrics = select(f, range(300, 600)).metrics;
  assert.equal(metrics.movingDurationSeconds, 210);
  assert.equal(metrics.pausedDurationSeconds, 90);
  const paused = select(f, range(370, 410)).metrics;
  assert.equal(paused.movingDurationSeconds, 0);
  assert.equal(paused.avgSpeedMps, null);
  assert.equal(paused.avgHr, null);
});

test('implicit stops are measured locally rather than by the whole-workout moving ratio', () => {
  const f = fixture();
  f.detail.pauseSegments = [];
  f.detail.summary.movingDurationSeconds = 600;
  f.records.forEach(r => { r.distanceM = Math.min(120, r.elapsedSeconds); });
  assert.equal(select(f, range(0, 120)).metrics.movingDurationSeconds, 120);
  assert.equal(select(f, range(120, 240)).metrics.movingDurationSeconds, 0);
  f.records.forEach(r => { r.distanceM = null; r.speedMps = null; });
  assert.equal(select(f, range(120, 240)).metrics.movingDurationSeconds, null);
});

test('record normalization merges duplicate timestamps and rejects invalid sensor values without mutating input', () => {
  const f = fixture();
  const duplicate = { ...f.records[1], heartRate: null, powerWatts: 200 };
  const invalid = { ...f.records[2], distanceM: -1, heartRate: 0, speedMps: NaN, altitudeM: -10 };
  const raw = [duplicate, invalid, f.records[0], f.records[1], { ...invalid, elapsedSeconds: NaN }];
  const prepared = data.prepareActivityRecords(raw);
  assert.deepEqual(prepared.map(r => r.elapsedSeconds), [0, 60, 120]);
  assert.equal(prepared[1].heartRate, 110);
  assert.equal(prepared[1].powerWatts, 200);
  assert.equal(prepared[2].heartRate, null);
  assert.equal(prepared[2].distanceM, null);
  assert.equal(prepared[2].altitudeM, -10);
  assert.equal(invalid.distanceM, -1);
});

test('chart cap and zoom preserve endpoints without changing full-resolution statistics', () => {
  const f = sensorFixture();
  const selected = select(f, range(90, 630));
  const sparse = data.activityChartSamples(f.detail, f.records, selected.elapsedRange, false, 3);
  assert.equal(sparse.length, 3);
  assert.equal(sparse[0].elapsedSeconds, 90);
  assert.equal(sparse.at(-1).elapsedSeconds, 630);
  const zoomed = data.activityChartSamples(f.detail, f.records, [300, 420], false, 3);
  assert.equal(zoomed.length, 3);
  assert.equal(zoomed[1].elapsedSeconds, 360);
  assert.equal(selected.metrics.distanceM, 540);
});

test('all metric card labels show scope and reset restores original labels and unit conversion', () => {
  const f = sensorFixture();
  const render = selection => renderToStaticMarkup(React.createElement(ActivityMetricsPanel, {
    ...f, selected: select(f, selection)
  }));
  const segment = render(range(270, 330));
  for (const label of ['Duration', 'Moving Time', 'Distance', 'Avg Speed / Pace', 'Elevation Gain', 'Elevation Loss', 'Heart Rate', 'Avg Cadence', 'Avg Power']) {
    assert.ok(segment.includes(`${label} (Segment)`), label);
  }
  assert.ok(segment.includes('0.06 km'));
  assert.ok(segment.includes('3.6 km/h'));
  assert.ok(segment.includes('16:40 /km'));
  assert.ok(!render(null).includes('(Segment)'));
  f.records.forEach(r => { r.distanceM = null; });
  assert.ok(render(range(60, 180)).includes('Unavailable'));
});

function hookHarness(hook, initialProps) {
  let latest;
  function Probe(props) { latest = hook(props); return null; }
  let tree;
  act(() => { tree = create(React.createElement(Probe, initialProps)); });
  return {
    get current() { return latest; },
    update(props) { act(() => tree.update(React.createElement(Probe, props))); },
    close() { act(() => tree.unmount()); }
  };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async fn => act(async () => { fn(); await Promise.resolve(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('drag, reverse drag, click reset, cancellation, and sub-sample zoom keep a single domain', () => {
  const h = hookHarness(() => plotting.usePlotDragZoom({ parseLabel: plotting.parseNumberChartLabel,
    compareValues: (a, b) => a - b }), {});
  const event = (value, chartX) => ({ activeLabel: value, chartX });
  act(() => h.current.onMouseDown(event(30, 100)));
  act(() => h.current.onMouseMove(event(10, 20)));
  assert.deepEqual(h.current.selectionDomain, [10, 30]);
  act(() => h.current.onMouseUp(event(10, 20)));
  assert.deepEqual(h.current.zoomDomain, [10, 30]);
  assert.equal(h.current.selectionDomain, null);
  act(() => h.current.onMouseDown(event(12, 30)));
  act(() => h.current.onMouseMove(event(18, 60)));
  act(() => h.current.onMouseLeave());
  assert.equal(h.current.selectionDomain, null);
  assert.deepEqual(h.current.zoomDomain, [10, 30]);
  act(() => h.current.onMouseDown(event(12, 30)));
  act(() => h.current.onMouseUp(event(12, 31)));
  assert.equal(h.current.zoomDomain, null);
  for (const value of [null, undefined, '', ' ', {}, NaN, Infinity]) assert.equal(plotting.parseNumberChartLabel(value), null);
  h.close();
});

test('switching activities or rescanning discards late data responses and publishes detail/samples atomically', async () => {
  globalThis.window = {};
  const pending = new Map();
  mockIPC((cmd, args) => {
    const call = deferred(); pending.set(`${cmd}:${args.id}`, call); return call.promise;
  });
  const h = hookHarness(({ id, version }) => useActivityData(id, version), { id: 1, version: 'a' });
  const firstDetail = pending.get('get_activity:1');
  const firstSamples = pending.get('get_activity_samples:1');
  h.update({ id: 2, version: 'a' });
  const f = fixture(); f.detail.summary.id = 2;
  await settle(() => pending.get('get_activity:2').resolve(f.detail));
  assert.equal(h.current.detail, null);
  await settle(() => pending.get('get_activity_samples:2').resolve({ samples: f.records }));
  assert.equal(h.current.detail.summary.id, 2);
  await settle(() => { firstDetail.resolve(fixture().detail); firstSamples.resolve({ samples: [] }); });
  assert.equal(h.current.detail.summary.id, 2);
  h.update({ id: 2, version: 'b' });
  assert.equal(h.current.detail, null);
  assert.equal(h.current.loading, true);
  h.update({ id: NaN, version: 'b' });
  assert.match(h.current.error, /Invalid activity/);
  h.close(); clearMocks(); delete globalThis.window;
});

test('decoupling debounce hides old values and rejects out-of-order segment, reset, and activity responses', async () => {
  globalThis.window = {};
  const pending = [];
  mockIPC((cmd, args) => { assert.equal(cmd, 'get_aerobic_decoupling'); const call = deferred(); pending.push({ ...call, request: args.request }); return call.promise; });
  const request = { activityId: 1, range: range(0, 900) };
  const h = hookHarness(({ request, version }) => useActivityDecoupling(request, version), { request, version: 'a' });
  await act(async () => { await delay(140); });
  h.update({ request: { activityId: 1, range: range(300, 600) }, version: 'a' });
  assert.equal(h.current.response, null);
  assert.equal(h.current.loading, true);
  await act(async () => { await delay(140); });
  await settle(() => pending[1].resolve({ paceHrDecouplingPct: 2, heartRateDriftPct: 3 }));
  await settle(() => pending[0].resolve({ paceHrDecouplingPct: 99, heartRateDriftPct: 99 }));
  assert.equal(h.current.response.paceHrDecouplingPct, 2);
  h.update({ request, version: 'a' });
  assert.equal(h.current.response, null);
  h.update({ request: { activityId: 2, range: range(0, 900) }, version: 'b' });
  await act(async () => { await delay(140); });
  assert.equal(pending.length, 3); // the reset request was cancelled before dispatch
  assert.equal(pending[2].request.activityId, 2);
  await settle(() => pending[2].reject(new Error('Synthetic failure')));
  assert.match(h.current.error, /Synthetic failure/);
  h.update({ request: null, version: 'b' });
  assert.equal(h.current.response, null);
  assert.equal(h.current.loading, false);
  h.close(); clearMocks(); delete globalThis.window;
});

test('analytics keys invalidate both settings-dependent values and renamed definitions', () => {
  const settings = { importFolderPath: 'synthetic-imports', lastScanTimestamp: 'scan-1', heartRateZoneUpperBoundsBpm: zoneBounds };
  const request = { metrics: [{ id: 'm1', name: 'Original', kind: 'base' }], streaks: [], charts: [] };
  const key = (s = settings, r = request) => cache.advancedAnalyticsRequestCacheKey(r, cache.advancedAnalyticsDataVersion(s));
  assert.notEqual(key(), key({ ...settings, heartRateZoneUpperBoundsBpm: [110, 130, 150, 170] }));
  assert.notEqual(key(), key({ ...settings, importFolderPath: 'different-synthetic-imports' }));
  assert.notEqual(key(), key({ ...settings, lastScanTimestamp: 'scan-2' }));
  assert.notEqual(key(), key(settings, { ...request, metrics: [{ ...request.metrics[0], name: 'Renamed' }] }));
  assert.equal(key(), key({ ...settings, darkMode: true }));
});


test('bundled synthetic analytics examples import with intact formula, streak, and chart references', async () => {
  const { parseAdvancedAnalyticsTransferFile } = await server.ssrLoadModule('/src/lib/analytics/transfer.ts');
  const text = readFileSync(new URL('../assets/trajectory-advanced-analytics-examples.json', import.meta.url), 'utf8');
  const parsed = parseAdvancedAnalyticsTransferFile(text);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.data.metrics.length, 7);
  assert.equal(parsed.data.streaks.length, 3);
  assert.equal(parsed.data.charts.length, 3);
  const ids = new Set(parsed.data.metrics.map(m => m.id));
  for (const metric of parsed.data.metrics.filter(m => m.kind === 'formula')) {
    assert.ok(ids.has(metric.formula.leftMetricId));
    assert.ok(ids.has(metric.formula.rightMetricId));
  }
  for (const streak of parsed.data.streaks) {
    assert.ok(ids.has(streak.metricId));
    assert.ok((streak.additionalMetricIds ?? []).every(id => ids.has(id)));
  }
  for (const chart of parsed.data.charts) assert.ok(chart.metricIds.every(id => ids.has(id)));
});
