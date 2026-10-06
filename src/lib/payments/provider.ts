/**
 * Payment provider boundary.
 *
 * Luxora never marks an order as paid from application code. The flow is:
 *   1. place_order() creates a `pending` order and reserves stock.
 *   2. A provider adapter (below) creates a hosted payment session.
 *   3. The provider's verified webhook calls `public.confirm_order_payment()`
 *      with the service role. That function is the only path that records a
 *      payment and turns reserved stock into sold stock.
 *
 * No provider adapter ships in Phase 3, so `getPaymentProvider()` returns null
 * and orders stay `pending` until their reservation expires.
 */

export interface PaymentSessionRequest {
  orderId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentSession {
  /** Hosted payment page the customer is redirected to. */
  redirectUrl: string;
  /** Provider reference stored for webhook reconciliation. */
  providerReference: string;
}

export interface PaymentProvider {
  /** Matches the `payment_provider` database enum. */
  readonly id: "stripe" | "paypal";
  readonly displayName: string;
  createPaymentSession(request: PaymentSessionRequest): Promise<PaymentSession>;
}

export class PaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConfigurationError";
  }
}

/**
 * Resolves the configured provider from `PAYMENT_PROVIDER`. Unset means
 * "online payments are not enabled". Naming a provider that has no adapter is
 * a configuration error rather than a silent fallback.
 */
export function getPaymentProvider(env: Record<string, string | undefined> = process.env): PaymentProvider | null {
  const configured = env.PAYMENT_PROVIDER?.trim();
  if (!configured) return null;
  throw new PaymentConfigurationError(
    `PAYMENT_PROVIDER is set to "${configured}", but no payment provider adapter is implemented yet.`,
  );
}

export function paymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getPaymentProvider(env) !== null;
}
