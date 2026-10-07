/**
 * Payment configuration (Phase 4b).
 *
 * ⚠️ TEST MODE ONLY ⚠️
 * Luxora's merchant-of-record model has not yet been approved by Stripe, and
 * the business and legal details are still placeholders (src/config/legal.ts).
 * Live payments are therefore blocked in three independent places:
 *   1. `LIVE_PAYMENTS_APPROVED` below rejects live Stripe keys at startup;
 *   2. the webhook route rejects live-mode events;
 *   3. the database refuses live-mode data while the platform setting
 *      `payments.live_mode_enabled` is false.
 * Turning on live payments requires changing all three deliberately, after
 * Stripe, business and legal approval are confirmed.
 */
export const LIVE_PAYMENTS_APPROVED = false;

/** Stripe API version this integration is written and tested against. */
export const STRIPE_API_VERSION = "2026-09-30.endive";

/**
 * Payment methods offered on hosted checkout. `card` includes Apple Pay and
 * Google Pay wallets (enable them in the Stripe Dashboard). Delayed methods
 * (bank debits, transfers, vouchers) are deliberately excluded: they keep an
 * order — and its reserved stock — pending for days.
 */
export const CHECKOUT_PAYMENT_METHODS = ["card", "link"] as const;

/** Merchant name shown on hosted checkout and receipts until the legal name is confirmed. */
export const CHECKOUT_DISPLAY_NAME = "Luxora";

/**
 * Stripe Tax readiness. Tax is NOT collected in Phase 4b: checkout sessions are
 * created with automatic tax disabled and the database refuses taxed payments.
 * Enabling it later needs confirmed tax registrations, this flag, the platform
 * setting `tax.collection_enabled`, and the tax-finalisation step described in
 * docs/PAYMENTS.md.
 */
export const STRIPE_TAX_ENABLED = false;
