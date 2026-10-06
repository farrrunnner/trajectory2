import type { AdvancedAnalyticsRunRequest, Settings } from '@/types';

export function advancedAnalyticsDataVersion(settings: Settings | null): string {
  return JSON.stringify({
    folder: settings?.importFolderPath ?? null,
    scan: settings?.lastScanTimestamp ?? null,
    zones: settings?.heartRateZoneUpperBoundsBpm ?? [120, 140, 160, 180]
  });
}

export function advancedAnalyticsRequestCacheKey(
  request: AdvancedAnalyticsRunRequest,
  dataVersion: string | null
) {
  // Responses include definition names as well as values. Keep both in the key.
  return JSON.stringify({ request, dataVersion });
}
