import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL,
  DUTIES_AND_TAXES_NOTICE,
  GOVERNING_LAW,
  isPlaceholder,
  LEGAL_COMPANY_NAME,
  LEGAL_DETAILS_PENDING,
  LEGAL_LAST_UPDATED,
  REGISTERED_BUSINESS_ADDRESS,
  PAYOUT_HOLD_DAYS_AFTER_DELIVERY,
  RETURN_SHIPPING_PAID_BY,
  RETURN_WINDOW_DAYS,
  VENDOR_TERMS_VERSION,
} from "@/config/legal";

describe("legal configuration", () => {
  it("keeps every company detail as an explicit placeholder until supplied", () => {
    // Guard against invented details: replacing a placeholder is a deliberate,
    // reviewed change, and this test must be updated with it.
    for (const [name, value] of Object.entries({
      LEGAL_COMPANY_NAME,
      REGISTERED_BUSINESS_ADDRESS,
      CONTACT_EMAIL,
      GOVERNING_LAW,
    })) {
      expect(value).toBe(`[PLACEHOLDER: ${name}]`);
      expect(isPlaceholder(value)).toBe(true);
    }
    expect(LEGAL_DETAILS_PENDING).toBe(true);
    expect(isPlaceholder("Luxora Ltd")).toBe(false);
  });

  it("encodes the confirmed Release 4a policy decisions", () => {
    expect(RETURN_WINDOW_DAYS).toBe(14);
    expect(RETURN_SHIPPING_PAID_BY).toBe("customer");
    expect(DUTIES_AND_TAXES_NOTICE).toBe("Duties and taxes may apply on delivery.");
    // Phase 4b: vendor earnings become payable 14 days after delivery
    // (mirrors the platform setting payouts.hold_days_after_delivery).
    expect(PAYOUT_HOLD_DAYS_AFTER_DELIVERY).toBe(14);
  });

  it("uses a terms version the database accepts and a valid date", () => {
    // Mirrors the CHECK constraint on vendor_applications.terms_version.
    expect(VENDOR_TERMS_VERSION).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
    expect(Number.isNaN(Date.parse(LEGAL_LAST_UPDATED))).toBe(false);
  });
});
