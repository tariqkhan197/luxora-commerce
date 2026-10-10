import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rangeLabel, type ReportPeriod } from "@/lib/reporting/periods";

const PRESETS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

/**
 * Period selector for the reports: preset links and a plain GET form for a
 * custom UTC range (works without JavaScript). The page validates the range.
 */
export function PeriodPicker({
  basePath,
  period,
  error,
}: {
  basePath: string;
  period: ReportPeriod;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PRESETS.map((preset) => (
            <Button key={preset.value} asChild size="sm" variant={period.kind === preset.value ? "primary" : "ghost"}>
              <Link href={`${basePath}?period=${preset.value}`}>{preset.label}</Link>
            </Button>
          ))}
        </div>
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            From (UTC)
            <Input type="date" name="from" defaultValue={period.from} className="h-9 w-40" required />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">
            To (UTC)
            <Input type="date" name="to" defaultValue={period.to} className="h-9 w-40" required />
          </label>
          <Button type="submit" size="sm" variant={period.kind === "custom" ? "primary" : "outline"}>
            Apply
          </Button>
        </form>
      </div>
      <p className="text-xs text-ink-soft">
        {rangeLabel(period)} · compared with {rangeLabel(period.previous)}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error} Showing the last 30 days instead.
        </p>
      ) : null}
    </div>
  );
}
