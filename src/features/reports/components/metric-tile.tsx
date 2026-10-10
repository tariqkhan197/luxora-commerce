import { comparisonLabel } from "@/lib/reporting/periods";

interface MetricTileProps {
  label: string;
  /** Formatted current value. */
  value: string;
  /** Raw current and previous values for the comparison line (omit to hide it). */
  current?: number;
  previous?: number;
  days?: number;
  hint?: string;
}

/** One headline figure with its change against the previous period. */
export function MetricTile({ label, value, current, previous, days, hint }: MetricTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="font-display text-2xl text-ink tabular-nums">{value}</p>
      {current !== undefined && previous !== undefined && days !== undefined ? (
        <p className="text-xs text-ink-faint">{comparisonLabel(current, previous, days)}</p>
      ) : null}
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
