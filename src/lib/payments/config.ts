import { LIVE_PAYMENTS_APPROVED } from "@/config/payments";

/**
 * Validates the Stripe environment. Pure (takes the env as an argument) so it
 * can be unit-tested; read on the server only.
 */

export class PaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigurationError";
  }
}

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  mode: "test" | "live";
}

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]{10,}$/;
const LIVE_KEY = /^(sk|rk)_live_[A-Za-z0-9]{10,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]{10,}$/;

export function readStripeConfig(env: Record<string, string | undefined>): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";

  if (LIVE_KEY.test(secretKey)) {
    if (!LIVE_PAYMENTS_APPROVED) {
      throw new PaymentConfigurationError(
        "Live Stripe keys are blocked: Luxora runs payments in Stripe test mode until the business model is approved. Use an sk_test_/rk_test_ key.",
      );
    }
  } else if (!TEST_KEY.test(secretKey)) {
    throw new PaymentConfigurationError(
      "STRIPE_SECRET_KEY must be a Stripe test-mode secret or restricted key (sk_test_… or rk_test_…).",
    );
  }
  if (!WEBHOOK_SECRET.test(webhookSecret)) {
    throw new PaymentConfigurationError("STRIPE_WEBHOOK_SECRET must be the endpoint's signing secret (whsec_…).");
  }
  return { secretKey, webhookSecret, mode: LIVE_KEY.test(secretKey) ? "live" : "test" };
}
