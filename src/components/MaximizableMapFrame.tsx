import { useEffect, useState, type ReactNode } from 'react';

type MaximizableMapFrameProps = {
  label: string;
  collapsedHeightClassName: string;
  children: ReactNode;
  topLeftActions?: ReactNode;
};

export function MaximizableMapFrame({
  label,
  collapsedHeightClassName,
  children,
  topLeftActions
}: MaximizableMapFrameProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isMaximized) {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMaximized(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMaximized]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    if (isMaximized) {
      document.body.style.overflow = 'hidden';
    }

    const tick = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 16);

    return () => {
      window.clearTimeout(tick);
      document.body.style.overflow = previousOverflow;
    };
  }, [isMaximized]);

  return (
    <>
      {isMaximized ? (
        <button
          type="button"
          aria-label={`Close expanded ${label}`}
          onClick={() => setIsMaximized(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
        />
      ) : null}

      <div
        className={
          isMaximized
            ? 'fixed inset-4 z-50 overflow-hidden rounded-xl border border-border bg-panel'
            : `relative ${collapsedHeightClassName}`
        }
      >
        <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-6.5rem)] flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsMaximized((value) => !value)}
            aria-pressed={isMaximized}
            aria-label={isMaximized ? `Minimize ${label}` : `Maximize ${label}`}
            className="rounded-md border border-border bg-panel/90 px-3 py-1.5 text-xs font-medium text-foreground backdrop-blur hover:border-accent/50"
          >
            {isMaximized ? 'Minimize' : 'Maximize'}
          </button>
          {topLeftActions}
        </div>
        <div className="h-full w-full">{children}</div>
      </div>
    </>
  );
}
