import { describe, expect, it } from "vitest";
import {
  assertCheckoutAmounts,
  buildCheckoutSessionParams,
  CheckoutAmountError,
  type CheckoutOrder,
} from "@/lib/payments/checkout-session";

function order(overrides: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orderNumber: "LX-261008-000123",
    currency: "USD",
    subtotalMinor: 34_689,
    shippingMinor: 1_500,
    taxMinor: 0,
    totalMinor: 36_189,
    customerEmail: "customer@example.test",
    shippingAddress: {
      full_name: "Test Customer",
      phone: "+33 1 23 45 67 89",
      line1: "12 Rue Saint-Honoré",
      line2: null,
      city: "Paris",
      state: null,
      postal_code: "75001",
      country_code: "FR",
    },
    items: [
      {
        productName: "Wool Coat",
        variantTitle: "M / Black",
        sku: "COAT-M",
        quantity: 2,
        unitPriceMinor: 12_345,
        totalMinor: 24_690,
      },
      {
        productName: "Silk Scarf",
        variantTitle: "Default",
        sku: "SCARF",
        quantity: 1,
        unitPriceMinor: 9_999,
        totalMinor: 9_999,
      },
    ],
    ...overrides,
  };
}

const options = {
  attemptNo: 2,
  expiresAt: new Date("2026-10-08T12:30:00.000Z"),
  successUrl: "http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "http://localhost:3000/account/orders/x?payment=cancelled",
};

describe("buildCheckoutSessionParams", () => {
  it("charges exactly the order rows: items at their prices plus one shipping amount", () => {
    const params = buildCheckoutSessionParams(order(), options);
    const items = params.line_items!.map((item) => [
      item.price_data!.unit_amount,
      item.quantity,
      item.price_data!.currency,
    ]);
    expect(items).toEqual([
      [12_345, 2, "usd"],
      [9_999, 1, "usd"],
    ]);
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Shipping",
          fixed_amount: { amount: 1_500, currency: "usd" },
          tax_behavior: "exclusive",
        },
      },
    ]);
    const charged =
      params.line_items!.reduce((sum, item) => sum + item.price_data!.unit_amount! * item.quantity!, 0) +
      params.shipping_options![0].shipping_rate_data!.fixed_amount!.amount;
    expect(charged).toBe(36_189);
  });

  it("uses hosted checkout with card + Link only, no tax, no currency conversion", () => {
    const params = buildCheckoutSessionParams(order(), options);
    expect(params).toMatchObject({
      mode: "payment",
      ui_mode: "hosted_page",
      allowed_payment_method_types: ["card", "link"],
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      billing_address_collection: "auto",
      expires_at: Math.floor(options.expiresAt.getTime() / 1000),
      success_url: options.successUrl,
      cancel_url: options.cancelUrl,
    });
    expect(params).not.toHaveProperty("shipping_address_collection");
  });

  it("ties the session and payment to the order", () => {
    const params = buildCheckoutSessionParams(order(), options);
    const metadata = { order_id: order().id, order_number: "LX-261008-000123", attempt_no: "2" };
    expect(params.client_reference_id).toBe(order().id);
    expect(params.metadata).toEqual(metadata);
    expect(params.payment_intent_data).toMatchObject({ metadata, description: "Luxora order LX-261008-000123" });
    expect(params.payment_intent_data!.shipping).toEqual({
      name: "Test Customer",
      phone: "+33 1 23 45 67 89",
      address: {
        line1: "12 Rue Saint-Honoré",
        line2: undefined,
        city: "Paris",
        state: undefined,
        postal_code: "75001",
        country: "FR",
      },
    });
  });

  it("attaches the provider customer when known, otherwise the order email", () => {
    expect(buildCheckoutSessionParams(order(), options)).toMatchObject({ customer_email: "customer@example.test" });
    const withCustomer = buildCheckoutSessionParams(order(), { ...options, customerId: "cus_test_123" });
    expect(withCustomer.customer).toBe("cus_test_123");
    expect(withCustomer).not.toHaveProperty("customer_email");
  });

  it("labels free shipping", () => {
    const free = buildCheckoutSessionParams(order({ shippingMinor: 0, totalMinor: 34_689 }), options);
    expect(free.shipping_options![0].shipping_rate_data).toMatchObject({
      display_name: "Free shipping",
      fixed_amount: { amount: 0 },
    });
  });
});

describe("tax readiness", () => {
  it("keeps Stripe Tax disabled but carries product tax codes", async () => {
    const { STRIPE_TAX_ENABLED } = await import("@/config/payments");
    expect(STRIPE_TAX_ENABLED).toBe(false);
    const withCode = order();
    withCode.items[0] = { ...withCode.items[0], taxCode: "txcd_30011000" };
    const params = buildCheckoutSessionParams(withCode, options);
    expect(params.automatic_tax).toEqual({ enabled: false });
    expect(params.line_items![0].price_data!.product_data!.tax_code).toBe("txcd_30011000");
    expect(params.line_items![1].price_data!.product_data).not.toHaveProperty("tax_code");
    expect(params.line_items!.every((item) => item.price_data!.tax_behavior === "exclusive")).toBe(true);
  });
});

describe("assertCheckoutAmounts", () => {
  it("refuses orders whose rows do not add up", () => {
    expect(() => assertCheckoutAmounts(order({ totalMinor: 36_190 }))).toThrow(CheckoutAmountError);
    expect(() => assertCheckoutAmounts(order({ subtotalMinor: 1 }))).toThrow(/subtotal/);
    const badLine = order();
    badLine.items[0] = { ...badLine.items[0], totalMinor: 1 };
    expect(() => assertCheckoutAmounts(badLine)).toThrow(/COAT-M/);
    expect(() => assertCheckoutAmounts(order({ items: [] }))).toThrow(/no items/);
  });

  it("refuses tax while Stripe Tax is disabled, and more than 100 lines", () => {
    expect(() => assertCheckoutAmounts(order({ taxMinor: 100, totalMinor: 36_289 }))).toThrow(/Tax/);
    const many = Array.from({ length: 101 }, (_, i) => ({
      productName: `P${i}`,
      variantTitle: "Default",
      sku: `SKU-${i}`,
      quantity: 1,
      unitPriceMinor: 100,
      totalMinor: 100,
    }));
    expect(() =>
      assertCheckoutAmounts(order({ items: many, subtotalMinor: 10_100, shippingMinor: 0, totalMinor: 10_100 })),
    ).toThrow(/at most 100/);
  });
});
