import { add, money, multiply, sum, type Money } from "@/lib/money";

/**
 * Pure checkout arithmetic used by the cart and checkout pages.
 *
 * The authoritative totals are computed by `public.place_order()` from catalog
 * prices; this module derives the same figures for display from the rows that
 * `public.cart_lines()` returns (also database prices), using the integer
 * minor-unit money utilities. The resulting total is sent back to the database
 * as `expectedTotalMinor` so that any drift between what the customer saw and
 * what would be charged is rejected rather than silently charged.
 */

export type UnavailableReason = "unavailable" | "currency_mismatch" | "out_of_stock" | "insufficient_stock";

export interface CartLine {
  cartItemId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantTitle: string;
  sku: string;
  options: Record<string, string>;
  vendorId: string;
  vendorName: string;
  storeSlug: string | null;
  imagePath: string | null;
  currency: string;
  quantity: number;
  unitPriceMinor: number;
  addedPriceMinor: number;
  maxQuantity: number;
  purchasable: boolean;
  unavailableReason: UnavailableReason | null;
}

export interface QuoteLine extends CartLine {
  lineTotal: Money;
  priceChanged: boolean;
}

export interface VendorGroup {
  vendorId: string;
  vendorName: string;
  storeSlug: string | null;
  lines: QuoteLine[];
  subtotal: Money;
}

export interface CheckoutQuote {
  currency: string;
  groups: VendorGroup[];
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  tax: Money;
  total: Money;
  /** Lines that must be fixed before checkout can proceed. */
  blockingLines: QuoteLine[];
  hasPriceChanges: boolean;
  canCheckout: boolean;
}

const DEFAULT_CURRENCY = "USD";

export function buildCheckoutQuote(lines: readonly CartLine[]): CheckoutQuote {
  const currency = lines[0]?.currency ?? DEFAULT_CURRENCY;
  const groups = new Map<string, VendorGroup>();

  for (const line of lines) {
    if (line.currency !== currency) {
      throw new Error(`cart lines must share one currency (found ${line.currency} and ${currency})`);
    }
    const quoteLine: QuoteLine = {
      ...line,
      lineTotal: multiply(money(line.unitPriceMinor, currency), line.quantity),
      priceChanged: line.unitPriceMinor !== line.addedPriceMinor,
    };
    const group = groups.get(line.vendorId) ?? {
      vendorId: line.vendorId,
      vendorName: line.vendorName,
      storeSlug: line.storeSlug,
      lines: [],
      subtotal: money(0, currency),
    };
    group.lines.push(quoteLine);
    group.subtotal = add(group.subtotal, quoteLine.lineTotal);
    groups.set(line.vendorId, group);
  }

  const vendorGroups = [...groups.values()];
  const allLines = vendorGroups.flatMap((group) => group.lines);
  const subtotal = sum(
    vendorGroups.map((group) => group.subtotal),
    currency,
  );
  // Shipping and tax are not charged in this release (see README: Phase 3 limitations).
  const shipping = money(0, currency);
  const tax = money(0, currency);
  const total = add(add(subtotal, shipping), tax);
  const blockingLines = allLines.filter((line) => !line.purchasable);

  return {
    currency,
    groups: vendorGroups,
    itemCount: allLines.reduce((count, line) => count + line.quantity, 0),
    subtotal,
    shipping,
    tax,
    total,
    blockingLines,
    hasPriceChanges: allLines.some((line) => line.priceChanged),
    canCheckout: allLines.length > 0 && blockingLines.length === 0,
  };
}

const REASON_COPY: Record<UnavailableReason, string> = {
  unavailable: "No longer available",
  currency_mismatch: "Priced in a different currency",
  out_of_stock: "Out of stock",
  insufficient_stock: "Not enough stock for this quantity",
};

export function unavailableLabel(line: Pick<CartLine, "unavailableReason" | "maxQuantity">): string | null {
  if (!line.unavailableReason) return null;
  if (line.unavailableReason === "insufficient_stock") return `Only ${line.maxQuantity} available`;
  return REASON_COPY[line.unavailableReason];
}
