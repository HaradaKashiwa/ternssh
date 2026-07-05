import { cn } from "@/lib/utils";

export function MetricBar({
  label,
  value,
  detail,
  barClassName,
}: {
  label: string;
  value: number | null;
  detail: string;
  barClassName?: string;
}) {
  const percent = value ?? 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--color-muted-foreground)]">{label}</span>
        <span>{detail}</span>
      </div>
      <div className="h-1.5 bg-[var(--color-secondary)]">
        <div
          className={cn(
            "h-full transition-all",
            barClassName ??
              (percent >= 90
                ? "bg-[var(--color-destructive)]"
                : "bg-[var(--color-primary)]"),
          )}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );
}
