/** Display helpers for the reports (pure). */

/** 1250 → "12.5%"; null → "—". Integer arithmetic only. */
export function formatRateBps(bps: number | null): string {
  if (bps === null) return "—";
  const sign = bps < 0 ? "−" : "";
  const abs = Math.abs(bps);
  const whole = Math.floor(abs / 100);
  const tenth = Math.round((abs % 100) / 10);
  return tenth === 10 ? `${sign}${whole + 1}%` : `${sign}${whole}${tenth ? `.${tenth}` : ""}%`;
}

/** Luxora ledger entry types, as shown in the revenue breakdown. */
export const PLATFORM_LEDGER_LABELS: Record<string, string> = {
  commission_earned: "Commission earned",
  commission_reversed: "Commission reversed",
  processing_fee: "Payment processing fees",
  refund_loss: "Refunds borne by Luxora",
  dispute_loss: "Disputed payments",
  dispute_fee: "Dispute fees",
  dispute_recovered: "Disputes recovered",
  promotion_cost: "Luxora-funded promotions",
  promotion_cost_reversed: "Promotions recovered on refunds",
  adjustment: "Adjustments",
};

/** "2024-03-05" → "5 Mar" (or "5 Mar 2024" when a range spans years) for chart axes (UTC). */
export function shortDay(day: string, withYear = false): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

/** Whether a range crosses a calendar year, so day labels need the year. */
export function spansYears(range: { from: string; to: string }): boolean {
  return range.from.slice(0, 4) !== range.to.slice(0, 4);
}
