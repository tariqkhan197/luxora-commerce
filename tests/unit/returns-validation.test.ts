import { describe, expect, it } from "vitest";
import { parseReturnFilter } from "@/features/returns/components/return-status-filter";
import {
  approveReturnSchema,
  receiveReturnSchema,
  refundReturnSchema,
  rejectReturnSchema,
  returnRequestSchema,
  returnShippedSchema,
} from "@/lib/validation";

const VO = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const ITEM2 = "00000000-0000-4000-8000-000000000003";
const RET = "00000000-0000-4000-8000-000000000004";

describe("returnRequestSchema", () => {
  it("keeps the selected items with their reasons", () => {
    const parsed = returnRequestSchema.parse({
      vendorOrderId: VO,
      note: "",
      items: [
        { orderItemId: ITEM, quantity: "1", reason: "  Too small " },
        { orderItemId: ITEM2, quantity: "0", reason: "" },
      ],
    });
    expect(parsed).toEqual({
      vendorOrderId: VO,
      note: undefined,
      items: [{ orderItemId: ITEM, quantity: 1, reason: "Too small" }],
    });
  });

  it("requires an item and a reason for every selected item", () => {
    expect(
      returnRequestSchema.safeParse({ vendorOrderId: VO, items: [{ orderItemId: ITEM, quantity: 0 }] }).success,
    ).toBe(false);
    const noReason = returnRequestSchema.safeParse({
      vendorOrderId: VO,
      items: [{ orderItemId: ITEM, quantity: 1, reason: "x" }],
    });
    expect(noReason.success).toBe(false);
    expect(noReason.error?.issues[0]?.message).toContain("Tell us why");
    expect(
      returnRequestSchema.safeParse({
        vendorOrderId: VO,
        items: [{ orderItemId: ITEM, quantity: 100, reason: "Too small" }],
      }).success,
    ).toBe(false);
  });
});

describe("return step schemas", () => {
  it("validates tracking, decisions, receipt and refund options", () => {
    expect(returnShippedSchema.safeParse({ returnId: RET, carrier: "La Poste", trackingNumber: "LP123" }).success).toBe(
      true,
    );
    expect(
      returnShippedSchema.safeParse({
        returnId: RET,
        carrier: "La Poste",
        trackingNumber: "LP123",
        trackingUrl: "ftp://x",
      }).success,
    ).toBe(false);
    expect(approveReturnSchema.safeParse({ returnId: RET, instructions: "short" }).success).toBe(false);
    expect(approveReturnSchema.safeParse({ returnId: RET, instructions: "1 Rue X, 75001 Paris, France" }).success).toBe(
      true,
    );
    expect(rejectReturnSchema.safeParse({ returnId: RET, reason: "" }).success).toBe(false);
    expect(receiveReturnSchema.parse({ returnId: RET })).toEqual({ returnId: RET, restock: true, notes: undefined });
    expect(refundReturnSchema.parse({ returnId: RET })).toEqual({ returnId: RET, shipping: "policy" });
  });
});

describe("parseReturnFilter", () => {
  it("accepts known statuses and 'all', otherwise falls back", () => {
    expect(parseReturnFilter("approved", "requested")).toBe("approved");
    expect(parseReturnFilter("all", "requested")).toBeNull();
    expect(parseReturnFilter("bogus", "received")).toBe("received");
    expect(parseReturnFilter(undefined, "requested")).toBe("requested");
  });
});
