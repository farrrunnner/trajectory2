import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable
} from '@tanstack/react-table';

import { listActivities } from '@/lib/tauri';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';
import {
  formatDateTime,
  formatDistanceKm,
  formatDuration,
  formatPaceMinKm,
  formatSpeedKmh
} from '@/lib/format';
import type { ActivityFilters, ActivitySummary } from '@/types';

const columnHelper = createColumnHelper<ActivitySummary>();
const CATEGORY_OPTIONS = [
  'Running',
  'Biking',
  'Strength',
  'Walking',
  'Hiking',
  'Swimming',
  'Rowing',
  'Mobility',
  'Other'
];

export function ActivitiesPage() {
  const navigate = useNavigate();
  const settings = useAppStore((state) => state.settings);
  const getCachedActivities = useAppStore((state) => state.getCachedActivities);
  const setCachedActivities = useAppStore((state) => state.setCachedActivities);
  const activitiesCategory = useUiStateStore((state) => state.activitiesCategory);
  const setActivitiesCategory = useUiStateStore((state) => state.setActivitiesCategory);
  const activitiesMinDistanceKm = useUiStateStore((state) => state.activitiesMinDistanceKm);
  const setActivitiesMinDistanceKm = useUiStateStore((state) => state.setActivitiesMinDistanceKm);
  const activitiesMaxDistanceKm = useUiStateStore((state) => state.activitiesMaxDistanceKm);
  const setActivitiesMaxDistanceKm = useUiStateStore((state) => state.setActivitiesMaxDistanceKm);
  const sorting = useUiStateStore((state) => state.activitiesSorting) as SortingState;
  const setSorting = useUiStateStore((state) => state.setActivitiesSorting);

  const [data, setData] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo<ActivityFilters>(
    () => ({
      category: activitiesCategory || undefined,
      minDistance: activitiesMinDistanceKm ? Number(activitiesMinDistanceKm) * 1000 : undefined,
      maxDistance: activitiesMaxDistanceKm ? Number(activitiesMaxDistanceKm) * 1000 : undefined
    }),
    [activitiesCategory, activitiesMaxDistanceKm, activitiesMinDistanceKm]
  );

  const cacheKey = useMemo(
    () =>
      JSON.stringify({
        query,
        importFolderPath: settings?.importFolderPath ?? null,
        lastScanTimestamp: settings?.lastScanTimestamp ?? null
      }),
    [query, settings?.importFolderPath, settings?.lastScanTimestamp]
  );

  const columns = useMemo(
    () => [
      columnHelper.accessor('title', {
        header: 'Title'
      }),
      columnHelper.accessor('activityStart', {
        header: 'Date/Time',
        cell: (info) => formatDateTime(info.getValue())
      }),
      columnHelper.accessor('category', {
        header: 'Category'
      }),
      columnHelper.accessor('distanceM', {
        header: 'Distance',
        cell: (info) => formatDistanceKm(info.getValue())
      }),
      columnHelper.accessor('durationSeconds', {
        header: 'Duration',
        cell: (info) => formatDuration(info.getValue())
      }),
      columnHelper.accessor('movingDurationSeconds', {
        header: 'Moving Time',
        cell: (info) => formatDuration(info.getValue())
      }),
      columnHelper.accessor('avgSpeedMps', {
        header: 'Avg Speed',
        cell: (info) => formatSpeedKmh(info.getValue())
      }),
      columnHelper.accessor('avgSpeedMps', {
        id: 'avgPace',
        header: 'Avg Pace',
        cell: (info) => formatPaceMinKm(info.getValue())
      }),
      columnHelper.accessor('elevationGainM', {
        header: 'Elevation Gain',
        cell: (info) => `${Math.round(info.getValue())} m`
      }),
      columnHelper.accessor('avgHr', {
        header: 'Avg HR',
        cell: (info) => (info.getValue() ? `${Math.round(info.getValue() ?? 0)} bpm` : 'n/a')
      })
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting
    },
    sortDescFirst: true,
    enableSortingRemoval: false,
    onSortingChange: (updater) =>
      setSorting(typeof updater === 'function' ? updater(sorting) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  useEffect(() => {
    const cached = getCachedActivities(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadActivities = async () => {
      setLoading(true);
      setError(null);
      try {
        const activities = await listActivities(query);
        if (cancelled) {
          return;
        }
        setData(activities);
        setCachedActivities(cacheKey, activities);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadActivities();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, getCachedActivities, query, setCachedActivities]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Activities</p>
        <h2 className="mt-2 text-3xl font-semibold text-foreground">All Workouts</h2>
      </header>

      <section className="rounded-xl border border-border bg-panel p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <select
            value={activitiesCategory}
            onChange={(event) => setActivitiesCategory(event.target.value)}
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
          >
            <option value="">All categories</option>
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="Min distance (km)"
            value={activitiesMinDistanceKm}
            onChange={(event) => setActivitiesMinDistanceKm(event.target.value)}
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
          <input
            type="number"
            min="0"
            step="0.1"
            placeholder="Max distance (km)"
            value={activitiesMaxDistanceKm}
            onChange={(event) => setActivitiesMaxDistanceKm(event.target.value)}
            className="rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        </div>
      </section>

      {error ? <p className="rounded-lg bg-accent/20 p-3 text-sm text-accent">{error}</p> : null}

      <section className="overflow-hidden rounded-xl border border-border bg-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-bg/60 text-xs uppercase tracking-[0.12em] text-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sortDirection = header.column.getIsSorted();
                    return (
                      <th key={header.id} className="px-4 py-3">
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className="flex items-center gap-1 text-left"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            <span
                              className={`inline-flex w-3 items-center justify-center text-[10px] leading-none ${
                                sortDirection ? 'text-accent opacity-100' : 'opacity-0'
                              }`}
                              aria-label={
                                sortDirection === 'asc'
                                  ? 'Sorted ascending'
                                  : sortDirection === 'desc'
                                    ? 'Sorted descending'
                                    : undefined
                              }
                              aria-hidden={!sortDirection}
                            >
                              {sortDirection === 'desc' ? '▼' : '▲'}
                            </span>
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  tabIndex={0}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-white/5 focus:outline-none focus-visible:bg-white/5"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') {
                      return;
                    }
                    event.preventDefault();
                    navigate(`/activities/${row.original.id}`);
                  }}
                  onClick={() => navigate(`/activities/${row.original.id}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-muted">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading ? <p className="p-4 text-sm text-muted">Loading activities...</p> : null}
        {!loading && data.length === 0 ? <p className="p-4 text-sm text-muted">No activities found.</p> : null}
      </section>
    </div>
  );
}
