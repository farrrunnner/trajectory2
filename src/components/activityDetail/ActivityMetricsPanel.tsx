import { MetricCard } from '@/components/MetricCard';
import { activityMetricLabel, type SelectedActivity } from '@/lib/activityDetail/activityMetrics';
import { formatDistanceKm, formatDuration, formatPaceMinKm, formatSpeedKmh } from '@/lib/format';
import type { ActivityDetail, ActivitySample } from '@/types';

const valueOrUnavailable = (value: number | null, format: (value: number) => string) =>
  value == null ? 'Unavailable' : format(value);

export function ActivityMetricsPanel({ detail, records, selected }: {
  detail: ActivityDetail;
  records: ActivitySample[];
  selected: SelectedActivity;
}) {
  const metrics = selected.metrics;
  const isSegment = selected.selection != null;
  const label = (value: string) => activityMetricLabel(value, isSegment);
  const hasDistance = detail.summary.distanceM > 0 || records.some((record) => record.distanceM != null);
  const hasSpeed = hasDistance || detail.summary.avgSpeedMps != null || records.some((record) => record.speedMps != null);
  const hasElevation = detail.summary.elevationGainM > 0 || records.some((record) => record.altitudeM != null);
  const hasHr = detail.summary.avgHr != null || detail.summary.minHr != null || detail.summary.maxHr != null ||
    records.some((record) => record.heartRate != null);
  const hasPauses = detail.pauseSegments.length > 0 || detail.summary.movingDurationSeconds < detail.summary.durationSeconds;
  const unavailableHint = isSegment ? 'Not enough recorded data in this segment.' : 'Not enough recorded data.';
  const hrDetails = [metrics.minHr != null ? `Min ${Math.round(metrics.minHr)} bpm` : null,
    metrics.maxHr != null ? `Max ${Math.round(metrics.maxHr)} bpm` : null].filter(Boolean).join(' · ');
  return (
    <div className="space-y-4 xl:sticky xl:top-4">
      {isSegment ? (
        <p className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-muted">
          {selected.elapsedRange
            ? `Selected segment: ${formatDuration(selected.elapsedRange[0])}–${formatDuration(selected.elapsedRange[1])} elapsed. Clear the selection to show the full workout.`
            : 'The selected segment has insufficient data to resolve its time boundaries.'}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <MetricCard label={label('Duration')} value={valueOrUnavailable(metrics.durationSeconds, formatDuration)} />
        <MetricCard label={label('Moving Time')} value={valueOrUnavailable(metrics.movingDurationSeconds, formatDuration)}
          subLabel={metrics.movingDurationSeconds == null ? unavailableHint : undefined} />
        {hasPauses ? <MetricCard label={label('Paused Time')} value={valueOrUnavailable(metrics.pausedDurationSeconds, formatDuration)}
          subLabel={metrics.pausedDurationSeconds == null ? unavailableHint : selected.overlappingPauseCount > 0
            ? `${selected.overlappingPauseCount} recorded pause${selected.overlappingPauseCount === 1 ? '' : 's'}` : undefined} /> : null}
        {hasDistance ? <MetricCard label={label('Distance')} value={valueOrUnavailable(metrics.distanceM, formatDistanceKm)}
          subLabel={metrics.distanceM == null ? unavailableHint : undefined} /> : null}
        {hasSpeed ? <MetricCard label={label('Avg Speed / Pace')}
          value={metrics.avgSpeedMps == null ? 'Unavailable' : `${formatSpeedKmh(metrics.avgSpeedMps)} · ${metrics.avgSpeedMps > 0 ? formatPaceMinKm(metrics.avgSpeedMps) : 'Pace unavailable'}`}
          subLabel={metrics.avgSpeedMps == null ? unavailableHint : metrics.maxSpeedMps != null ? `Max speed ${formatSpeedKmh(metrics.maxSpeedMps)}` : undefined} /> : null}
        {hasElevation ? <>
          <MetricCard label={label('Elevation Gain')} value={valueOrUnavailable(metrics.elevationGainM, (value) => `${Math.round(value)} m`)}
            subLabel={metrics.elevationGainM == null ? unavailableHint : undefined} />
          <MetricCard label={label('Elevation Loss')} value={valueOrUnavailable(metrics.elevationLossM, (value) => `${Math.round(value)} m`)}
            subLabel={metrics.elevationLossM == null ? unavailableHint : undefined} />
        </> : null}
        {hasHr ? <MetricCard label={label('Heart Rate')}
          value={metrics.avgHr != null ? `Avg ${Math.round(metrics.avgHr)} bpm` : hrDetails || 'Unavailable'}
          subLabel={metrics.avgHr != null ? hrDetails || undefined : hrDetails ? undefined : unavailableHint} /> : null}
        {records.some((record) => record.cadence != null) ? <MetricCard label={label('Avg Cadence')}
          value={valueOrUnavailable(metrics.avgCadence, (value) => `${Math.round(value)} rpm`)}
          subLabel={metrics.avgCadence == null ? unavailableHint : undefined} /> : null}
        {records.some((record) => record.powerWatts != null) ? <MetricCard label={label('Avg Power')}
          value={valueOrUnavailable(metrics.avgPowerWatts, (value) => `${Math.round(value)} W`)}
          subLabel={metrics.avgPowerWatts == null ? unavailableHint : undefined} /> : null}
      </div>
    </div>
  );
}
