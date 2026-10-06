import { Suspense, lazy, useEffect, useRef } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { advancedAnalyticsDataVersion, advancedAnalyticsRequestCacheKey } from '@/lib/analytics/cacheKey';
import { resolveAdvancedAnalyticsTimeRange } from '@/lib/analytics/timeRange';
import { runAdvancedAnalytics } from '@/lib/tauri';
import { Sidebar } from '@/components/Sidebar';
import { applyAccentThemeToDocument } from '@/lib/theme';
import { useAdvancedAnalyticsStore } from '@/store/useAdvancedAnalyticsStore';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';
import type { AdvancedAnalyticsRunRequest, AdvancedAnalyticsTimeRangeConfig } from '@/types';

const DashboardPage = lazy(async () => ({
  default: (await import('@/pages/DashboardPage')).DashboardPage
}));
const ActivitiesPage = lazy(async () => ({
  default: (await import('@/pages/ActivitiesPage')).ActivitiesPage
}));
const HeatmapPage = lazy(async () => ({
  default: (await import('@/pages/HeatmapPage')).HeatmapPage
}));
const AdvancedAnalyticsPage = lazy(async () => ({
  default: (await import('@/pages/AdvancedAnalyticsPage')).AdvancedAnalyticsPage
}));
const ActivityDetailPage = lazy(async () => ({
  default: (await import('@/pages/ActivityDetailPage')).ActivityDetailPage
}));
const SettingsPage = lazy(async () => ({
  default: (await import('@/pages/SettingsPage')).SettingsPage
}));
const OnboardingPage = lazy(async () => ({
  default: (await import('@/pages/OnboardingPage')).OnboardingPage
}));

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">
      {message}
    </main>
  );
}

function NavigationMemoryTracker() {
  const location = useLocation();
  const setLastSectionRoute = useUiStateStore((state) => state.setLastSectionRoute);

  useEffect(() => {
    const { pathname } = location;

    if (pathname === '/') {
      setLastSectionRoute('dashboard', pathname);
      return;
    }

    if (pathname === '/heatmap') {
      setLastSectionRoute('heatmap', pathname);
      return;
    }

    if (pathname === '/settings') {
      setLastSectionRoute('settings', pathname);
      return;
    }

    if (pathname === '/analytics') {
      setLastSectionRoute('analytics', pathname);
      return;
    }

    if (pathname === '/activities' || pathname.startsWith('/activities/')) {
      setLastSectionRoute('activities', '/activities');
    }
  }, [location, setLastSectionRoute]);

  return null;
}

function AppLayout() {
  return (
    <div className="flex min-h-screen bg-bg text-foreground">
      <NavigationMemoryTracker />
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<LoadingScreen message="Loading page..." />}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/activities" element={<ActivitiesPage />} />
            <Route path="/heatmap" element={<HeatmapPage />} />
            <Route path="/analytics" element={<AdvancedAnalyticsPage />} />
            <Route path="/activities/:id" element={<ActivityDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default function App() {
  const init = useAppStore((state) => state.init);
  const settings = useAppStore((state) => state.settings);
  const loadingSettings = useAppStore((state) => state.loadingSettings);
  const scanDone = useAppStore((state) => state.scanDone);
  const runScan = useAppStore((state) => state.runScan);
  const scanning = useAppStore((state) => state.scanning);
  const setCachedAdvancedAnalytics = useAppStore((state) => state.setCachedAdvancedAnalytics);
  const metrics = useAdvancedAnalyticsStore((state) => state.metrics);
  const streaks = useAdvancedAnalyticsStore((state) => state.streaks);
  const charts = useAdvancedAnalyticsStore((state) => state.charts);
  const startupScanPath = useRef<string | null>(null);
  const startupAdvancedAnalyticsDataVersion = useRef<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.darkMode ? 'dark' : 'light';
  }, [settings?.darkMode]);

  useEffect(() => {
    applyAccentThemeToDocument(settings?.accentTheme);
  }, [settings?.accentTheme]);

  useEffect(() => {
    const importFolderPath = settings?.importFolderPath;

    if (loadingSettings || !importFolderPath || scanning) {
      return;
    }

    if (startupScanPath.current === importFolderPath) {
      return;
    }

    startupScanPath.current = importFolderPath;
    void runScan().catch((error) => {
      startupScanPath.current = null;
      console.error('Automatic startup scan failed', error);
    });
  }, [loadingSettings, runScan, scanning, settings?.importFolderPath]);

  useEffect(() => {
    const importFolderPath = settings?.importFolderPath;
    const dataVersion = advancedAnalyticsDataVersion(settings);
    if (loadingSettings || scanning || !importFolderPath || !scanDone || !settings?.lastScanTimestamp) {
      return;
    }

    if (metrics.length === 0 && streaks.length === 0 && charts.length === 0) {
      return;
    }

    const startupDataVersionKey = JSON.stringify({ dataVersion, metrics, streaks, charts });
    if (startupAdvancedAnalyticsDataVersion.current === startupDataVersionKey) {
      return;
    }
    startupAdvancedAnalyticsDataVersion.current = startupDataVersionKey;

    const fixedAllTimeRange: AdvancedAnalyticsTimeRangeConfig = { preset: 'all' };
    const requestsByRangeKey = new Map<string, AdvancedAnalyticsRunRequest>();
    const appendRequestForRange = (timeRange: AdvancedAnalyticsTimeRangeConfig | undefined) => {
      const range = resolveAdvancedAnalyticsTimeRange(timeRange);
      const rangeKey = JSON.stringify(range);
      if (requestsByRangeKey.has(rangeKey)) {
        return;
      }
      requestsByRangeKey.set(rangeKey, {
        startDate: range.startDate,
        endDate: range.endDate,
        metrics,
        streaks,
        charts
      });
    };

    appendRequestForRange(fixedAllTimeRange);
    metrics.forEach((metric) => appendRequestForRange(metric.timeRange));
    streaks.forEach(() => appendRequestForRange(fixedAllTimeRange));
    charts.forEach((chart) => appendRequestForRange(chart.timeRange));

    const requests = Array.from(requestsByRangeKey.values());
    let cancelled = false;

    const computeStartupAdvancedAnalytics = async () => {
      await Promise.all(
        requests.map(async (request) => {
          try {
            const response = await runAdvancedAnalytics(request);
            if (!cancelled) {
              setCachedAdvancedAnalytics(
                advancedAnalyticsRequestCacheKey(request, dataVersion),
                response
              );
            }
          } catch (error) {
            console.error('Automatic startup advanced analytics computation failed', error);
          }
        })
      );
    };

    void computeStartupAdvancedAnalytics();

    return () => {
      cancelled = true;
      startupAdvancedAnalyticsDataVersion.current = null;
    };
  }, [
    charts,
    loadingSettings,
    metrics,
    scanning,
    scanDone,
    setCachedAdvancedAnalytics,
    settings?.importFolderPath,
    settings?.lastScanTimestamp,
    settings?.heartRateZoneUpperBoundsBpm,
    streaks
  ]);

  if (loadingSettings) {
    return <LoadingScreen message="Loading settings..." />;
  }

  if (!settings?.importFolderPath) {
    return (
      <Suspense fallback={<LoadingScreen message="Loading onboarding..." />}>
        <OnboardingPage />
      </Suspense>
    );
  }

  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  );
}
