import { describe, expect, it } from "vitest";
import { toDecimalInput } from "@/lib/money";
import { shippingZoneSchema, vendorShippingRateSchema } from "@/lib/validation";

const ZONE = "00000000-0000-4000-8000-000000000001";

describe("shippingZoneSchema", () => {
  it("accepts ISO-2 countries once each", () => {
    const parsed = shippingZoneSchema.parse({ name: "Europe", countries: ["FR", "DE"], position: "" });
    expect(parsed).toMatchObject({ name: "Europe", countries: ["FR", "DE"], position: 0, isActive: true });
    expect(shippingZoneSchema.safeParse({ name: "Europe", countries: ["FR", "FR"] }).success).toBe(false);
    expect(shippingZoneSchema.safeParse({ name: "Europe", countries: ["fr"] }).success).toBe(false);
    expect(shippingZoneSchema.safeParse({ name: "E", countries: [] }).success).toBe(false);
  });
});

describe("vendorShippingRateSchema", () => {
  const base = {
    zoneId: ZONE,
    enabled: true,
    firstItem: "12.50",
    additionalItem: "3",
    freeOver: "",
    minDays: "",
    maxDays: "",
  };

  it("parses money strings and optional fields", () => {
    expect(vendorShippingRateSchema.parse(base)).toMatchObject({
      firstItem: "12.50",
      additionalItem: "3",
      freeOver: undefined,
      minDays: undefined,
      maxDays: undefined,
    });
    expect(vendorShippingRateSchema.parse({ ...base, freeOver: "250", minDays: "3", maxDays: "7" })).toMatchObject({
      freeOver: "250",
      minDays: 3,
      maxDays: 7,
    });
  });

  it("rejects invalid amounts and an inverted delivery window", () => {
    expect(vendorShippingRateSchema.safeParse({ ...base, firstItem: "" }).success).toBe(false);
    expect(vendorShippingRateSchema.safeParse({ ...base, firstItem: "-1" }).success).toBe(false);
    expect(vendorShippingRateSchema.safeParse({ ...base, additionalItem: "1.234" }).success).toBe(false);
    const inverted = vendorShippingRateSchema.safeParse({ ...base, minDays: "9", maxDays: "2" });
    expect(inverted.success).toBe(false);
    expect(inverted.error?.issues[0]?.path).toEqual(["maxDays"]);
    expect(vendorShippingRateSchema.safeParse({ ...base, maxDays: "121" }).success).toBe(false);
  });
});

describe("toDecimalInput", () => {
  it("formats minor units for inputs without floating point", () => {
    expect(toDecimalInput(1250, "USD")).toBe("12.50");
    expect(toDecimalInput(5, "USD")).toBe("0.05");
    expect(toDecimalInput(0, "USD")).toBe("0.00");
    expect(toDecimalInput(123_456_789, "USD")).toBe("1234567.89");
    expect(toDecimalInput(500, "JPY")).toBe("500");
    expect(toDecimalInput(null, "USD")).toBe("");
    expect(toDecimalInput(undefined, "USD")).toBe("");
  });
});
