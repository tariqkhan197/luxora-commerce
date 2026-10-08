import { describe, expect, it } from "vitest";
import { paidForUnits } from "@/features/payments/refund-amounts";
import { couponState, couponValueLabel, flashSaleState } from "@/features/promotions/state";
import {
  applyCouponSchema,
  basisPointsToPercentInput,
  couponFormSchema,
  dateTimeInputToIso,
  flashSaleFormSchema,
  isoToDateTimeInput,
  percentToBasisPoints,
} from "@/lib/validation";

const VARIANT = "00000000-0000-4000-8000-000000000001";
const VARIANT2 = "00000000-0000-4000-8000-000000000002";

describe("percentages", () => {
  it("parses percentages to basis points without floating point", () => {
    expect(percentToBasisPoints("10")).toBe(1000);
    expect(percentToBasisPoints("12.5")).toBe(1250);
    expect(percentToBasisPoints("0.01")).toBe(1);
    expect(percentToBasisPoints("100")).toBe(10_000);
    expect(percentToBasisPoints("0")).toBeNull();
    expect(percentToBasisPoints("100.5")).toBeNull();
    expect(percentToBasisPoints("1.234")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
  });

  it("formats basis points back for inputs", () => {
    expect(basisPointsToPercentInput(1000)).toBe("10");
    expect(basisPointsToPercentInput(1250)).toBe("12.5");
    expect(basisPointsToPercentInput(1)).toBe("0.01");
  });
});

describe("couponFormSchema", () => {
  const base = { name: "Spring", discountType: "percentage", percent: "10" } as const;

  it("upper-cases codes and checks their format", () => {
    expect(couponFormSchema.parse({ ...base, code: " spring-10 " }).code).toBe("SPRING-10");
    expect(couponFormSchema.safeParse({ ...base, code: "ab" }).success).toBe(false);
    expect(couponFormSchema.safeParse({ ...base, code: "SPRING 10" }).success).toBe(false);
  });

  it("requires the value its discount type needs", () => {
    const missing = couponFormSchema.safeParse({ ...base, code: "SPRING", percent: "" });
    expect(missing.error?.issues[0]?.message).toBe("Enter a percentage between 0.01 and 100.");
    expect(
      couponFormSchema.safeParse({ code: "TENOFF", name: "Ten", discountType: "fixed_amount", amount: "" }).success,
    ).toBe(false);
    expect(couponFormSchema.safeParse({ code: "SHIP", name: "Ship", discountType: "free_shipping" }).success).toBe(
      true,
    );
    const capOnFixed = couponFormSchema.safeParse({
      code: "TENOFF",
      name: "Ten",
      discountType: "fixed_amount",
      amount: "10",
      maxDiscount: "5",
    });
    expect(capOnFixed.error?.issues[0]?.message).toBe("A maximum discount applies to percentage codes only.");
  });

  it("checks the window and limits", () => {
    const backwards = couponFormSchema.safeParse({
      ...base,
      code: "SPRING",
      startsAt: "2026-11-02T10:00",
      endsAt: "2026-11-01T10:00",
    });
    expect(backwards.error?.issues[0]?.message).toBe("The end must be after the start.");
    expect(couponFormSchema.safeParse({ ...base, code: "SPRING", usageLimit: "0" }).success).toBe(false);
    expect(couponFormSchema.parse({ ...base, code: "SPRING", usageLimit: "" }).usageLimit).toBeUndefined();
  });
});

describe("flashSaleFormSchema", () => {
  const sale = { name: "Weekend", startsAt: "2026-11-01T10:00", endsAt: "2026-11-02T10:00" };

  it("accepts items with sale prices and optional unit limits", () => {
    const parsed = flashSaleFormSchema.parse({
      ...sale,
      items: [{ variantId: VARIANT, salePrice: "49.00", quantityLimit: "" }],
    });
    expect(parsed.items).toEqual([{ variantId: VARIANT, salePrice: "49.00", quantityLimit: undefined }]);
  });

  it("refuses a backwards window and duplicate items", () => {
    expect(flashSaleFormSchema.safeParse({ ...sale, endsAt: sale.startsAt, items: [] }).success).toBe(false);
    const duplicate = flashSaleFormSchema.safeParse({
      ...sale,
      items: [
        { variantId: VARIANT, salePrice: "10.00" },
        { variantId: VARIANT, salePrice: "12.00" },
      ],
    });
    expect(duplicate.error?.issues[0]?.message).toBe("Each product option can be listed once.");
    expect(
      flashSaleFormSchema.safeParse({
        ...sale,
        items: [
          { variantId: VARIANT, salePrice: "10.00" },
          { variantId: VARIANT2, salePrice: "abc" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("treats date inputs as UTC", () => {
    expect(dateTimeInputToIso("2026-11-01T10:30")).toBe("2026-11-01T10:30:00.000Z");
    expect(dateTimeInputToIso(undefined)).toBeNull();
    expect(isoToDateTimeInput("2026-11-01T10:30:00.000Z")).toBe("2026-11-01T10:30");
  });

  it("requires a code to apply", () => {
    expect(applyCouponSchema.safeParse({ code: "  " }).success).toBe(false);
    expect(applyCouponSchema.parse({ code: " spring " }).code).toBe("spring");
  });

  it("labels coupon values", () => {
    expect(couponValueLabel("percentage", 1250, "USD")).toBe("12.5% off");
    expect(couponValueLabel("percentage", 5000, "USD", 1000)).toBe("50% off (up to $10.00)");
    expect(couponValueLabel("fixed_amount", 500, "USD")).toBe("$5.00 off");
    expect(couponValueLabel("free_shipping", 0, "USD")).toBe("Free shipping");
  });
});

describe("states", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const coupon = {
    is_active: true,
    disabled_by_admin_at: null,
    starts_at: "2026-10-01T00:00:00Z",
    ends_at: null,
    usage_limit: null,
    used_count: 0,
  };

  it("derives a coupon's state", () => {
    expect(couponState(coupon, now)).toBe("active");
    expect(couponState({ ...coupon, is_active: false }, now)).toBe("paused");
    expect(couponState({ ...coupon, disabled_by_admin_at: "2026-10-02T00:00:00Z" }, now)).toBe("disabled");
    expect(couponState({ ...coupon, ends_at: "2026-10-31T00:00:00Z" }, now)).toBe("expired");
    expect(couponState({ ...coupon, starts_at: "2026-12-01T00:00:00Z" }, now)).toBe("scheduled");
    expect(couponState({ ...coupon, usage_limit: 5, used_count: 5 }, now)).toBe("used_up");
  });

  it("derives a flash sale's state", () => {
    const sale = {
      starts_at: "2026-11-01T00:00:00Z",
      ends_at: "2026-11-02T00:00:00Z",
      status: "scheduled" as const,
      disabled_by_admin_at: null,
    };
    expect(flashSaleState(sale, now)).toBe("live");
    expect(flashSaleState({ ...sale, starts_at: "2026-11-01T13:00:00Z" }, now)).toBe("scheduled");
    expect(flashSaleState({ ...sale, ends_at: "2026-11-01T11:00:00Z" }, now)).toBe("ended");
    expect(flashSaleState({ ...sale, status: "ended" }, now)).toBe("ended");
    expect(flashSaleState({ ...sale, status: "cancelled" }, now)).toBe("cancelled");
    expect(flashSaleState({ ...sale, disabled_by_admin_at: "2026-11-01T01:00:00Z" }, now)).toBe("disabled");
  });
});

describe("paidForUnits", () => {
  it("matches the database's cumulative refund split", () => {
    // 3 × 33.33 − 10.00 = 89.99 → 29.99, 30.00, 30.00 (see the Phase 6B DB tests)
    expect([0, 1, 2].map((done) => paidForUnits(8999, 3, done, 1))).toEqual([2999, 3000, 3000]);
    expect(paidForUnits(8999, 3, 0, 3)).toBe(8999);
    expect(paidForUnits(10_000, 2, 0, 1)).toBe(5000);
    expect(paidForUnits(10_000, 2, 2, 1)).toBe(0);
    expect(paidForUnits(10_000, 0, 0, 1)).toBe(0);
  });
});
