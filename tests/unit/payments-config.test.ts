import { describe, expect, it } from "vitest";
import { CHECKOUT_PAYMENT_METHODS, LIVE_PAYMENTS_APPROVED } from "@/config/payments";
import { PaymentConfigurationError, readStripeConfig } from "@/lib/payments/config";
import { getPaymentProvider, paymentsEnabled } from "@/lib/payments/provider";

const TEST_KEY = ["sk", "test", "fixtureABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_");
const RESTRICTED_TEST_KEY = ["rk", "test", "fixtureABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_");
const LIVE_KEY = ["sk", "live", "fixtureABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_");
const WEBHOOK = "whsec_abcdefghijklmnopqrstuvwxyz012345";

describe("Stripe configuration (test mode only)", () => {
  it("keeps live payments unapproved and offers only immediate payment methods", () => {
    expect(LIVE_PAYMENTS_APPROVED).toBe(false);
    expect([...CHECKOUT_PAYMENT_METHODS]).toEqual(["card", "link"]);
  });

  it("accepts test-mode secret and restricted keys", () => {
    expect(readStripeConfig({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK })).toEqual({
      secretKey: TEST_KEY,
      webhookSecret: WEBHOOK,
      mode: "test",
    });
    expect(readStripeConfig({ STRIPE_SECRET_KEY: RESTRICTED_TEST_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK }).mode).toBe(
      "test",
    );
  });

  it("blocks live keys while live payments are not approved", () => {
    for (const key of [LIVE_KEY, ["rk", "live", "fixtureABCDEFGHIJKLMNOPQRSTUVWXYZ"].join("_")]) {
      expect(() => readStripeConfig({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: WEBHOOK })).toThrow(
        /Live Stripe keys are blocked/,
      );
    }
  });

  it("rejects missing or malformed keys and webhook secrets", () => {
    expect(() => readStripeConfig({})).toThrow(PaymentConfigurationError);
    expect(() =>
      readStripeConfig({ STRIPE_SECRET_KEY: "pk_test_123456789012", STRIPE_WEBHOOK_SECRET: WEBHOOK }),
    ).toThrow(/test-mode secret/);
    expect(() => readStripeConfig({ STRIPE_SECRET_KEY: TEST_KEY })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() => readStripeConfig({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: "secret" })).toThrow(/whsec_/);
  });
});

describe("payment provider selection", () => {
  it("is disabled when PAYMENT_PROVIDER is unset", () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(paymentsEnabled({ PAYMENT_PROVIDER: " " })).toBe(false);
  });

  it("enables Stripe in test mode with valid keys", () => {
    const env = { PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK };
    expect(getPaymentProvider(env)).toEqual({ id: "stripe", displayName: "Stripe (test mode)", mode: "test" });
    expect(paymentsEnabled(env)).toBe(true);
  });

  it("fails loudly for unknown providers and for Stripe with live keys", () => {
    expect(() => getPaymentProvider({ PAYMENT_PROVIDER: "paypal" })).toThrow(/only "stripe"/);
    expect(() =>
      getPaymentProvider({ PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK }),
    ).toThrow(/Live Stripe keys are blocked/);
  });
});
