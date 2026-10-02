import type { AdvancedAnalyticsStreakDefinition, AdvancedAnalyticsStreakResult } from '@/types';

import {
  NoticeList,
  formatStreakValue,
  periodGoalProgressPercent,
  streakCurrentCardTone,
  streakStatusTone
} from './shared';

export function StreakPreview({
  streak,
  result
}: {
  streak: AdvancedAnalyticsStreakDefinition;
  result?: AdvancedAnalyticsStreakResult;
}) {
  const current = result?.count ?? 0;
  const longest = result?.longest ?? current;
  const status = result?.status ?? 'n/a';
  const longestRatio = longest > 0 ? Math.min(100, (current / longest) * 100) : 0;
  const requiredMetricCount = 1 + (streak.additionalMetricIds?.length ?? 0);
  const requiredMetricValues = Object.values(result?.requiredMetricValues ?? {});
  const resolvedRequiredMetricCount =
    requiredMetricValues.length > 0 ? requiredMetricValues.length : requiredMetricCount;
  const currentPeriodValue = result?.currentPeriodValue ?? 0;
  const combinedPeriodValue =
    resolvedRequiredMetricCount > 1
      ? requiredMetricValues.reduce((sum, value) => sum + value, 0)
      : currentPeriodValue;
  const combinedThresholdValue =
    resolvedRequiredMetricCount > 1
      ? streak.thresholdValue * resolvedRequiredMetricCount
      : streak.thresholdValue;
  const periodProgress = periodGoalProgressPercent(
    streak.thresholdOperator,
    combinedThresholdValue,
    combinedPeriodValue
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-panel p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{streak.name || 'Untitled streak'}</h3>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold capitalize ${streakStatusTone(
              result?.status
            )}`}
          >
            {status}
          </span>
        </div>
        <div className="mt-3 grid gap-2.5 md:grid-cols-3">
          <div className={`rounded-lg border p-2.5 ${streakCurrentCardTone(result?.status)}`}>
            <p className="whitespace-nowrap text-sm font-medium text-foreground">Current streak: {current}</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${longestRatio}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {current}/{longest || 0} of best
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg/30 p-2.5">
            <p className="whitespace-nowrap text-sm font-medium text-foreground">Longest streak: {longest}</p>
          </div>
          <div className="rounded-lg border border-border bg-bg/30 p-2.5">
            <p className="whitespace-nowrap text-sm font-medium text-foreground">
              Current value: {result ? formatStreakValue(combinedPeriodValue) : 'n/a'}
            </p>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border/70">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${periodProgress}%` }} />
            </div>
          </div>
        </div>
      </div>
      <NoticeList title="Streak Errors" items={result?.errors ?? []} tone="error" />
      <NoticeList title="Streak Warnings" items={result?.warnings ?? []} />
    </div>
  );
}
