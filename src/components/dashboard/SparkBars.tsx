import { type MouseEvent, type ReactNode, useMemo } from 'react';

export function SparkBars({
  values,
  ariaLabel,
  tone = 'strong',
  interactive = false,
  activeIndex = null,
  activeIndices,
  pulseTick = 0,
  onActiveIndexChange,
  onBarClick,
  renderActivePopover
}: {
  values: number[];
  ariaLabel: string;
  tone?: 'strong' | 'muted';
  interactive?: boolean;
  activeIndex?: number | null;
  activeIndices?: number[];
  pulseTick?: number;
  onActiveIndexChange?: (index: number | null) => void;
  onBarClick?: (index: number) => void;
  renderActivePopover?: (index: number) => ReactNode;
}) {
  const maxValue = values.reduce((max, value) => Math.max(max, value), 0);
  const barClass = tone === 'strong' ? 'bg-accent' : 'bg-foreground/70';
  const activePopClass = pulseTick % 2 === 0 ? 'calendar-pop-a' : 'calendar-pop-b';
  const popoverLeft =
    activeIndex == null || values.length === 0
      ? '0%'
      : `${((activeIndex + 0.5) / values.length) * 100}%`;
  const activeIndicesSet = useMemo(() => new Set(activeIndices ?? []), [activeIndices]);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!interactive || values.length === 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 0.999999);
    const nextIndex = Math.floor(ratio * values.length);
    if (activeIndex !== nextIndex) {
      onActiveIndexChange?.(nextIndex);
    }
  };

  return (
    <div
      className="relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onActiveIndexChange?.(null)}
      role={interactive ? 'group' : 'img'}
      aria-label={ariaLabel}
    >
      <div className="flex h-12 items-end gap-px">
        {values.map((value, index) => {
          const ratio = maxValue > 0 ? value / maxValue : 0;
          const height = value > 0 ? Math.max(ratio * 100, 10) : 6;
          const active = activeIndex === index || activeIndicesSet.has(index);
          const colorClass = active
            ? 'bg-accent opacity-100'
            : `${barClass} ${value > 0 ? 'opacity-100' : 'opacity-20'}`;
          const barVisualClass = `rounded-sm transition-all duration-200 ${colorClass} ${
            active ? `${activePopClass} -translate-y-0.5 scale-x-[1.06]` : ''
          }`;

          if (interactive) {
            return (
              <button
                key={`${ariaLabel}-${index}`}
                type="button"
                onClick={() => onBarClick?.(index)}
                onFocus={() => onActiveIndexChange?.(index)}
                onBlur={() => onActiveIndexChange?.(null)}
                className="min-w-[2px] flex h-full flex-1 items-end appearance-none cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none"
                aria-label={`${ariaLabel} bar ${index + 1}`}
              >
                <span
                  className={`w-full ${barVisualClass}`}
                  style={{ height: `${height}%` }}
                />
              </button>
            );
          }

          return (
            <span
              key={`${ariaLabel}-${index}`}
              className={`min-w-[2px] flex-1 ${barVisualClass}`}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      {interactive && activeIndex != null && renderActivePopover ? (
        <div
          className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full"
          style={{ left: popoverLeft }}
        >
          <div className={`calendar-hover-popover ${activePopClass}`}>{renderActivePopover(activeIndex)}</div>
        </div>
      ) : null}
    </div>
  );
}
