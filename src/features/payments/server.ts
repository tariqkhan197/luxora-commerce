import "server-only";

import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { getStripe } from "@/lib/payments/stripe-client";
import type { ConfirmOutcome, EventDeps, PaymentGateway, PaymentStore } from "./stripe-events";
import type { WebhookEventLog } from "./webhook";

/**
 * Server-side adapters for the payment ports: the database functions (called
 * with the service role, which is the only role allowed to run them) and the
 * Stripe API. Never import this module from client code.
 */

type AdminClient = ReturnType<typeof createAdminClient>;

/** Generated RPC types mark every argument non-null; these functions accept SQL null. */
function sqlNull<T>(value: T | null): T {
  return value as T;
}

function check<T>(result: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    throw new Error(`${what} failed: ${result.error.code ?? ""} ${result.error.message}`.trim());
  }
  return result.data as T;
}

export function createPaymentStore(db: AdminClient = createAdminClient()): PaymentStore {
  return {
    async confirmPayment(input) {
      const rows = check(
        await db.rpc("confirm_order_payment", {
          p_order_id: input.orderId,
          p_provider: "stripe",
          p_provider_payment_id: input.paymentIntentId,
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_fee_minor: input.feeMinor ?? undefined,
          p_tax_minor: 0,
          p_session_id: input.sessionId,
          p_livemode: input.livemode,
          p_raw_payload: input.rawPayload as Json,
        }),
        "confirm_order_payment",
      );
      const row = rows[0];
      if (!row) throw new Error("confirm_order_payment returned no row");
      return { paymentId: row.payment_id, outcome: row.outcome as ConfirmOutcome };
    },
    async markProcessing(sessionId, paymentIntentId, livemode) {
      return check(
        await db.rpc("mark_payment_processing", {
          p_session_id: sessionId,
          p_payment_intent_id: sqlNull(paymentIntentId),
          p_livemode: livemode,
        }),
        "mark_payment_processing",
      );
    },
    async failAttempt(sessionId, reason) {
      return check(
        await db.rpc("fail_payment_attempt", { p_session_id: sessionId, p_reason: reason }),
        "fail_payment_attempt",
      );
    },
    async expireAttempt(sessionId) {
      return check(await db.rpc("expire_payment_attempt", { p_session_id: sessionId }), "expire_payment_attempt");
    },
    async recordFee(paymentIntentId, feeMinor) {
      return check(
        await db.rpc("record_payment_fee", {
          p_provider: "stripe",
          p_provider_payment_id: paymentIntentId,
          p_fee_minor: feeMinor,
        }),
        "record_payment_fee",
      );
    },
    async recordLateRefund(paymentId, providerRefundId) {
      return check(
        await db.rpc("record_late_payment_refund", { p_payment_id: paymentId, p_provider_refund_id: providerRefundId }),
        "record_late_payment_refund",
      );
    },
    async openSessionIds(orderId) {
      const rows = check(
        await db.from("payment_attempts").select("provider_session_id").eq("order_id", orderId).eq("status", "open"),
        "payment_attempts lookup",
      );
      return rows.map((row) => row.provider_session_id);
    },
    async closeAttempt(sessionId) {
      check(await db.rpc("close_payment_attempt", { p_session_id: sessionId }), "close_payment_attempt");
    },
    async applyRefund(input) {
      return check(
        await db.rpc("apply_provider_refund", {
          p_provider_refund_id: input.providerRefundId,
          p_refund_id: sqlNull(input.refundId),
          p_provider_payment_id: sqlNull(input.paymentIntentId),
          p_status: input.status,
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_failure_reason: input.failureReason ?? undefined,
        }),
        "apply_provider_refund",
      );
    },
    async recordDispute(input) {
      return check(
        await db.rpc("record_dispute", {
          p_provider_dispute_id: input.providerDisputeId,
          p_provider_payment_id: input.paymentIntentId,
          p_status: input.status,
          p_reason: sqlNull(input.reason),
          p_amount_minor: input.amountMinor,
          p_currency: input.currency,
          p_fee_minor: input.feeMinor,
        }),
        "record_dispute",
      );
    },
  };
}

export function createPaymentGateway(stripe: Stripe = getStripe()): PaymentGateway {
  return {
    async paymentFee(paymentIntentId) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge.balance_transaction"],
      });
      const charge = intent.latest_charge;
      if (!charge || typeof charge === "string") return null;
      const balance = charge.balance_transaction;
      if (!balance || typeof balance === "string") return null;
      return balance.fee;
    },
    async balanceTransactionFee(balanceTransactionId) {
      const balance = await stripe.balanceTransactions.retrieve(balanceTransactionId);
      return balance.fee;
    },
    async refundPayment({ paymentIntentId, amountMinor, idempotencyKey, metadata }) {
      const refund = await stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: amountMinor, metadata },
        { idempotencyKey },
      );
      return { id: refund.id };
    },
    async expireSession(sessionId) {
      await stripe.checkout.sessions.expire(sessionId);
    },
  };
}

export function createWebhookEventLog(db: AdminClient = createAdminClient()): WebhookEventLog {
  return {
    async begin(event) {
      return check(
        await db.rpc("begin_webhook_event", {
          p_event_id: event.id,
          p_provider: "stripe",
          p_type: event.type,
          p_livemode: event.livemode,
          p_api_version: sqlNull(event.api_version),
          p_payload: event as unknown as Json,
        }),
        "begin_webhook_event",
      ) as "process" | "duplicate" | "busy";
    },
    async finish(eventId, status, error) {
      check(
        await db.rpc("finish_webhook_event", {
          p_event_id: eventId,
          p_status: status,
          p_error: error,
        }),
        "finish_webhook_event",
      );
    },
  };
}

export function createEventDeps(): EventDeps {
  return { store: createPaymentStore(), gateway: createPaymentGateway() };
}
