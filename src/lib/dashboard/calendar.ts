import { endOfMonth, endOfWeek, format, parseISO, startOfToday, startOfWeek, subWeeks } from 'date-fns';

import { formatDuration } from '@/lib/format';
import type { ActivitySummary } from '@/types';

export type CalendarMode = 'year' | 'month';
export type CalendarBarMetric = 'durationHours' | 'distanceKm' | 'activities';

export interface AggregateTotals {
  durationHours: number;
  distanceKm: number;
  activities: number;
}

export interface MonthBucket {
  totals: AggregateTotals;
  dailyTotals: Map<string, AggregateTotals>;
  activitiesByDay: Map<string, ActivitySummary[]>;
}

export interface SummaryTotals {
  totalDistanceM: number;
  totalTimeS: number;
  totalElevationM: number;
  activityCount: number;
}

export type WeeklyStreakStatus = 'active' | 'pending' | 'none';

export interface WeeklyStreakDisplay {
  count: number;
  status: WeeklyStreakStatus;
}

export interface MonthSummary {
  monthIndex: number;
  totals: AggregateTotals;
  dayValues: number[];
  activeDays: number;
}

export interface CalendarData {
  monthBuckets: MonthBucket[];
  weeklyTotals: Map<string, AggregateTotals>;
  weeklyActivities: Map<string, ActivitySummary[]>;
  yearTotals: AggregateTotals;
}

export const ZERO_TOTALS: AggregateTotals = {
  durationHours: 0,
  distanceKm: 0,
  activities: 0
};

export const CALENDAR_METRIC_OPTIONS: Array<{ metric: CalendarBarMetric; label: string }> = [
  { metric: 'durationHours', label: 'Hours' },
  { metric: 'distanceKm', label: 'Kilometers' },
  { metric: 'activities', label: 'Activities' }
];

export const WEEKDAY_HEADERS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const createTotals = (): AggregateTotals => ({
  durationHours: 0,
  distanceKm: 0,
  activities: 0
});

const addToTotals = (target: AggregateTotals, activity: ActivitySummary) => {
  target.durationHours += activity.durationSeconds / 3600;
  target.distanceKm += activity.distanceM / 1000;
  target.activities += 1;
};

export const summarizeActivities = (activities: ActivitySummary[]): SummaryTotals =>
  activities.reduce(
    (totals, activity) => {
      totals.totalDistanceM += activity.distanceM;
      totals.totalTimeS += activity.durationSeconds;
      totals.totalElevationM += activity.elevationGainM;
      totals.activityCount += 1;
      return totals;
    },
    {
      totalDistanceM: 0,
      totalTimeS: 0,
      totalElevationM: 0,
      activityCount: 0
    }
  );

export const computeWeeklyStreak = (activities: ActivitySummary[]): WeeklyStreakDisplay => {
  const activeWeeks = new Set<string>();
  const weekKey = (date: Date) => format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');

  for (const activity of activities) {
    const activityDate = parseISO(activity.activityStart);
    if (Number.isNaN(activityDate.getTime())) {
      continue;
    }
    activeWeeks.add(weekKey(activityDate));
  }

  const countFromWeek = (weekStart: Date) => {
    let streak = 0;
    let cursor = weekStart;

    while (activeWeeks.has(format(cursor, 'yyyy-MM-dd'))) {
      streak += 1;
      cursor = subWeeks(cursor, 1);
    }

    return streak;
  };

  const currentWeekStart = startOfWeek(startOfToday(), { weekStartsOn: 1 });
  const previousWeekStart = subWeeks(currentWeekStart, 1);

  if (activeWeeks.has(format(currentWeekStart, 'yyyy-MM-dd'))) {
    return { count: countFromWeek(currentWeekStart), status: 'active' };
  }

  if (activeWeeks.has(format(previousWeekStart, 'yyyy-MM-dd'))) {
    return { count: countFromWeek(previousWeekStart), status: 'pending' };
  }

  return { count: 0, status: 'none' };
};

export const metricValue = (totals: AggregateTotals, metric: CalendarBarMetric) => totals[metric];

export const formatCalendarMetric = (metric: CalendarBarMetric, value: number) => {
  switch (metric) {
    case 'durationHours':
      return formatDuration(value * 3600);
    case 'distanceKm':
      return value.toFixed(1);
    case 'activities':
      return `${Math.round(value)}`;
    default:
      return `${value}`;
  }
};

export const formatCalendarMetricWithUnit = (metric: CalendarBarMetric, value: number) => {
  switch (metric) {
    case 'durationHours':
      return formatDuration(value * 3600);
    case 'distanceKm':
      return `${value.toFixed(1)} km`;
    case 'activities':
      return `${Math.round(value)} act`;
    default:
      return `${value}`;
  }
};

const activityScoreForMetric = (activity: ActivitySummary, metric: CalendarBarMetric) => {
  switch (metric) {
    case 'durationHours':
      return activity.durationSeconds;
    case 'distanceKm':
      return activity.distanceM;
    case 'activities':
      return activity.durationSeconds;
    default:
      return 0;
  }
};

export const selectPrimaryActivity = (activities: ActivitySummary[], metric: CalendarBarMetric) => {
  if (!activities.length) {
    return null;
  }

  return activities.reduce((best, current) =>
    activityScoreForMetric(current, metric) > activityScoreForMetric(best, metric) ? current : best
  );
};

export const weekLabel = (weekStart: Date) => {
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  return `${format(weekStart, 'dd.MM.yyyy')} - ${format(weekEnd, 'dd.MM.yyyy')}`;
};

export const buildCalendarData = (yearActivities: ActivitySummary[]): CalendarData => {
  const monthBuckets: MonthBucket[] = Array.from({ length: 12 }, () => ({
    totals: createTotals(),
    dailyTotals: new Map<string, AggregateTotals>(),
    activitiesByDay: new Map<string, ActivitySummary[]>()
  }));
  const weeklyTotals = new Map<string, AggregateTotals>();
  const weeklyActivities = new Map<string, ActivitySummary[]>();
  const yearTotals = createTotals();

  for (const activity of yearActivities) {
    const activityDate = parseISO(activity.activityStart);
    const monthIndex = activityDate.getMonth();
    const dayKey = format(activityDate, 'yyyy-MM-dd');
    const weekKey = format(startOfWeek(activityDate, { weekStartsOn: 1 }), 'yyyy-MM-dd');

    addToTotals(yearTotals, activity);

    const monthBucket = monthBuckets[monthIndex];
    addToTotals(monthBucket.totals, activity);

    const dayTotals = monthBucket.dailyTotals.get(dayKey) ?? createTotals();
    addToTotals(dayTotals, activity);
    monthBucket.dailyTotals.set(dayKey, dayTotals);

    const dayActivities = monthBucket.activitiesByDay.get(dayKey) ?? [];
    dayActivities.push(activity);
    monthBucket.activitiesByDay.set(dayKey, dayActivities);

    const weekTotals = weeklyTotals.get(weekKey) ?? createTotals();
    addToTotals(weekTotals, activity);
    weeklyTotals.set(weekKey, weekTotals);

    const weekActivities = weeklyActivities.get(weekKey) ?? [];
    weekActivities.push(activity);
    weeklyActivities.set(weekKey, weekActivities);
  }

  for (const monthBucket of monthBuckets) {
    for (const [dayKey, dayActivities] of monthBucket.activitiesByDay.entries()) {
      monthBucket.activitiesByDay.set(dayKey, dayActivities.sort((a, b) => a.activityStart.localeCompare(b.activityStart)));
    }
  }

  for (const [weekKey, weekActivities] of weeklyActivities.entries()) {
    weeklyActivities.set(weekKey, weekActivities.sort((a, b) => a.activityStart.localeCompare(b.activityStart)));
  }

  return { monthBuckets, weeklyTotals, weeklyActivities, yearTotals };
};

export const buildMonthSummaries = (
  selectedYear: number,
  monthBuckets: MonthBucket[],
  barMetric: CalendarBarMetric
): MonthSummary[] =>
  Array.from({ length: 12 }, (_, monthIndex) => {
    const monthDate = new Date(selectedYear, monthIndex, 1);
    const monthEnd = endOfMonth(monthDate);
    const daysInMonth = Number(format(monthEnd, 'd'));
    const monthBucket = monthBuckets[monthIndex];

    const dayValues = Array.from({ length: daysInMonth }, (_, dayOffset) => {
      const day = new Date(selectedYear, monthIndex, dayOffset + 1);
      const dayKey = format(day, 'yyyy-MM-dd');
      return metricValue(monthBucket.dailyTotals.get(dayKey) ?? ZERO_TOTALS, barMetric);
    });

    return {
      monthIndex,
      totals: monthBucket.totals,
      dayValues,
      activeDays: monthBucket.activitiesByDay.size
    };
  });
