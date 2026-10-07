import { PaymentConfigurationError, readStripeConfig } from "./config";

export { PaymentConfigurationError } from "./config";

/**
 * Payment provider boundary.
 *
 * Luxora never marks an order as paid from application code. The flow is:
 *   1. place_order() creates a `pending` order and reserves stock.
 *   2. The provider adapter creates a hosted checkout session for that order
 *      (record_checkout_session() ties it to the order and extends the hold).
 *   3. The provider's verified webhook calls `public.confirm_order_payment()`
 *      with the service role. That function is the only path that records a
 *      payment and turns reserved stock into sold stock.
 *
 * `PAYMENT_PROVIDER` selects the adapter. Unset means "online payments are not
 * enabled": orders stay `pending` until their reservation expires (Phase 3
 * behaviour). Only Stripe is implemented, in TEST MODE (see src/config/payments.ts).
 */

export interface PaymentProviderInfo {
  /** Matches the `payment_provider` database enum. */
  readonly id: "stripe";
  readonly displayName: string;
  readonly mode: "test" | "live";
}

/**
 * Resolves the configured provider. Naming a provider without an adapter, or
 * configuring Stripe with live or malformed keys, is a configuration error
 * rather than a silent fallback.
 */
export function getPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProviderInfo | null {
  const configured = env.PAYMENT_PROVIDER?.trim();
  if (!configured) return null;
  if (configured !== "stripe") {
    throw new PaymentConfigurationError(
      `PAYMENT_PROVIDER is set to "${configured}", but only "stripe" has a payment adapter.`,
    );
  }
  const config = readStripeConfig(env);
  return { id: "stripe", displayName: config.mode === "test" ? "Stripe (test mode)" : "Stripe", mode: config.mode };
}

export function paymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getPaymentProvider(env) !== null;
}
