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
 *
 * Shipping is never calculated here: it comes from the database
 * (`public.checkout_shipping_quote`, one row per vendor) for a specific
 * shipping address, and this module only adds it up. Without a shipping quote
 * (the bag page) shipping is "calculated at checkout" and not in the total.
 * Tax is zero until Release 4b.
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

export type ShippingBlockReason = "country_not_served" | "vendor_does_not_ship";

/** One vendor's shipping for a destination, as returned by `checkout_shipping_quote`. */
export interface VendorShippingQuote {
  vendorId: string;
  shippable: boolean;
  shippingMinor: number;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  reason: ShippingBlockReason | null;
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
  /** Zero until a shipping quote is supplied. */
  shipping: Money;
  shippable: boolean;
  shippingReason: ShippingBlockReason | null;
  deliveryDays: { min: number | null; max: number | null } | null;
}

export interface CheckoutQuote {
  currency: string;
  groups: VendorGroup[];
  itemCount: number;
  subtotal: Money;
  shipping: Money;
  /** False on the bag page: shipping is shown as "calculated at checkout". */
  shippingKnown: boolean;
  tax: Money;
  total: Money;
  /** Lines that must be fixed before checkout can proceed. */
  blockingLines: QuoteLine[];
  /** Vendors that cannot ship to the quoted destination. */
  unshippableGroups: VendorGroup[];
  hasPriceChanges: boolean;
  /**
   * The bag can proceed: it has lines, all purchasable, and (when a shipping
   * quote was supplied) every vendor ships to the destination.
   */
  canCheckout: boolean;
}

const DEFAULT_CURRENCY = "USD";

export function buildCheckoutQuote(
  lines: readonly CartLine[],
  shippingQuote?: readonly VendorShippingQuote[],
): CheckoutQuote {
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
      shipping: money(0, currency),
      shippable: true,
      shippingReason: null,
      deliveryDays: null,
    };
    group.lines.push(quoteLine);
    group.subtotal = add(group.subtotal, quoteLine.lineTotal);
    groups.set(line.vendorId, group);
  }

  const vendorGroups = [...groups.values()];
  const shippingKnown = shippingQuote !== undefined;
  if (shippingQuote) {
    const byVendor = new Map(shippingQuote.map((row) => [row.vendorId, row]));
    for (const group of vendorGroups) {
      const row = byVendor.get(group.vendorId);
      // A vendor missing from the database quote cannot be shipped (never assume free).
      group.shippable = row?.shippable ?? false;
      group.shippingReason = row ? row.reason : "vendor_does_not_ship";
      group.shipping = money(row?.shippable ? row.shippingMinor : 0, currency);
      group.deliveryDays =
        row?.shippable && (row.minDeliveryDays !== null || row.maxDeliveryDays !== null)
          ? { min: row.minDeliveryDays, max: row.maxDeliveryDays }
          : null;
    }
  }
  const allLines = vendorGroups.flatMap((group) => group.lines);
  const subtotal = sum(
    vendorGroups.map((group) => group.subtotal),
    currency,
  );
  const shipping = sum(
    vendorGroups.map((group) => group.shipping),
    currency,
  );
  // Tax is not calculated in Release 4a ("Duties and taxes may apply on delivery").
  const tax = money(0, currency);
  const total = add(add(subtotal, shipping), tax);
  const blockingLines = allLines.filter((line) => !line.purchasable);
  const unshippableGroups = vendorGroups.filter((group) => !group.shippable);

  return {
    currency,
    groups: vendorGroups,
    itemCount: allLines.reduce((count, line) => count + line.quantity, 0),
    subtotal,
    shipping,
    shippingKnown,
    tax,
    total,
    blockingLines,
    unshippableGroups,
    hasPriceChanges: allLines.some((line) => line.priceChanged),
    canCheckout: allLines.length > 0 && blockingLines.length === 0 && unshippableGroups.length === 0,
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

/** Customer-facing explanation for a vendor that cannot ship to an address. */
export function shippingBlockLabel(reason: ShippingBlockReason | null, vendorName: string): string | null {
  if (reason === "country_not_served") return "Luxora does not ship to this country yet.";
  if (reason === "vendor_does_not_ship") return `${vendorName} does not ship to this address.`;
  return null;
}

/** "3–7 business days" style delivery estimate, or null when the vendor gave none. */
export function deliveryEstimateLabel(days: { min: number | null; max: number | null } | null): string | null {
  if (!days) return null;
  const { min, max } = days;
  if (min !== null && max !== null) return min === max ? `${min} days` : `${min}–${max} days`;
  if (max !== null) return `Up to ${max} days`;
  if (min !== null) return `From ${min} days`;
  return null;
}
