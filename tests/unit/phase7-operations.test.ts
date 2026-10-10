import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart } from "@/features/reports/components/bar-chart";
import { formatRateBps, shortDay, spansYears } from "@/features/reports/format";
import {
  auditLogTimeBounds,
  COMMISSION_SOURCES,
  commissionRuleState,
  commissionSourceLabel,
  isSensitiveSettingKey,
  parseAuditLogFilters,
  REDACTED,
  redactedJson,
} from "@/features/operations/state";
import { labelIndexes, layoutBars, niceMax } from "@/lib/reporting/chart";
import {
  addDays,
  changeBps,
  comparisonLabel,
  daysInRange,
  MAX_PERIOD_DAYS,
  parseUtcDay,
  previousRange,
  rangeLabel,
  ratioBps,
  resolvePeriod,
} from "@/lib/reporting/periods";
import { accountStatusSchema, commissionRuleFormSchema } from "@/lib/validation";

describe("reporting periods (UTC)", () => {
  it("parses only real calendar days", () => {
    expect(parseUtcDay("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    expect(parseUtcDay("2023-02-29")).toBeNull();
    expect(parseUtcDay("2024-13-01")).toBeNull();
    expect(parseUtcDay("2024-3-1")).toBeNull();
    expect(parseUtcDay(undefined)).toBeNull();
    expect(parseUtcDay(["2024-03-01"])).toBeNull();
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
  });

  it("counts days inclusively and finds the equal-length previous period", () => {
    expect(daysInRange({ from: "2024-03-01", to: "2024-03-07" })).toBe(7);
    expect(daysInRange({ from: "2024-03-05", to: "2024-03-05" })).toBe(1);
    expect(previousRange({ from: "2024-03-01", to: "2024-03-07" })).toEqual({ from: "2024-02-23", to: "2024-02-29" });
    expect(previousRange({ from: "2024-03-05", to: "2024-03-05" })).toEqual({ from: "2024-03-04", to: "2024-03-04" });
  });

  it("ends presets on today's UTC date, not the server's local date", () => {
    // 23:30 on 7 March in New York is already 8 March in UTC.
    const today = new Date("2024-03-07T23:30:00-05:00");
    const { period, error } = resolvePeriod({ period: "7d" }, today);
    expect(error).toBeNull();
    expect(period).toMatchObject({ kind: "7d", from: "2024-03-02", to: "2024-03-08", days: 7 });
    expect(period.previous).toEqual({ from: "2024-02-24", to: "2024-03-01" });
  });

  it("supports 7, 30 and 90 day presets and defaults to 30", () => {
    const today = new Date("2024-03-31T12:00:00Z");
    expect(resolvePeriod({ period: "30d" }, today).period).toMatchObject({
      from: "2024-03-02",
      to: "2024-03-31",
      days: 30,
    });
    expect(resolvePeriod({ period: "90d" }, today).period).toMatchObject({ from: "2024-01-02", days: 90 });
    expect(resolvePeriod({}, today).period.kind).toBe("30d");
    expect(resolvePeriod({ period: "365d" }, today)).toMatchObject({ period: { kind: "30d" }, error: null });
  });

  it("validates custom ranges and falls back to 30 days with a reason", () => {
    const today = new Date("2024-03-31T12:00:00Z");
    expect(resolvePeriod({ period: "custom", from: "2024-03-01", to: "2024-03-07" }, today)).toMatchObject({
      period: {
        kind: "custom",
        from: "2024-03-01",
        to: "2024-03-07",
        days: 7,
        previous: { from: "2024-02-23", to: "2024-02-29" },
      },
      error: null,
    });
    // From/to without ?period are treated as custom.
    expect(resolvePeriod({ from: "2024-03-01", to: "2024-03-01" }, today).period.kind).toBe("custom");
    expect(resolvePeriod({ period: "custom", from: "2024-03-07", to: "2024-03-01" }, today)).toMatchObject({
      period: { kind: "30d" },
      error: "The end date must be on or after the start date.",
    });
    expect(resolvePeriod({ period: "custom", from: "2024-02-30", to: "2024-03-01" }, today).error).toBe(
      "Enter both dates as YYYY-MM-DD.",
    );
    expect(resolvePeriod({ period: "custom", to: "2024-03-01" }, today).error).toBe("Enter both dates as YYYY-MM-DD.");
  });

  it("allows at most 366 days, like the database", () => {
    const today = new Date("2025-06-01T00:00:00Z");
    const ok = resolvePeriod({ period: "custom", from: "2024-01-01", to: "2024-12-31" }, today);
    expect(ok.error).toBeNull();
    expect(ok.period.days).toBe(MAX_PERIOD_DAYS);
    const tooLong = resolvePeriod({ period: "custom", from: "2024-01-01", to: "2025-01-01" }, today);
    expect(tooLong.error).toBe("Choose at most 366 days.");
    expect(tooLong.period.kind).toBe("30d");
  });

  it("labels ranges in UTC", () => {
    expect(rangeLabel({ from: "2024-03-01", to: "2024-03-07" })).toBe("Mar 1, 2024 – Mar 7, 2024 (UTC)");
    expect(rangeLabel({ from: "2024-03-01", to: "2024-03-01" })).toBe("Mar 1, 2024 (UTC)");
  });
});

describe("comparison with the previous period", () => {
  it("computes change in basis points and ratios", () => {
    expect(changeBps(1125, 1000)).toBe(1250);
    expect(changeBps(500, 1000)).toBe(-5000);
    expect(changeBps(5, 0)).toBeNull();
    expect(changeBps(-50, -100)).toBe(5000);
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(2, 3)).toBe(6667);
    expect(ratioBps(1, 0)).toBeNull();
  });

  it("writes comparison labels", () => {
    expect(comparisonLabel(1125, 1000, 7)).toBe("+12.5% vs the previous 7 days");
    expect(comparisonLabel(500, 1000, 30)).toBe("−50% vs the previous 30 days");
    expect(comparisonLabel(1000, 1000, 7)).toBe("No change vs the previous 7 days");
    expect(comparisonLabel(0, 0, 7)).toBe("None in the previous 7 days either");
    expect(comparisonLabel(10, 0, 1)).toBe("Nothing to compare in the previous day");
    expect(comparisonLabel(3000, 1000, 90)).toBe("+200% vs the previous 90 days");
  });

  it("formats rates from basis points", () => {
    expect(formatRateBps(1250)).toBe("12.5%");
    expect(formatRateBps(3333)).toBe("33.3%");
    expect(formatRateBps(1999)).toBe("20%");
    expect(formatRateBps(0)).toBe("0%");
    expect(formatRateBps(-500)).toBe("−5%");
    expect(formatRateBps(null)).toBe("—");
  });

  it("labels chart days, adding the year when a range spans years", () => {
    expect(shortDay("2024-03-05")).toBe("Mar 5");
    expect(shortDay("2024-03-05", true)).toBe("Mar 5, 2024");
    expect(spansYears({ from: "2024-12-01", to: "2025-01-15" })).toBe(true);
    expect(spansYears({ from: "2024-01-01", to: "2024-12-31" })).toBe(false);
  });
});

describe("chart scaling", () => {
  it("rounds the axis maximum up to 1/2/5 × 10^n", () => {
    expect(niceMax(0)).toBe(0);
    expect(niceMax(-5)).toBe(0);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(100)).toBe(100);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(450)).toBe(500);
    expect(niceMax(19_900)).toBe(20_000);
  });

  it("lays out bars proportionally from the baseline", () => {
    const { bars, max } = layoutBars([0, 50, 100], 300, 100, 2);
    expect(max).toBe(100);
    expect(bars.map((b) => b.height)).toEqual([0, 50, 100]);
    expect(bars.map((b) => b.y)).toEqual([100, 50, 0]);
    expect(bars.map((b) => b.x)).toEqual([0, 100, 200]);
    expect(bars.every((b) => b.width === 98)).toBe(true);
  });

  it("keeps tiny values visible and never draws negative bars", () => {
    const { bars } = layoutBars([1, 10_000, -50], 300, 100);
    expect(bars[0].height).toBe(1);
    expect(bars[2].height).toBe(0);
    expect(bars[2].value).toBe(-50);
    expect(layoutBars([], 300, 100)).toEqual({ bars: [], max: 0 });
  });

  it("labels the first, last and evenly spaced days", () => {
    expect(labelIndexes(0)).toEqual([]);
    expect(labelIndexes(4)).toEqual([0, 1, 2, 3]);
    expect(labelIndexes(30)).toEqual([0, 6, 12, 17, 23, 29]);
    expect(labelIndexes(366)).toHaveLength(6);
    expect(labelIndexes(366).at(-1)).toBe(365);
  });

  it("renders an SVG with escaped hover titles and a table view", () => {
    const html = renderToStaticMarkup(
      createElement(BarChart, {
        title: "Sales",
        description: "daily sales",
        points: [
          { label: "<b>Mar 1</b>", value: 100 },
          { label: "Mar 2", value: 0 },
        ],
        format: (v: number) => `$${v}`,
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("&lt;b&gt;Mar 1&lt;/b&gt;: $100");
    expect(html).not.toContain("<b>Mar 1</b>");
    expect(html).toContain("Show as table");
    expect(html).toContain("Scale up to $100");
  });

  it("shows an empty state instead of an empty chart", () => {
    const html = renderToStaticMarkup(
      createElement(BarChart, {
        title: "Sales",
        description: "d",
        points: [{ label: "Mar 1", value: 0 }],
        format: String,
      }),
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("Nothing in this period.");
  });
});

describe("commission rule form", () => {
  const base = { name: "Jewellery", rate: "12.5", startsAt: "", endsAt: "" };

  it("converts the percentage to basis points and keeps only the scope's target", () => {
    const vendorId = "11111111-1111-4111-8111-111111111111";
    const categoryId = "22222222-2222-4222-8222-222222222222";
    const parsed = commissionRuleFormSchema.parse({ ...base, scope: "vendor", vendorId, categoryId });
    expect(parsed).toMatchObject({ scope: "vendor", vendorId, rate: 1250 });
    expect(parsed.categoryId).toBeUndefined();
    const global = commissionRuleFormSchema.parse({ ...base, scope: "global", vendorId, categoryId, rate: "0" });
    expect(global).toMatchObject({ rate: 0, vendorId: undefined, categoryId: undefined });
  });

  it("requires a target for vendor and category rules", () => {
    const vendor = commissionRuleFormSchema.safeParse({ ...base, scope: "vendor", vendorId: "" });
    expect(vendor.success).toBe(false);
    expect(vendor.error?.issues[0]).toMatchObject({
      path: ["vendorId"],
      message: "Choose the vendor this rule applies to.",
    });
    const category = commissionRuleFormSchema.safeParse({ ...base, scope: "category" });
    expect(category.error?.issues[0]?.path).toEqual(["categoryId"]);
  });

  it("rejects rates above 100%, bad names and an end before the start", () => {
    expect(commissionRuleFormSchema.safeParse({ ...base, scope: "global", rate: "100.01" }).success).toBe(false);
    expect(commissionRuleFormSchema.safeParse({ ...base, scope: "global", rate: "100" }).success).toBe(true);
    expect(commissionRuleFormSchema.safeParse({ ...base, scope: "global", rate: "-1" }).success).toBe(false);
    expect(commissionRuleFormSchema.safeParse({ ...base, scope: "global", name: "x" }).success).toBe(false);
    const dates = commissionRuleFormSchema.safeParse({
      ...base,
      scope: "global",
      startsAt: "2026-05-01T00:00",
      endsAt: "2026-05-01T00:00",
    });
    expect(dates.error?.issues[0]).toMatchObject({ path: ["endsAt"], message: "The end must be after the start." });
  });

  it("derives rule states and labels resolver sources", () => {
    const now = Date.parse("2026-05-10T00:00:00Z");
    const rule = { is_active: true, starts_at: "2026-05-01T00:00:00Z", ends_at: null };
    expect(commissionRuleState(rule, now)).toBe("in_effect");
    expect(commissionRuleState({ ...rule, starts_at: "2026-06-01T00:00:00Z" }, now)).toBe("scheduled");
    expect(commissionRuleState({ ...rule, ends_at: "2026-05-10T00:00:00Z" }, now)).toBe("ended");
    expect(commissionRuleState({ ...rule, is_active: false }, now)).toBe("inactive");
    expect(COMMISSION_SOURCES).toEqual([
      "vendor_rule",
      "vendor_override",
      "category_rule",
      "category_rate",
      "global_rule",
      "platform_default",
    ]);
    expect(commissionSourceLabel("vendor_override")).toBe("Vendor's own rate");
    expect(commissionSourceLabel("something_new")).toBe("something_new");
  });
});

describe("customer account status", () => {
  const profileId = "33333333-3333-4333-8333-333333333333";

  it("requires a reason and an explicit confirmation", () => {
    expect(
      accountStatusSchema.safeParse({ profileId, status: "suspended", reason: "Chargeback abuse", confirmed: true })
        .success,
    ).toBe(true);
    expect(
      accountStatusSchema.safeParse({ profileId, status: "suspended", reason: "  ", confirmed: true }).success,
    ).toBe(false);
    expect(
      accountStatusSchema.safeParse({ profileId, status: "suspended", reason: "Fraud", confirmed: false }).success,
    ).toBe(false);
    expect(
      accountStatusSchema.safeParse({ profileId, status: "active", reason: "x".repeat(501), confirmed: true }).success,
    ).toBe(false);
  });

  it("only allows suspending or reactivating", () => {
    expect(
      accountStatusSchema.safeParse({ profileId, status: "deactivated", reason: "Closing", confirmed: true }).success,
    ).toBe(false);
    expect(
      accountStatusSchema.safeParse({ profileId: "nope", status: "active", reason: "Appeal", confirmed: true }).success,
    ).toBe(false);
  });
});

describe("settings and audit log display", () => {
  it("redacts values under credential-like keys at any depth", () => {
    expect(isSensitiveSettingKey("stripe.secret_key")).toBe(true);
    expect(isSensitiveSettingKey("webhook_signing")).toBe(true);
    expect(isSensitiveSettingKey("commission.default_bps")).toBe(false);
    expect(redactedJson({ value: "sk_test_123" }, "payments.api_key")).toBe(JSON.stringify(REDACTED));
    const nested = JSON.parse(redactedJson({ currency: "USD", provider: { token: "abc", region: "eu" } }));
    expect(nested).toEqual({ currency: "USD", provider: { token: REDACTED, region: "eu" } });
    expect(redactedJson(1500, "commission.default_bps")).toBe("1500");
  });

  it("keeps markup in metadata as inert text", () => {
    const html = renderToStaticMarkup(
      createElement("pre", null, redactedJson({ note: "<img src=x onerror=alert(1)>" })),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("parses audit filters and ignores malformed values", () => {
    const filters = parseAuditLogFilters({
      action: "commission.",
      entity: "profile",
      entityId: "33333333-3333-4333-8333-333333333333",
      actor: "not-a-uuid",
      from: "2024-03-01",
      to: "2024-02-30",
      page: "-3",
    });
    expect(filters).toEqual({
      action: "commission.",
      entityType: "profile",
      entityId: "33333333-3333-4333-8333-333333333333",
      actorId: null,
      from: "2024-03-01",
      to: null,
      page: 1,
    });
    expect(parseAuditLogFilters({ action: "a'; drop table x;--" }).action).toBeNull();
    expect(parseAuditLogFilters({ page: "4" }).page).toBe(4);
  });

  it("turns day filters into UTC bounds that include the whole last day", () => {
    expect(auditLogTimeBounds({ from: "2024-03-01", to: "2024-03-07" })).toEqual({
      gte: "2024-03-01T00:00:00.000Z",
      lt: "2024-03-08T00:00:00.000Z",
    });
    expect(auditLogTimeBounds({ from: null, to: "2024-12-31" })).toEqual({ gte: null, lt: "2025-01-01T00:00:00.000Z" });
  });
});
