import { describe, expect, it } from "vitest";
import { refundRequestSchema, reversePayoutSchema, shippingChoiceToFlag, vendorPayoutSchema } from "@/lib/validation";

const VO = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const ITEM2 = "00000000-0000-4000-8000-000000000003";

describe("refundRequestSchema", () => {
  it("keeps only items with a quantity and defaults shipping to the policy", () => {
    const parsed = refundRequestSchema.parse({
      vendorOrderId: VO,
      kind: "return",
      reason: "Arrived damaged",
      items: [
        { orderItemId: ITEM, quantity: "2" },
        { orderItemId: ITEM2, quantity: "0" },
      ],
    });
    expect(parsed).toEqual({
      vendorOrderId: VO,
      kind: "return",
      reason: "Arrived damaged",
      shipping: "policy",
      items: [{ orderItemId: ITEM, quantity: 2 }],
    });
  });

  it("requires an item unless shipping alone is refunded, and a reason", () => {
    const base = {
      vendorOrderId: VO,
      kind: "goodwill",
      reason: "Late delivery",
      items: [{ orderItemId: ITEM, quantity: 0 }],
    };
    expect(refundRequestSchema.safeParse(base).success).toBe(false);
    expect(refundRequestSchema.safeParse({ ...base, shipping: "include" }).success).toBe(true);
    expect(refundRequestSchema.safeParse({ ...base, shipping: "include", reason: "no" }).success).toBe(false);
    expect(refundRequestSchema.safeParse({ ...base, kind: "late_payment", shipping: "include" }).success).toBe(false);
    expect(refundRequestSchema.safeParse({ ...base, items: [{ orderItemId: ITEM, quantity: -1 }] }).success).toBe(
      false,
    );
  });

  it("maps the shipping choice to the database flag", () => {
    expect(shippingChoiceToFlag("policy")).toBeNull();
    expect(shippingChoiceToFlag("include")).toBe(true);
    expect(shippingChoiceToFlag("exclude")).toBe(false);
  });
});

describe("payout schemas", () => {
  it("validates a manual payout record", () => {
    expect(
      vendorPayoutSchema.safeParse({ vendorId: VO, amount: "187.00", method: "Bank transfer", reference: "TRX-1" })
        .success,
    ).toBe(true);
    expect(
      vendorPayoutSchema.safeParse({ vendorId: VO, amount: "-1", method: "Bank", reference: "TRX-1" }).success,
    ).toBe(false);
    expect(vendorPayoutSchema.safeParse({ vendorId: VO, amount: "10", method: "B", reference: "TRX-1" }).success).toBe(
      false,
    );
    expect(reversePayoutSchema.safeParse({ payoutId: VO, reason: "Bounced" }).success).toBe(true);
    expect(reversePayoutSchema.safeParse({ payoutId: VO, reason: "" }).success).toBe(false);
  });
});
