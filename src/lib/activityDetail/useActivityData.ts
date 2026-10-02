import { useEffect, useState } from 'react';
import { getActivity, getActivitySamples } from '@/lib/tauri';
import { normalizePauseSegments, prepareActivityRecords } from '@/lib/activityDetail/activityData';
import type { ActivityDetail, ActivitySample } from '@/types';

type ActivityData = { detail: ActivityDetail | null; records: ActivitySample[]; loading: boolean; error: string | null };
const EMPTY: ActivityData = { detail: null, records: [], loading: true, error: null };

export function useActivityData(activityId: number, dataVersion: string) {
  const key = `${activityId}:${dataVersion}`;
  const [state, setState] = useState<ActivityData & { key: string }>({ ...EMPTY, key });
  useEffect(() => {
    let cancelled = false;
    setState({ ...EMPTY, key });
    if (!Number.isSafeInteger(activityId) || activityId <= 0) {
      setState({ ...EMPTY, key, loading: false, error: 'Invalid activity ID.' });
      return;
    }
    void Promise.all([getActivity(activityId), getActivitySamples(activityId, { downsample: false })])
      .then(([detail, samples]) => {
        if (!cancelled) setState({ key, loading: false, error: null,
          detail: { ...detail, pauseSegments: normalizePauseSegments(detail.pauseSegments) },
          records: prepareActivityRecords(samples.samples) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ ...EMPTY, key, loading: false, error: String(error) });
      });
    return () => { cancelled = true; };
  }, [activityId, key]);
  // Do not render the previous activity even for the frame before the effect runs.
  return state.key === key ? state : EMPTY;
}
