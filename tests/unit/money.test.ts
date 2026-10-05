import { describe, expect, it } from "vitest";
import {
  add,
  allocateProportionally,
  applyBasisPoints,
  formatBasisPoints,
  formatMoney,
  money,
  MoneyError,
  multiply,
  parseToMinor,
  subtract,
  sum,
} from "@/lib/money";

describe("money arithmetic", () => {
  it("adds and subtracts amounts in the same currency", () => {
    expect(add(money(1050, "USD"), money(250, "USD"))).toEqual({ amountMinor: 1300, currency: "USD" });
    expect(subtract(money(1050, "USD"), money(50, "USD"))).toEqual({ amountMinor: 1000, currency: "USD" });
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(1, "USD"), money(1, "EUR"))).toThrow(MoneyError);
  });

  it("rejects non-integer amounts", () => {
    expect(() => money(10.5, "USD")).toThrow(MoneyError);
    expect(() => multiply(money(100, "USD"), 1.5)).toThrow(MoneyError);
  });

  it("sums line totals", () => {
    expect(sum([money(100, "USD"), money(250, "USD")], "USD").amountMinor).toBe(350);
    expect(sum([], "USD").amountMinor).toBe(0);
  });
});

describe("applyBasisPoints", () => {
  it("matches the SQL function calculate_commission_minor (round half up)", () => {
    expect(applyBasisPoints(10_000, 1500)).toBe(1500);
    expect(applyBasisPoints(999, 1500)).toBe(150); // 149.85 → 150
    expect(applyBasisPoints(1, 5000)).toBe(1); // 0.5 → 1
    expect(applyBasisPoints(333, 1000)).toBe(33); // 33.3 → 33
    expect(applyBasisPoints(0, 1500)).toBe(0);
  });

  it("is deterministic for large amounts", () => {
    expect(applyBasisPoints(123_456_789, 1234)).toBe(15_234_568);
  });

  it("validates the rate", () => {
    expect(() => applyBasisPoints(100, 10_001)).toThrow(MoneyError);
    expect(() => applyBasisPoints(100, -1)).toThrow(MoneyError);
    expect(() => applyBasisPoints(100, 12.5)).toThrow(MoneyError);
  });
});

describe("allocateProportionally", () => {
  it("always sums exactly to the total", () => {
    const parts = allocateProportionally(1000, [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("weights by the provided amounts", () => {
    expect(allocateProportionally(1870, [24_000, 30_000])).toEqual([831, 1039]);
  });

  it("splits equally when all weights are zero", () => {
    expect(allocateProportionally(5, [0, 0])).toEqual([3, 2]);
  });

  it("is deterministic in tie-breaking", () => {
    expect(allocateProportionally(1, [1, 1])).toEqual([1, 0]);
  });

  it("rejects empty or negative weights", () => {
    expect(() => allocateProportionally(100, [])).toThrow(MoneyError);
    expect(() => allocateProportionally(100, [1, -1])).toThrow(MoneyError);
  });
});

describe("parsing and formatting", () => {
  it("parses decimal input without floating point error", () => {
    expect(parseToMinor("0.1", "USD") + parseToMinor("0.2", "USD")).toBe(30);
    expect(parseToMinor("1,234.56", "USD")).toBe(123_456);
    expect(parseToMinor("12", "USD")).toBe(1200);
    expect(parseToMinor("5", "JPY")).toBe(5);
    expect(parseToMinor("1.250", "KWD")).toBe(1250);
  });

  it("rejects too many decimal places for the currency", () => {
    expect(() => parseToMinor("1.005", "USD")).toThrow(MoneyError);
    expect(() => parseToMinor("1.5", "JPY")).toThrow(MoneyError);
    expect(() => parseToMinor("abc", "USD")).toThrow(MoneyError);
  });

  it("formats minor units for display", () => {
    expect(formatMoney(123_456, "USD")).toBe("$1,234.56");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(-250, "USD")).toBe("-$2.50");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(formatMoney(123_456, "EUR", "de-DE").replace(/\u00a0/g, " ")).toBe("1.234,56 €");
  });

  it("formats basis points as percentages", () => {
    expect(formatBasisPoints(1500)).toBe("15%");
    expect(formatBasisPoints(1250)).toBe("12.5%");
    expect(formatBasisPoints(1234)).toBe("12.34%");
    expect(formatBasisPoints(0)).toBe("0%");
  });
});
