/**
 * Reporting periods (Phase 7). All dates are UTC calendar days ("YYYY-MM-DD"),
 * matching the database reports, which cover [from 00:00 UTC, to + 1 day).
 * Each period is compared with the immediately preceding period of the same
 * length. Pure: no I/O, `today` is injectable for tests.
 */

export const PERIOD_PRESETS = ["7d", "30d", "90d"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export type PeriodKind = PeriodPreset | "custom";

/** Longest range the database reports accept. */
export const MAX_PERIOD_DAYS = 366;

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportPeriod extends DateRange {
  kind: PeriodKind;
  days: number;
  previous: DateRange;
}

const PRESET_DAYS: Record<PeriodPreset, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" → UTC midnight in ms, or null when not a real calendar day. */
export function parseUtcDay(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms;
}

export function formatUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, delta: number): string {
  const ms = parseUtcDay(day);
  if (ms === null) throw new Error(`invalid day ${day}`);
  return formatUtcDay(ms + delta * DAY_MS);
}

/** Inclusive number of days in a range. */
export function daysInRange(range: DateRange): number {
  const from = parseUtcDay(range.from);
  const to = parseUtcDay(range.to);
  if (from === null || to === null) throw new Error("invalid range");
  return Math.round((to - from) / DAY_MS) + 1;
}

/** The equal-length period immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const days = daysInRange(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

function build(kind: PeriodKind, from: string, to: string): ReportPeriod {
  const range = { from, to };
  return { kind, from, to, days: daysInRange(range), previous: previousRange(range) };
}

/**
 * Resolves `?period=7d|30d|90d|custom&from=…&to=…` into a period. Presets end
 * today (UTC). An invalid custom range falls back to the last 30 days and
 * reports why, so the page can say so instead of guessing silently.
 */
export function resolvePeriod(
  params: { period?: unknown; from?: unknown; to?: unknown },
  today: Date = new Date(),
): { period: ReportPeriod; error: string | null } {
  const todayDay = formatUtcDay(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const preset = (days: number, kind: PeriodPreset) => build(kind, addDays(todayDay, -(days - 1)), todayDay);
  const fallback = preset(30, "30d");

  if (params.period === "custom" || (params.period === undefined && (params.from || params.to))) {
    const from = parseUtcDay(params.from);
    const to = parseUtcDay(params.to);
    if (from === null || to === null) return { period: fallback, error: "Enter both dates as YYYY-MM-DD." };
    if (to < from) return { period: fallback, error: "The end date must be on or after the start date." };
    const days = Math.round((to - from) / DAY_MS) + 1;
    if (days > MAX_PERIOD_DAYS) return { period: fallback, error: `Choose at most ${MAX_PERIOD_DAYS} days.` };
    return { period: build("custom", formatUtcDay(from), formatUtcDay(to)), error: null };
  }
  const kind = PERIOD_PRESETS.find((p) => p === params.period) ?? "30d";
  return { period: preset(PRESET_DAYS[kind], kind), error: null };
}

const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "1 Mar 2024 – 7 Mar 2024 (UTC)" */
export function rangeLabel(range: DateRange): string {
  const from = parseUtcDay(range.from);
  const to = parseUtcDay(range.to);
  if (from === null || to === null) return "";
  return from === to ? `${dayFormat.format(from)} (UTC)` : `${dayFormat.format(from)} – ${dayFormat.format(to)} (UTC)`;
}

/**
 * Change against the previous period in basis points (12.5% → 1250), or null
 * when there is nothing to compare with (previous value 0).
 */
export function changeBps(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}

/** "+12.5% vs previous 7 days", "No sales in the previous 7 days", … */
export function comparisonLabel(current: number, previous: number, days: number): string {
  const span = days === 1 ? "the previous day" : `the previous ${days} days`;
  const change = changeBps(current, previous);
  if (change === null) return current === 0 ? `None in ${span} either` : `Nothing to compare in ${span}`;
  if (change === 0) return `No change vs ${span}`;
  const sign = change > 0 ? "+" : "−";
  const abs = Math.abs(change);
  const whole = Math.floor(abs / 100);
  const fraction = Math.round((abs % 100) / 10);
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}% vs ${span}`;
}

/** A rate in basis points from integer counts (half-up), or null without a denominator. */
export function ratioBps(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator * 10_000) / denominator);
}
