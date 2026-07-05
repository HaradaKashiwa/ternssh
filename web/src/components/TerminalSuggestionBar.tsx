interface TerminalSuggestionBarProps {
  suggestions: string[];
  partial: string;
  activeIndex: number;
}

export function TerminalSuggestionBar({
  suggestions,
  partial,
  activeIndex,
}: TerminalSuggestionBarProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 flex flex-wrap gap-1.5">
      {suggestions.map((item, index) => {
        const suffix = item.startsWith(partial) ? item.slice(partial.length) : item;
        return (
          <div
            key={`${item}:${index}`}
            className={
              index === activeIndex
                ? "border border-[var(--color-primary)] bg-[var(--color-primary)]/15 px-2 py-0.5 font-mono text-[11px] text-[var(--color-foreground)]"
                : "border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-secondary)_85%,transparent)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-muted-foreground)]"
            }
          >
            <span>{partial}</span>
            {suffix && (
              <span className="text-[var(--color-primary)]">{suffix}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
