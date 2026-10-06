import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  addMonths,
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfToday,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays
} from 'date-fns';

import { SparkBars } from '@/components/dashboard/SparkBars';
import { listActivities } from '@/lib/tauri';
import {
  CALENDAR_METRIC_OPTIONS,
  WEEKDAY_HEADERS,
  ZERO_TOTALS,
  type CalendarBarMetric,
  type CalendarMode,
  buildCalendarData,
  buildMonthSummaries,
  computeWeeklyStreak,
  formatCalendarMetric,
  formatCalendarMetricWithUnit,
  metricValue,
  selectPrimaryActivity,
  summarizeActivities,
  weekLabel
} from '@/lib/dashboard/calendar';
import { formatDateTime, formatDistanceKm, formatDuration } from '@/lib/format';
import { MetricCard } from '@/components/MetricCard';
import { useAppStore } from '@/store/useAppStore';
import { useUiStateStore } from '@/store/useUiStateStore';
import type { ActivitySummary } from '@/types';

export function DashboardPage() {
  const navigate = useNavigate();
  const scanDone = useAppStore((state) => state.scanDone);
  const settings = useAppStore((state) => state.settings);
  const getCachedActivities = useAppStore((state) => state.getCachedActivities);
  const setCachedActivities = useAppStore((state) => state.setCachedActivities);

  const mode = useUiStateStore((state) => state.dashboardMode) as CalendarMode;
  const setMode = useUiStateStore((state) => state.setDashboardMode);
  const selectedYear = useUiStateStore((state) => state.dashboardSelectedYear);
  const setSelectedYear = useUiStateStore((state) => state.setDashboardSelectedYear);
  const selectedMonthIndex = useUiStateStore((state) => state.dashboardSelectedMonthIndex);
  const setSelectedMonthIndex = useUiStateStore((state) => state.setDashboardSelectedMonthIndex);
  const barMetric = useUiStateStore((state) => state.dashboardBarMetric) as CalendarBarMetric;
  const setBarMetric = useUiStateStore((state) => state.setDashboardBarMetric);
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const [pinnedBarIndex, setPinnedBarIndex] = useState<number | null>(null);
  const [hoverPulseTick, setHoverPulseTick] = useState(0);

  const [allActivities, setAllActivities] = useState<ActivitySummary[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const selectedMonthDate = useMemo(
    () => new Date(selectedYear, selectedMonthIndex, 1),
    [selectedYear, selectedMonthIndex]
  );

  useEffect(() => {
    setHoveredBarIndex(null);
    setPinnedBarIndex(null);
  }, [mode, selectedYear, selectedMonthIndex, barMetric]);

  const dashboardCacheKey = useMemo(
    () =>
      JSON.stringify({
        scope: 'dashboard-all-activities',
        importFolderPath: settings?.importFolderPath ?? null,
        lastScanTimestamp: settings?.lastScanTimestamp ?? null
      }),
    [settings?.importFolderPath, settings?.lastScanTimestamp]
  );

  useEffect(() => {
    const cached = getCachedActivities(dashboardCacheKey);
    if (cached) {
      setAllActivities(cached);
      setDashboardLoading(false);
      setDashboardError(null);
      return;
    }

    let cancelled = false;

    const loadAllActivities = async () => {
      try {
        setDashboardLoading(true);
        setDashboardError(null);
        const activities = await listActivities();
        if (cancelled) {
          return;
        }
        setAllActivities(activities);
        setCachedActivities(dashboardCacheKey, activities);
      } catch (err) {
        if (!cancelled) {
          setDashboardError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      }
    };

    void loadAllActivities();

    return () => {
      cancelled = true;
    };
  }, [dashboardCacheKey, getCachedActivities, scanDone, setCachedActivities]);

  const yearActivities = useMemo(
    () =>
      allActivities.filter((activity) => {
        const date = parseISO(activity.activityStart);
        return !Number.isNaN(date.getTime()) && date.getFullYear() === selectedYear;
      }),
    [allActivities, selectedYear]
  );

  const { weeklySummary, yearlySummary, weeklyStreak } = useMemo(() => {
    const today = startOfToday();
    const weekStart = subDays(today, 6);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const isInRange = (activity: ActivitySummary, start: Date, end: Date) => {
      const date = parseISO(activity.activityStart);
      return !Number.isNaN(date.getTime()) && date >= start && date <= end;
    };

    const weekActivities = allActivities.filter((activity) => isInRange(activity, weekStart, endOfDay(today)));
    const ytdActivities = allActivities.filter((activity) => isInRange(activity, yearStart, endOfDay(today)));

    return {
      weeklySummary: summarizeActivities(weekActivities),
      yearlySummary: summarizeActivities(ytdActivities),
      weeklyStreak: computeWeeklyStreak(allActivities)
    };
  }, [allActivities]);

  const calendarData = useMemo(() => buildCalendarData(yearActivities), [yearActivities]);

  const monthSummaries = useMemo(
    () => buildMonthSummaries(selectedYear, calendarData.monthBuckets, barMetric),
    [barMetric, calendarData.monthBuckets, selectedYear]
  );

  const yearWeekStarts = useMemo(() => {
    const yearStart = startOfYear(new Date(selectedYear, 0, 1));
    const yearEnd = new Date(selectedYear, 11, 31);
    return eachWeekOfInterval(
      {
        start: startOfWeek(yearStart, { weekStartsOn: 1 }),
        end: endOfWeek(yearEnd, { weekStartsOn: 1 })
      },
      { weekStartsOn: 1 }
    );
  }, [selectedYear]);

  const yearBarValues = useMemo(
    () =>
      yearWeekStarts.map((weekStart) => {
        const weekKey = format(weekStart, 'yyyy-MM-dd');
        return metricValue(calendarData.weeklyTotals.get(weekKey) ?? ZERO_TOTALS, barMetric);
      }),
    [barMetric, calendarData.weeklyTotals, yearWeekStarts]
  );

  const selectedMonthBucket = calendarData.monthBuckets[selectedMonthIndex];
  const selectedMonthTotals = selectedMonthBucket?.totals ?? ZERO_TOTALS;
  const selectedMonthBars = monthSummaries[selectedMonthIndex]?.dayValues ?? [];
  const activeTotals = mode === 'year' ? calendarData.yearTotals : selectedMonthTotals;
  const activeBars = mode === 'year' ? yearBarValues : selectedMonthBars;
  const activeBarIndex = hoveredBarIndex ?? pinnedBarIndex;
  const activityMap = selectedMonthBucket?.activitiesByDay ?? new Map<string, ActivitySummary[]>();
  const seriesLabel = mode === 'year' ? `${activeBars.length} weeks` : `${activeBars.length} days`;
  const hoveredWeekStart = mode === 'year' && activeBarIndex != null ? yearWeekStarts[activeBarIndex] ?? null : null;
  const hoveredWeekDaysByMonth = useMemo(() => {
    if (mode !== 'year' || !hoveredWeekStart) {
      return new Map<number, number[]>();
    }

    const weekDays = eachDayOfInterval({
      start: hoveredWeekStart,
      end: endOfWeek(hoveredWeekStart, { weekStartsOn: 1 })
    });
    const indicesByMonth = new Map<number, number[]>();

    for (const day of weekDays) {
      if (day.getFullYear() !== selectedYear) {
        continue;
      }
      const monthIndex = day.getMonth();
      const dayIndex = day.getDate() - 1;
      const existing = indicesByMonth.get(monthIndex) ?? [];
      existing.push(dayIndex);
      indicesByMonth.set(monthIndex, existing);
    }

    return indicesByMonth;
  }, [hoveredWeekStart, mode, selectedYear]);
  const hoveredDayKey =
    mode === 'month' && activeBarIndex != null
      ? format(new Date(selectedYear, selectedMonthIndex, activeBarIndex + 1), 'yyyy-MM-dd')
      : null;

  const monthGridDays = useMemo(() => {
    const monthStart = startOfMonth(selectedMonthDate);
    const monthEnd = endOfMonth(selectedMonthDate);
    return eachDayOfInterval({
      start: startOfWeek(monthStart, { weekStartsOn: 1 }),
      end: endOfWeek(monthEnd, { weekStartsOn: 1 })
    });
  }, [selectedMonthDate]);

  const shiftYear = (direction: -1 | 1) => {
    setSelectedYear(selectedYear + direction);
    setMode('year');
  };

  const shiftMonth = (direction: -1 | 1) => {
    const shifted = addMonths(selectedMonthDate, direction);
    setSelectedYear(shifted.getFullYear());
    setSelectedMonthIndex(shifted.getMonth());
    setMode('month');
  };

  const activateCalendarBar = (index: number) => {
    setHoveredBarIndex(index);
    setHoverPulseTick((tick) => tick + 1);

    if (mode === 'year') {
      setPinnedBarIndex(null);
      const weekStart = yearWeekStarts[index];
      if (!weekStart) {
        return;
      }
      const weekDays = eachDayOfInterval({
        start: weekStart,
        end: endOfWeek(weekStart, { weekStartsOn: 1 })
      });
      const inYearDay = weekDays.find((day) => day.getFullYear() === selectedYear);
      if (!inYearDay) {
        return;
      }
      setSelectedMonthIndex(inYearDay.getMonth());
      setMode('month');
      return;
    }

    const daysInMonth = selectedMonthBars.length;
    if (index < 0 || index >= daysInMonth) {
      return;
    }
    const clickedDate = new Date(selectedYear, selectedMonthIndex, index + 1);
    const clickedDayKey = format(clickedDate, 'yyyy-MM-dd');
    const dayActivities = activityMap.get(clickedDayKey) ?? [];
    const targetActivity = selectPrimaryActivity(dayActivities, barMetric) ?? dayActivities[0] ?? null;
    if (!targetActivity) {
      setPinnedBarIndex((current) => (current === index ? null : index));
      return;
    }
    navigate(`/activities/${targetActivity.id}`);
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Dashboard</p>
        <h2 className="mt-2 text-3xl font-semibold text-foreground">Training Overview</h2>
      </header>

      {dashboardError ? <p className="rounded-lg bg-accent/20 p-3 text-sm text-accent">{dashboardError}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Weekly Distance"
          value={formatDistanceKm(weeklySummary?.totalDistanceM ?? 0)}
          subLabel={`${weeklySummary?.activityCount ?? 0} activities`}
        />
        <MetricCard
          label="Weekly Time"
          value={formatDuration(weeklySummary?.totalTimeS ?? 0)}
          subLabel="Last 7 days"
        />
        <MetricCard
          label="Year-to-Date Distance"
          value={formatDistanceKm(yearlySummary?.totalDistanceM ?? 0)}
          subLabel={`${yearlySummary?.activityCount ?? 0} activities`}
        />
        <MetricCard
          label="Year-to-Date Elevation"
          value={`${Math.round(yearlySummary?.totalElevationM ?? 0)} m`}
        />
        <article className="relative overflow-hidden rounded-xl border border-border bg-panel p-4">
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgb(var(--color-accent-soft) / 0), rgb(var(--color-accent-soft) / 0.7), rgb(var(--color-accent) / 0))'
            }}
          />
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Weekly Streak</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-2xl font-semibold leading-none text-foreground">{weeklyStreak.count}</p>
              <p className="mt-1 text-xs text-muted">
                {weeklyStreak.count === 1 ? 'consecutive week' : 'consecutive weeks'}
              </p>
            </div>
            {weeklyStreak.status !== 'none' ? (
              <span
                className={`grid h-9 w-9 place-items-center ${
                  weeklyStreak.status === 'active' ? 'text-accent' : 'text-muted'
                }`}
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4.5 w-4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M13 2 6.5 12h4.8L10.8 22 18 11.5h-5Z" />
                </svg>
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted">
            {weeklyStreak.status === 'active'
              ? 'At least one activity each week.'
              : weeklyStreak.status === 'pending'
                ? 'No activity recorded this week yet.'
                : 'No current weekly streak.'}
          </p>
        </article>
      </div>

      <section className="rounded-xl border border-border bg-panel p-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-3xl font-semibold text-foreground">Training Calendar</h3>
            {mode === 'year' ? (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-3 text-sm text-muted hover:text-foreground"
                  onClick={() => shiftYear(-1)}
                >
                  &lt;
                </button>
                <span className="font-semibold text-foreground">{selectedYear}</span>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-3 text-sm text-muted hover:text-foreground"
                  onClick={() => shiftYear(1)}
                >
                  &gt;
                </button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold text-foreground"
                  onClick={() => setMode('year')}
                >
                  {selectedYear}
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-3 text-sm text-muted hover:text-foreground"
                  onClick={() => shiftMonth(-1)}
                >
                  &lt;
                </button>
                <span className="font-semibold uppercase text-foreground">
                  {format(selectedMonthDate, 'MMM')}
                </span>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border px-3 text-sm text-muted hover:text-foreground"
                  onClick={() => shiftMonth(1)}
                >
                  &gt;
                </button>
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-2xl">
            <div className="flex min-h-16 items-end gap-3">
              <div className="min-w-0 flex-1">
                <SparkBars
                  values={activeBars}
                  ariaLabel={`Calendar bars for ${
                    mode === 'year' ? `${selectedYear}` : format(selectedMonthDate, 'MMMM yyyy')
                  }`}
                  interactive
                  activeIndex={activeBarIndex}
                  pulseTick={hoverPulseTick}
                  onActiveIndexChange={(index) => {
                    if (index == null) {
                      setHoveredBarIndex(null);
                      return;
                    }
                    setHoveredBarIndex(index);
                    setHoverPulseTick((tick) => tick + 1);
                  }}
                  onBarClick={activateCalendarBar}
                  renderActivePopover={(index) => {
                    const hoverValue = activeBars[index] ?? 0;

                    if (mode === 'year') {
                      const weekStart = yearWeekStarts[index];
                      if (!weekStart) {
                        return null;
                      }
                      const weekKey = format(weekStart, 'yyyy-MM-dd');
                      const weekActivities = calendarData.weeklyActivities.get(weekKey) ?? [];
                      const topActivity = selectPrimaryActivity(weekActivities, barMetric);

                      return (
                        <>
                          <p className="text-[10px] uppercase tracking-[0.14em] text-muted">
                            Week · {weekLabel(weekStart)}
                          </p>
                          <p className="mt-1 text-sm font-semibold text-foreground">
                            {formatCalendarMetricWithUnit(barMetric, hoverValue)}
                          </p>
                          {topActivity ? (
                            <p className="mt-1 text-[11px] text-muted">
                              {topActivity.title} · {formatDateTime(topActivity.activityStart)}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-muted">No workouts</p>
                          )}
                        </>
                      );
                    }

                    const hoverDate = new Date(selectedYear, selectedMonthIndex, index + 1);
                    const hoverKey = format(hoverDate, 'yyyy-MM-dd');
                    const hoverActivities = activityMap.get(hoverKey) ?? [];
                    const topActivity = selectPrimaryActivity(hoverActivities, barMetric);

                    return (
                      <>
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted">
                          {format(hoverDate, 'EEE dd.MM.yyyy')}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {formatCalendarMetricWithUnit(barMetric, hoverValue)}
                        </p>
                        {topActivity ? (
                          <p className="mt-1 text-[11px] text-muted">
                            {topActivity.title} · {formatDuration(topActivity.durationSeconds)} ·{' '}
                            {formatDistanceKm(topActivity.distanceM)}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] text-muted">No workouts</p>
                        )}
                      </>
                    );
                  }}
                />
              </div>
              <p className="whitespace-nowrap text-[10px] uppercase tracking-[0.16em] text-muted">
                {seriesLabel}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {CALENDAR_METRIC_OPTIONS.map((option) => {
                const active = barMetric === option.metric;
                const value = formatCalendarMetric(option.metric, metricValue(activeTotals, option.metric));

                return (
                  <button
                    key={option.metric}
                    type="button"
                    onClick={() => setBarMetric(option.metric)}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-accent bg-accent/10 text-foreground'
                        : 'border-border bg-bg/30 text-muted hover:text-foreground'
                    }`}
                  >
                    <p className={`text-2xl font-semibold ${active ? 'text-accent' : 'text-foreground'}`}>
                      {value}
                    </p>
                    <p className="text-xs uppercase tracking-[0.14em]">{option.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {dashboardLoading ? <p className="mt-4 text-sm text-muted">Loading calendar...</p> : null}

        {mode === 'year' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {monthSummaries.map((monthSummary) => {
              const monthDate = new Date(selectedYear, monthSummary.monthIndex, 1);
              const monthLabel = format(monthDate, 'MMM');
              const metricDisplay = formatCalendarMetric(
                barMetric,
                metricValue(monthSummary.totals, barMetric)
              );
              const hoveredWeekIndices = hoveredWeekDaysByMonth.get(monthSummary.monthIndex) ?? [];
              const yearHoveredMonth = mode === 'year' && hoveredWeekIndices.length > 0;
              const yearPopClass = hoverPulseTick % 2 === 0 ? 'calendar-pop-a' : 'calendar-pop-b';

              return (
                <button
                  key={monthSummary.monthIndex}
                  type="button"
                  onClick={() => {
                    setSelectedMonthIndex(monthSummary.monthIndex);
                    setMode('month');
                  }}
                  className={`rounded-lg border border-border bg-bg/30 p-3 text-left transition hover:border-accent/40 hover:bg-accent/5 ${
                    yearHoveredMonth
                      ? `relative z-10 -translate-y-0.5 border-accent bg-accent/10 ${yearPopClass}`
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <p className="text-base font-semibold uppercase text-foreground">{monthLabel}</p>
                    <p className="text-xs uppercase tracking-[0.14em] text-muted">
                      {monthSummary.activeDays} days
                    </p>
                  </div>
                  <p className="mt-3 text-3xl font-semibold text-foreground">{metricDisplay}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted">
                    {CALENDAR_METRIC_OPTIONS.find((option) => option.metric === barMetric)?.label}
                  </p>
                  <div className="mt-3">
                    <SparkBars
                      values={monthSummary.dayValues}
                      ariaLabel={`${monthLabel} daily bars`}
                      tone="muted"
                      activeIndices={yearHoveredMonth ? hoveredWeekIndices : undefined}
                      pulseTick={hoverPulseTick}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-5">
            <div className="grid grid-cols-7 rounded-t-lg border border-border bg-bg/40">
              {WEEKDAY_HEADERS.map((day) => (
                <p
                  key={day}
                  className="border-r border-border px-2 py-2 text-center text-[10px] uppercase tracking-[0.14em] text-muted last:border-r-0"
                >
                  {day}
                </p>
              ))}
            </div>
            <div className="grid grid-cols-7 border-x border-b border-border">
              {monthGridDays.map((day) => {
                const inCurrentMonth = isSameMonth(day, selectedMonthDate);
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayActivities = inCurrentMonth ? activityMap.get(dayKey) ?? [] : [];
                const hoveredDay = inCurrentMonth && hoveredDayKey === dayKey;
                const popClass = hoverPulseTick % 2 === 0 ? 'calendar-pop-a' : 'calendar-pop-b';
                const visibleActivities = dayActivities.slice(0, 3);
                const hiddenCount = Math.max(0, dayActivities.length - visibleActivities.length);

                return (
                  <div
                    key={dayKey}
                    className={`min-h-[75px] border-r border-t border-border p-2 text-xs transition-[background-color,transform] duration-200 last:border-r-0 ${
                      inCurrentMonth ? 'bg-bg/20' : 'bg-bg/10 text-muted/40'
                    } ${
                      hoveredDay
                        ? `relative z-10 -translate-y-0.5 bg-accent/10 ${popClass}`
                        : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={inCurrentMonth ? 'text-muted' : 'text-muted/40'}>
                        {format(day, 'd')}
                      </span>
                      {dayActivities.length ? (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            hoveredDay ? 'bg-accent text-white' : 'bg-accent/15 text-accent'
                          }`}
                        >
                          {dayActivities.length}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 space-y-1">
                      {visibleActivities.map((activity) => {
                        return (
                          <Link
                            key={activity.id}
                            to={`/activities/${activity.id}`}
                            title={`${formatDateTime(activity.activityStart)} · ${formatDistanceKm(
                              activity.distanceM
                            )} · ${formatDuration(activity.durationSeconds)}`}
                            className={`block truncate rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                              hoveredDay
                                ? `${popClass} bg-accent text-white`
                                : 'bg-accent/10 text-accent hover:bg-accent/20'
                            }`}
                          >
                            {activity.title}
                          </Link>
                        );
                      })}
                      {hiddenCount > 0 ? (
                        <p className="text-[10px] text-muted">+{hiddenCount} more</p>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
