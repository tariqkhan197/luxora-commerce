import type Stripe from "stripe";

/**
 * Stripe webhook event handling (Phase 4b, test mode).
 *
 * Pure orchestration over two injected ports so it can be unit-tested without
 * Stripe or a database:
 *   - `PaymentStore`: the database payment functions (service role)
 *   - `PaymentGateway`: the few Stripe API calls a webhook needs
 * The database functions are idempotent and state-checked, so re-delivered or
 * out-of-order events are safe; this module only maps events to them.
 */

export type ConfirmOutcome = "confirmed" | "duplicate" | "refund_required";

export interface PaymentStore {
  confirmPayment(input: {
    orderId: string;
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
    feeMinor: number | null;
    sessionId: string;
    livemode: boolean;
    rawPayload: unknown;
  }): Promise<{ paymentId: string; outcome: ConfirmOutcome }>;
  markProcessing(sessionId: string, paymentIntentId: string | null, livemode: boolean): Promise<string>;
  failAttempt(sessionId: string, reason: string): Promise<string>;
  expireAttempt(sessionId: string): Promise<string>;
  recordFee(paymentIntentId: string, feeMinor: number): Promise<string>;
  recordLateRefund(paymentId: string, providerRefundId: string): Promise<string>;
  openSessionIds(orderId: string): Promise<string[]>;
  closeAttempt(sessionId: string): Promise<void>;
  applyRefund(input: {
    providerRefundId: string;
    refundId: string | null;
    paymentIntentId: string | null;
    status: string;
    amountMinor: number;
    currency: string;
    failureReason: string | null;
  }): Promise<string>;
  recordDispute(input: {
    providerDisputeId: string;
    paymentIntentId: string;
    status: string;
    reason: string | null;
    amountMinor: number;
    currency: string;
    feeMinor: number;
  }): Promise<string>;
}

export interface PaymentGateway {
  /** Processing fee of the payment's charge, or null when Stripe has not settled it yet. */
  paymentFee(paymentIntentId: string): Promise<number | null>;
  /** Fee of a balance transaction (charge.updated carries only its id). */
  balanceTransactionFee(balanceTransactionId: string): Promise<number>;
  refundPayment(input: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string }>;
  expireSession(sessionId: string): Promise<void>;
}

export interface EventDeps {
  store: PaymentStore;
  gateway: PaymentGateway;
}

export type EventResult = { status: "processed" | "ignored"; detail: string };

/** Events the webhook endpoint subscribes to (see docs/PAYMENTS.md). */
export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.updated",
  "payment_intent.payment_failed",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function applyRefund(refund: Stripe.Refund, deps: EventDeps): Promise<EventResult> {
  const refundId = refund.metadata?.refund_id;
  const result = await deps.store.applyRefund({
    providerRefundId: refund.id,
    refundId: refundId && UUID.test(refundId) ? refundId : null,
    paymentIntentId: intentId(refund.payment_intent),
    status: refund.status ?? "pending",
    amountMinor: refund.amount,
    currency: refund.currency.toUpperCase(),
    failureReason: refund.failure_reason ?? null,
  });
  return {
    status: ["ignored", "unknown_payment"].includes(result) ? "ignored" : "processed",
    detail: `refund ${result}`,
  };
}

async function recordDispute(dispute: Stripe.Dispute, deps: EventDeps): Promise<EventResult> {
  const paymentIntentId = intentId(dispute.payment_intent);
  if (!paymentIntentId) return { status: "ignored", detail: "dispute without payment intent" };
  const feeMinor = (dispute.balance_transactions ?? []).reduce((sum, transaction) => sum + (transaction.fee ?? 0), 0);
  const result = await deps.store.recordDispute({
    providerDisputeId: dispute.id,
    paymentIntentId,
    status: dispute.status,
    reason: dispute.reason ?? null,
    amountMinor: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    feeMinor,
  });
  return { status: result === "unknown_payment" ? "ignored" : "processed", detail: `dispute ${result}` };
}

function intentId(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function orderIdOf(session: Stripe.Checkout.Session): string | null {
  return session.client_reference_id ?? session.metadata?.order_id ?? null;
}

async function confirmPaidSession(session: Stripe.Checkout.Session, deps: EventDeps): Promise<EventResult> {
  const orderId = orderIdOf(session);
  if (!orderId) {
    // Not created by Luxora (e.g. a Stripe CLI fixture): nothing to fulfil.
    return { status: "ignored", detail: "session has no Luxora order reference" };
  }
  const paymentIntentId = intentId(session.payment_intent);
  if (!paymentIntentId || session.amount_total === null || !session.currency) {
    throw new Error(`checkout session ${session.id} is missing its payment or amount`);
  }

  let feeMinor: number | null = null;
  try {
    feeMinor = await deps.gateway.paymentFee(paymentIntentId);
  } catch {
    feeMinor = null; // recorded later from charge.updated
  }

  const { paymentId, outcome } = await deps.store.confirmPayment({
    orderId,
    paymentIntentId,
    amountMinor: session.amount_total,
    currency: session.currency.toUpperCase(),
    feeMinor,
    sessionId: session.id,
    livemode: session.livemode,
    rawPayload: session,
  });

  if (outcome === "refund_required") {
    // Money arrived for an order that was already closed: give it back in full.
    const refund = await deps.gateway.refundPayment({
      paymentIntentId,
      amountMinor: session.amount_total,
      idempotencyKey: `late-payment-refund:${paymentId}`,
      metadata: { order_id: orderId, payment_id: paymentId, reason: "late_payment" },
    });
    await deps.store.recordLateRefund(paymentId, refund.id);
    return { status: "processed", detail: `late payment refunded (${refund.id})` };
  }

  if (outcome === "confirmed") {
    // Close any other session that could still take a second payment.
    for (const otherSession of await deps.store.openSessionIds(orderId)) {
      if (otherSession === session.id) continue;
      try {
        await deps.gateway.expireSession(otherSession);
      } catch {
        // Already expired or completed at Stripe: a second payment is still caught as refund_required.
      }
      await deps.store.closeAttempt(otherSession);
    }
  }
  return { status: "processed", detail: `payment ${outcome}` };
}

/**
 * Applies the current state of a checkout session. Used for
 * `checkout.session.completed` and by the success page, which re-reads the
 * session from Stripe (server-side, with the secret key) when the webhook has
 * not arrived yet. Both paths end in the same idempotent database functions.
 */
export async function applyCheckoutSession(session: Stripe.Checkout.Session, deps: EventDeps): Promise<EventResult> {
  if (session.mode !== "payment") return { status: "ignored", detail: `mode ${session.mode}` };
  if (session.status === "expired") {
    const result = await deps.store.expireAttempt(session.id);
    return { status: "processed", detail: result };
  }
  if (session.status !== "complete") return { status: "ignored", detail: `session ${session.status}` };
  if (session.payment_status === "paid") return confirmPaidSession(session, deps);
  if (session.payment_status === "unpaid") {
    const result = await deps.store.markProcessing(session.id, intentId(session.payment_intent), session.livemode);
    return { status: "processed", detail: `payment ${result}` };
  }
  return { status: "ignored", detail: `payment_status ${session.payment_status}` };
}

export async function handleStripeEvent(event: Stripe.Event, deps: EventDeps): Promise<EventResult> {
  switch (event.type) {
    case "checkout.session.completed":
      return applyCheckoutSession(event.data.object, deps);
    case "checkout.session.async_payment_succeeded":
      return confirmPaidSession(event.data.object, deps);
    case "checkout.session.async_payment_failed": {
      const result = await deps.store.failAttempt(event.data.object.id, "payment_failed");
      return { status: "processed", detail: result };
    }
    case "checkout.session.expired": {
      const result = await deps.store.expireAttempt(event.data.object.id);
      return { status: "processed", detail: result };
    }
    case "charge.updated": {
      // The processing fee becomes known once Stripe settles the charge.
      const charge = event.data.object;
      const paymentIntentId = intentId(charge.payment_intent);
      const balanceTransaction = charge.balance_transaction;
      if (!paymentIntentId || !balanceTransaction) return { status: "ignored", detail: "no balance transaction yet" };
      const fee =
        typeof balanceTransaction === "string"
          ? await deps.gateway.balanceTransactionFee(balanceTransaction)
          : balanceTransaction.fee;
      const result = await deps.store.recordFee(paymentIntentId, fee);
      return { status: result === "unknown_payment" ? "ignored" : "processed", detail: `fee ${result}` };
    }
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return applyRefund(event.data.object, deps);
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      return recordDispute(event.data.object, deps);
    case "payment_intent.payment_failed":
      // A declined attempt: the checkout session stays open so the customer can retry.
      return { status: "ignored", detail: "declined attempt; session remains open" };
    default:
      return { status: "ignored", detail: `unhandled event ${event.type}` };
  }
}
