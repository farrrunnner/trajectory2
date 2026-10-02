export function AnalyticsLoadingBar({
  loadingProgress
}: {
  loadingProgress?: { completed: number; total: number } | null;
}) {
  if (!loadingProgress || loadingProgress.total <= 0) {
    return (
      <section className="rounded-xl border border-border bg-panel p-3">
        <p className="text-xs text-muted">Recomputing analytics...</p>
        <div className="mt-2 h-2 rounded-full bg-bg">
          <div className="h-full w-2/5 rounded-full bg-accent/80" />
        </div>
      </section>
    );
  }

  const total = Math.max(loadingProgress?.total ?? 0, 1);
  const completed = Math.max(0, Math.min(loadingProgress?.completed ?? 0, total));
  const percent = Math.round((completed / total) * 100);

  return (
    <section className="rounded-xl border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>Recomputing analytics...</span>
        <span>
          {completed}/{total} ({percent}%)
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-bg">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </section>
  );
}
