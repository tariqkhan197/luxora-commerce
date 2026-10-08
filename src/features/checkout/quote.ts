import { add, money, multiply, subtract, sum, type Money } from "@/lib/money";

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
 *
 * Phase 6B: flash-sale prices arrive in the cart lines, and a discount code is
 * evaluated and split per line by `public.cart_promotion_quote` (the same
 * function `place_order` uses). This module never computes a discount itself;
 * it only applies the amounts the database returned.
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
  /** Regular price; above `unitPriceMinor` while a flash sale applies. */
  listPriceMinor?: number;
  /** Live flash-sale item pricing this line (null: regular price). */
  flashSaleItemId?: string | null;
  flashSaleEndsAt?: string | null;
  /** A live sale exists but has fewer units left than this line's quantity. */
  flashSaleUnitsLeft?: number | null;
}

/** The bag's discount code as evaluated by `cart_promotion_quote`. */
export interface PromotionQuote {
  couponId: string;
  code: string;
  name: string;
  fundedBy: "platform" | "vendor";
  discountType: "percentage" | "fixed_amount" | "free_shipping";
  /** False when the code cannot be used right now; `message` says why. */
  applied: boolean;
  message: string | null;
  discountMinor: number;
  /** Known only once a shipping address is chosen. */
  shippingDiscountMinor: number;
  lineDiscounts: Record<string, number>;
  vendorShippingDiscounts: Record<string, number>;
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
  /** This line's share of the code's discount. */
  discount: Money;
  priceChanged: boolean;
  onFlashSale: boolean;
}

export interface VendorGroup {
  vendorId: string;
  vendorName: string;
  storeSlug: string | null;
  lines: QuoteLine[];
  subtotal: Money;
  discount: Money;
  /** Zero until a shipping quote is supplied. */
  shipping: Money;
  shippingDiscount: Money;
  shippable: boolean;
  shippingReason: ShippingBlockReason | null;
  deliveryDays: { min: number | null; max: number | null } | null;
}

export interface CheckoutQuote {
  currency: string;
  groups: VendorGroup[];
  itemCount: number;
  subtotal: Money;
  /** The code's discount on items (zero without an applicable code). */
  discount: Money;
  shipping: Money;
  /** Free-shipping discount (zero without one, or before an address is chosen). */
  shippingDiscount: Money;
  /** The bag's code, applied or not (null without a code). */
  promotion: PromotionQuote | null;
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
   * The bag can proceed: it has lines, all purchasable, (when a shipping quote
   * was supplied) every vendor ships to the destination, and any code applies.
   */
  canCheckout: boolean;
}

const DEFAULT_CURRENCY = "USD";

export function buildCheckoutQuote(
  lines: readonly CartLine[],
  shippingQuote?: readonly VendorShippingQuote[],
  promotion: PromotionQuote | null = null,
): CheckoutQuote {
  const currency = lines[0]?.currency ?? DEFAULT_CURRENCY;
  const groups = new Map<string, VendorGroup>();
  const applied = promotion?.applied ? promotion : null;

  for (const line of lines) {
    if (line.currency !== currency) {
      throw new Error(`cart lines must share one currency (found ${line.currency} and ${currency})`);
    }
    const quoteLine: QuoteLine = {
      ...line,
      lineTotal: multiply(money(line.unitPriceMinor, currency), line.quantity),
      discount: money(applied?.lineDiscounts[line.cartItemId] ?? 0, currency),
      priceChanged: line.unitPriceMinor !== line.addedPriceMinor,
      onFlashSale: Boolean(line.flashSaleItemId),
    };
    const group = groups.get(line.vendorId) ?? {
      vendorId: line.vendorId,
      vendorName: line.vendorName,
      storeSlug: line.storeSlug,
      lines: [],
      subtotal: money(0, currency),
      discount: money(0, currency),
      shipping: money(0, currency),
      shippingDiscount: money(0, currency),
      shippable: true,
      shippingReason: null,
      deliveryDays: null,
    };
    group.lines.push(quoteLine);
    group.subtotal = add(group.subtotal, quoteLine.lineTotal);
    group.discount = add(group.discount, quoteLine.discount);
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
      group.shippingDiscount = money(
        Math.min(applied?.vendorShippingDiscounts[group.vendorId] ?? 0, group.shipping.amountMinor),
        currency,
      );
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
  const discount = sum(
    vendorGroups.map((group) => group.discount),
    currency,
  );
  const shippingDiscount = sum(
    vendorGroups.map((group) => group.shippingDiscount),
    currency,
  );
  // Tax is not calculated in Release 4a ("Duties and taxes may apply on delivery").
  const tax = money(0, currency);
  const total = add(subtract(add(subtract(subtotal, discount), shipping), shippingDiscount), tax);
  const blockingLines = allLines.filter((line) => !line.purchasable);
  const unshippableGroups = vendorGroups.filter((group) => !group.shippable);

  return {
    currency,
    groups: vendorGroups,
    itemCount: allLines.reduce((count, line) => count + line.quantity, 0),
    subtotal,
    discount,
    shipping,
    shippingDiscount,
    promotion,
    shippingKnown,
    tax,
    total,
    blockingLines,
    unshippableGroups,
    hasPriceChanges: allLines.some((line) => line.priceChanged),
    // A code that cannot be used right now must be removed first (the bag explains why).
    canCheckout:
      allLines.length > 0 &&
      blockingLines.length === 0 &&
      unshippableGroups.length === 0 &&
      !(promotion && !promotion.applied),
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

/** "Ends Oct 9, 14:00 UTC" for a flash sale's end. */
export function flashSaleEndsLabel(endsAt: string | null | undefined): string | null {
  if (!endsAt) return null;
  const date = new Date(endsAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Ends ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}

/** D9: a live sale with fewer units left than the line's quantity. */
export function flashSaleShortLabel(line: Pick<CartLine, "flashSaleUnitsLeft">): string | null {
  const left = line.flashSaleUnitsLeft;
  if (left === null || left === undefined) return null;
  return left > 0
    ? `Only ${left} left at the sale price — reduce the quantity to get it.`
    : "Sold out at the sale price; charged at the regular price.";
}
