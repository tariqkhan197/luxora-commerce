/**
 * What the customer paid for some units of an order line, using the same
 * cumulative split as `public.request_refund()` (Phase 6B): the line's paid
 * total (after any discount) is shared out so that refunding every unit
 * returns exactly that total. Display only — the database computes refunds.
 */
export function paidForUnits(
  linePaidMinor: number,
  lineQuantity: number,
  alreadyRefunded: number,
  units: number,
): number {
  if (lineQuantity <= 0 || units <= 0) return 0;
  const done = Math.max(0, Math.min(alreadyRefunded, lineQuantity));
  const upTo = Math.min(lineQuantity, done + units);
  return Math.floor((linePaidMinor * upTo) / lineQuantity) - Math.floor((linePaidMinor * done) / lineQuantity);
}
