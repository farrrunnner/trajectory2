interface MetricCardProps {
  label: string;
  value: string;
  subLabel?: string;
}

export function MetricCard({ label, value, subLabel }: MetricCardProps) {
  return (
    <article className="rounded-xl border border-border bg-panel p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {subLabel ? <p className="mt-1 text-xs text-muted">{subLabel}</p> : null}
    </article>
  );
}
