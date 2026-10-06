import { describe, expect, it } from "vitest";
import { buildCheckoutQuote, unavailableLabel, type CartLine } from "@/features/checkout/quote";
import { getPaymentProvider, PaymentConfigurationError, paymentsEnabled } from "@/lib/payments/provider";

let counter = 0;
function line(overrides: Partial<CartLine> = {}): CartLine {
  counter += 1;
  return {
    cartItemId: `item-${counter}`,
    variantId: `variant-${counter}`,
    productId: `product-${counter}`,
    productSlug: `product-${counter}`,
    productName: `Product ${counter}`,
    variantTitle: "Default",
    sku: `SKU-${counter}`,
    options: {},
    vendorId: "vendor-a",
    vendorName: "Atelier A",
    storeSlug: "atelier-a",
    imagePath: null,
    currency: "USD",
    quantity: 1,
    unitPriceMinor: 1000,
    addedPriceMinor: 1000,
    maxQuantity: 99,
    purchasable: true,
    unavailableReason: null,
    ...overrides,
  };
}

describe("buildCheckoutQuote", () => {
  it("groups lines by vendor and totals them in integer minor units", () => {
    const quote = buildCheckoutQuote([
      line({ vendorId: "vendor-a", unitPriceMinor: 12_345, addedPriceMinor: 12_345, quantity: 2 }),
      line({ vendorId: "vendor-b", vendorName: "Maison B", unitPriceMinor: 9_999, addedPriceMinor: 9_999 }),
      line({ vendorId: "vendor-a", unitPriceMinor: 1, addedPriceMinor: 1, quantity: 3 }),
    ]);
    expect(quote.groups.map((g) => [g.vendorId, g.subtotal.amountMinor, g.lines.length])).toEqual([
      ["vendor-a", 24_693, 2],
      ["vendor-b", 9_999, 1],
    ]);
    expect(quote.subtotal.amountMinor).toBe(34_692);
    expect(quote.total).toEqual({ amountMinor: 34_692, currency: "USD" });
    expect(quote.itemCount).toBe(6);
    expect(quote.canCheckout).toBe(true);
  });

  it("matches the database totals used by place_order for the same bag", () => {
    // Mirrors the multi-vendor case asserted in tests/db/phase3-checkout.test.ts.
    const quote = buildCheckoutQuote([
      line({ vendorId: "a", unitPriceMinor: 12_345, addedPriceMinor: 12_345, quantity: 2 }),
      line({ vendorId: "b", unitPriceMinor: 9_999, addedPriceMinor: 9_999, quantity: 1 }),
    ]);
    expect(quote.total.amountMinor).toBe(34_689);
  });

  it("avoids floating point drift", () => {
    const quote = buildCheckoutQuote([
      line({ unitPriceMinor: 10, addedPriceMinor: 10 }),
      line({ unitPriceMinor: 20, addedPriceMinor: 20 }),
    ]);
    expect(quote.total.amountMinor).toBe(30); // 0.10 + 0.20 is exactly 0.30
  });

  it("flags price changes and blocks checkout on unavailable lines", () => {
    const quote = buildCheckoutQuote([
      line({ unitPriceMinor: 1_200, addedPriceMinor: 1_000 }),
      line({ purchasable: false, unavailableReason: "insufficient_stock", maxQuantity: 2, quantity: 5 }),
    ]);
    expect(quote.hasPriceChanges).toBe(true);
    expect(quote.blockingLines).toHaveLength(1);
    expect(quote.canCheckout).toBe(false);
    expect(unavailableLabel(quote.blockingLines[0])).toBe("Only 2 available");
    expect(unavailableLabel({ unavailableReason: "unavailable", maxQuantity: 0 })).toBe("No longer available");
    expect(unavailableLabel({ unavailableReason: null, maxQuantity: 5 })).toBeNull();
  });

  it("cannot check out an empty bag and charges no shipping or tax yet", () => {
    const quote = buildCheckoutQuote([]);
    expect(quote.canCheckout).toBe(false);
    expect(quote.total.amountMinor).toBe(0);
    const single = buildCheckoutQuote([line()]);
    expect(single.shipping.amountMinor).toBe(0);
    expect(single.tax.amountMinor).toBe(0);
  });

  it("refuses to mix currencies", () => {
    expect(() => buildCheckoutQuote([line(), line({ currency: "EUR" })])).toThrow(/one currency/);
  });
});

describe("payment provider boundary", () => {
  it("reports payments as disabled when no provider is configured", () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(getPaymentProvider({ PAYMENT_PROVIDER: "  " })).toBeNull();
    expect(paymentsEnabled({})).toBe(false);
  });

  it("fails loudly for a provider without an adapter instead of pretending", () => {
    expect(() => getPaymentProvider({ PAYMENT_PROVIDER: "stripe" })).toThrow(PaymentConfigurationError);
  });
});

describe("formatDateTimeUtc", () => {
  it("formats deterministically in UTC", async () => {
    const { formatDateTimeUtc } = await import("@/lib/format");
    expect(formatDateTimeUtc("2026-10-06T14:05:00Z")).toBe("Oct 6, 2026, 2:05 PM UTC");
  });
});
