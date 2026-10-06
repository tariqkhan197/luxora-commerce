import { describe, expect, it } from "vitest";
import {
  addressSchema,
  addToCartSchema,
  placeOrderSchema,
  updateCartItemSchema,
  vendorFulfilmentSchema,
} from "@/lib/validation";

const id = "11111111-1111-4111-8111-111111111111";

describe("cart schemas", () => {
  it("accepts ids and quantities only — never prices", () => {
    expect(addToCartSchema.parse({ variantId: id, quantity: "2" })).toEqual({ variantId: id, quantity: 2 });
    expect(addToCartSchema.parse({ variantId: id })).toEqual({ variantId: id, quantity: 1 });
    // Unknown keys such as a price are stripped, so they can never reach the database.
    expect(addToCartSchema.parse({ variantId: id, quantity: 1, unitPriceMinor: 1 })).toEqual({
      variantId: id,
      quantity: 1,
    });
    expect(addToCartSchema.safeParse({ variantId: id, quantity: 0 }).success).toBe(false);
    expect(addToCartSchema.safeParse({ variantId: id, quantity: 1.5 }).success).toBe(false);
    expect(addToCartSchema.safeParse({ variantId: id, quantity: 100 }).success).toBe(false);
    expect(updateCartItemSchema.safeParse({ cartItemId: id, quantity: 0 }).success).toBe(true);
  });
});

describe("addressSchema", () => {
  it("normalises country codes and treats blank optionals as absent", () => {
    const parsed = addressSchema.parse({
      fullName: "Ada Lovelace",
      line1: "12 St James's Square",
      line2: "",
      city: "London",
      postalCode: "SW1Y 4LB",
      countryCode: " gb ",
      phone: "",
      label: "",
      state: "",
    });
    expect(parsed).toMatchObject({
      countryCode: "GB",
      type: "both",
      line2: undefined,
      phone: undefined,
      isDefaultShipping: false,
    });
  });

  it("rejects missing required fields and malformed values", () => {
    const result = addressSchema.safeParse({
      fullName: "",
      line1: "",
      city: "",
      postalCode: "",
      countryCode: "GBR",
      phone: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toEqual(
        expect.arrayContaining(["fullName", "line1", "city", "postalCode", "countryCode", "phone"]),
      );
    }
  });
});

describe("placeOrderSchema", () => {
  it("requires a billing address unless billing matches shipping", () => {
    const base = { shippingAddressId: id, checkoutToken: id, expectedTotalMinor: 1000 };
    expect(placeOrderSchema.safeParse({ ...base }).success).toBe(true);
    expect(placeOrderSchema.safeParse({ ...base, billingSameAsShipping: false }).success).toBe(false);
    expect(placeOrderSchema.safeParse({ ...base, billingSameAsShipping: false, billingAddressId: id }).success).toBe(
      true,
    );
    expect(placeOrderSchema.safeParse({ ...base, expectedTotalMinor: 10.5 }).success).toBe(false);
  });
});

describe("vendorFulfilmentSchema", () => {
  it("requires tracking details when shipping", () => {
    expect(vendorFulfilmentSchema.safeParse({ vendorOrderId: id, status: "processing" }).success).toBe(true);
    expect(vendorFulfilmentSchema.safeParse({ vendorOrderId: id, status: "shipped" }).success).toBe(false);
    expect(
      vendorFulfilmentSchema.safeParse({ vendorOrderId: id, status: "shipped", carrier: "DHL", trackingNumber: "JD01" })
        .success,
    ).toBe(true);
    expect(vendorFulfilmentSchema.safeParse({ vendorOrderId: id, status: "cancelled" }).success).toBe(false);
  });
});
