/**
 * Deterministic money arithmetic.
 *
 * Convention (matches the database): amounts are integers in the currency's
 * minor unit (`amountMinor`), rates are integer basis points (1 bp = 0.01 %).
 * No floating point is used for any calculation; `number` is only used as a
 * container for safe integers, and every entry point asserts that.
 */

export interface Money {
  amountMinor: number;
  currency: string;
}

export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer in minor units, received ${String(value)}`);
  }
  return value;
}

export function assertBasisPoints(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > BPS_DENOMINATOR) {
    throw new MoneyError(
      `rate must be an integer between 0 and ${BPS_DENOMINATOR} basis points, received ${String(value)}`,
    );
  }
  return value;
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function money(amountMinor: number, currency: string): Money {
  return { amountMinor: assertMinor(amountMinor), currency };
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(assertMinor(a.amountMinor + b.amountMinor, "sum"), a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(assertMinor(a.amountMinor - b.amountMinor, "difference"), a.currency);
}

export function multiply(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, received ${String(quantity)}`);
  }
  return money(assertMinor(a.amountMinor * quantity, "product"), a.currency);
}

export function sum(items: readonly Money[], currency: string): Money {
  return items.reduce((acc, item) => add(acc, item), money(0, currency));
}

/**
 * Applies a basis-point rate with round-half-up, identical to the SQL function
 * `public.calculate_commission_minor`: (base * bps + 5000) div 10000.
 * Negative bases return 0 (rates never apply to credits here).
 */
export function applyBasisPoints(baseMinor: number, rateBps: number): number {
  assertMinor(baseMinor, "base");
  assertBasisPoints(rateBps);
  if (baseMinor <= 0 || rateBps === 0) return 0;
  return Math.floor((baseMinor * rateBps + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/**
 * Splits `totalMinor` across `weights` proportionally using the largest
 * remainder method, so the parts always sum exactly to the total. Used to
 * allocate shared costs (payment fees, order-level discounts) to vendor orders.
 */
export function allocateProportionally(totalMinor: number, weights: readonly number[]): number[] {
  assertMinor(totalMinor, "total");
  if (weights.length === 0) throw new MoneyError("cannot allocate across zero parts");
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new MoneyError("weights must be non-negative safe integers");
  }
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) {
    // Equal split when there is nothing to weight by.
    return allocateProportionally(
      totalMinor,
      weights.map(() => 1),
    );
  }

  const shares = weights.map((weight) => Math.floor((totalMinor * weight) / totalWeight));
  let remainder = totalMinor - shares.reduce((acc, s) => acc + s, 0);

  // Distribute leftover minor units to the parts with the largest fractional remainder,
  // breaking ties by index for determinism.
  const order = weights
    .map((weight, index) => ({ index, fraction: (totalMinor * weight) % totalWeight }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of order) {
    if (remainder === 0) break;
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}

/** Number of minor-unit digits for a currency (2 for USD/EUR, 0 for JPY, 3 for KWD). */
export function currencyFractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * Parses a decimal string ("1,234.56", "12", "0.5") into minor units without
 * floating point. Throws on more fractional digits than the currency supports.
 */
export function parseToMinor(input: string, currency: string): number {
  const digits = currencyFractionDigits(currency);
  const normalised = input.replace(/[\s,]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(normalised);
  if (!match) throw new MoneyError(`"${input}" is not a valid amount`);
  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > digits) {
    throw new MoneyError(`"${input}" has more than ${digits} decimal places for ${currency}`);
  }
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return assertMinor(sign ? -minor : minor);
}

/** Formats minor units for display, e.g. 123456 USD → "$1,234.56". */
export function formatMoney(amountMinor: number, currency: string, locale = "en-US"): string {
  assertMinor(amountMinor);
  const digits = currencyFractionDigits(currency);
  const factor = 10 ** digits;
  const major = Math.trunc(amountMinor / factor);
  const minor = Math.abs(amountMinor % factor);
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
  // Build the decimal from integer parts so we never pass a floating sum to Intl.
  const asDecimal =
    digits === 0
      ? String(major)
      : `${amountMinor < 0 && major === 0 ? "-" : ""}${major}.${String(minor).padStart(digits, "0")}`;
  return formatter.format(Number(asDecimal));
}

export function formatBasisPoints(rateBps: number): string {
  assertBasisPoints(rateBps);
  const whole = Math.floor(rateBps / 100);
  const fraction = rateBps % 100;
  return fraction === 0 ? `${whole}%` : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

/** Minor units → plain decimal string for form inputs, e.g. 1250 USD → "12.50" (no float maths). */
export function toDecimalInput(amountMinor: number | null | undefined, currency: string): string {
  if (amountMinor === null || amountMinor === undefined) return "";
  assertMinor(amountMinor);
  const digits = currencyFractionDigits(currency);
  if (digits === 0) return String(amountMinor);
  const sign = amountMinor < 0 ? "-" : "";
  const abs = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}
