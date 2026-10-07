import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  handleStripeEvent,
  type EventDeps,
  type PaymentGateway,
  type PaymentStore,
} from "@/features/payments/stripe-events";
import { processStripeWebhook, type WebhookEventLog } from "@/features/payments/webhook";

const SECRET = "whsec_test_secret_for_unit_tests_0123456789";
const stripe = new Stripe("sk_test_unit_tests_only_0000000000");
const ORDER = "00000000-0000-4000-8000-0000000000aa";

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    client_reference_id: ORDER,
    metadata: { order_id: ORDER },
    amount_total: 36_189,
    currency: "usd",
    payment_intent: "pi_test_1",
    livemode: false,
    ...overrides,
  };
}

function event(type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_test_${type.replaceAll(".", "_")}`,
    object: "event",
    type,
    livemode: false,
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    data: { object },
    ...overrides,
  } as unknown as Stripe.Event;
}

function fakes(
  overrides: {
    outcome?: "confirmed" | "duplicate" | "refund_required";
    fee?: number | null;
    openSessions?: string[];
  } = {},
) {
  const store = {
    confirmPayment: vi.fn(async () => ({ paymentId: "pay_1", outcome: overrides.outcome ?? "confirmed" })),
    markProcessing: vi.fn(async () => "processing"),
    failAttempt: vi.fn(async () => "order_failed"),
    expireAttempt: vi.fn(async () => "order_expired"),
    recordFee: vi.fn(async () => "recorded"),
    recordLateRefund: vi.fn(async () => "recorded"),
    openSessionIds: vi.fn(async () => overrides.openSessions ?? []),
    closeAttempt: vi.fn(async () => undefined),
    applyRefund: vi.fn(async () => "completed"),
    recordDispute: vi.fn(async () => "recorded"),
  } satisfies PaymentStore;
  const gateway = {
    paymentFee: vi.fn(async () => (overrides.fee === undefined ? 1_080 : overrides.fee)),
    balanceTransactionFee: vi.fn(async () => 1_080),
    refundPayment: vi.fn(async () => ({ id: "re_test_1" })),
    expireSession: vi.fn(async () => undefined),
  } satisfies PaymentGateway;
  const deps: EventDeps = { store, gateway };
  return { store, gateway, deps };
}

describe("handleStripeEvent", () => {
  it("confirms a paid checkout with the database amount check inputs", async () => {
    const { store, deps } = fakes();
    const result = await handleStripeEvent(event("checkout.session.completed", session()), deps);
    expect(result).toEqual({ status: "processed", detail: "payment confirmed" });
    expect(store.confirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER,
        paymentIntentId: "pi_test_1",
        amountMinor: 36_189,
        currency: "USD",
        feeMinor: 1_080,
        sessionId: "cs_test_1",
        livemode: false,
      }),
    );
  });

  it("records the payment without a fee when Stripe has not settled it", async () => {
    const { store, gateway, deps } = fakes({ fee: null });
    gateway.paymentFee.mockRejectedValueOnce(new Error("network"));
    await handleStripeEvent(event("checkout.session.completed", session()), deps);
    expect(store.confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ feeMinor: null }));
  });

  it("refunds a payment that arrived for a closed order, idempotently", async () => {
    const { store, gateway, deps } = fakes({ outcome: "refund_required" });
    const result = await handleStripeEvent(event("checkout.session.completed", session()), deps);
    expect(gateway.refundPayment).toHaveBeenCalledWith({
      paymentIntentId: "pi_test_1",
      amountMinor: 36_189,
      idempotencyKey: "late-payment-refund:pay_1",
      metadata: { order_id: ORDER, payment_id: "pay_1", reason: "late_payment" },
    });
    expect(store.recordLateRefund).toHaveBeenCalledWith("pay_1", "re_test_1");
    expect(result.detail).toContain("late payment refunded");
  });

  it("closes the order's other open sessions after a confirmed payment", async () => {
    const { store, gateway, deps } = fakes({ openSessions: ["cs_test_1", "cs_test_2"] });
    gateway.expireSession.mockRejectedValueOnce(new Error("already expired"));
    await handleStripeEvent(event("checkout.session.completed", session()), deps);
    expect(gateway.expireSession).toHaveBeenCalledTimes(1);
    expect(gateway.expireSession).toHaveBeenCalledWith("cs_test_2");
    expect(store.closeAttempt).toHaveBeenCalledWith("cs_test_2");
  });

  it("does nothing more for a duplicate confirmation", async () => {
    const { store, gateway, deps } = fakes({ outcome: "duplicate" });
    await handleStripeEvent(event("checkout.session.completed", session()), deps);
    expect(gateway.refundPayment).not.toHaveBeenCalled();
    expect(store.openSessionIds).not.toHaveBeenCalled();
  });

  it("maps the other checkout events to their database functions", async () => {
    const { store, deps } = fakes();
    await handleStripeEvent(event("checkout.session.completed", session({ payment_status: "unpaid" })), deps);
    expect(store.markProcessing).toHaveBeenCalledWith("cs_test_1", "pi_test_1", false);
    await handleStripeEvent(event("checkout.session.async_payment_succeeded", session()), deps);
    expect(store.confirmPayment).toHaveBeenCalledTimes(1);
    await handleStripeEvent(
      event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })),
      deps,
    );
    expect(store.failAttempt).toHaveBeenCalledWith("cs_test_1", "payment_failed");
    await handleStripeEvent(
      event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid" })),
      deps,
    );
    expect(store.expireAttempt).toHaveBeenCalledWith("cs_test_1");
  });

  it("records the processing fee from charge.updated", async () => {
    const { store, gateway, deps } = fakes();
    const charge = { id: "ch_1", object: "charge", payment_intent: "pi_test_1", balance_transaction: "txn_1" };
    const result = await handleStripeEvent(event("charge.updated", charge), deps);
    expect(gateway.balanceTransactionFee).toHaveBeenCalledWith("txn_1");
    expect(store.recordFee).toHaveBeenCalledWith("pi_test_1", 1_080);
    expect(result.status).toBe("processed");
    const pending = await handleStripeEvent(event("charge.updated", { ...charge, balance_transaction: null }), deps);
    expect(pending.status).toBe("ignored");
  });

  it("applies refund events with the Luxora refund id from metadata", async () => {
    const { store, deps } = fakes();
    const refund = {
      id: "re_test_1",
      object: "refund",
      amount: 10_000,
      currency: "usd",
      status: "succeeded",
      payment_intent: "pi_test_1",
      metadata: { refund_id: "00000000-0000-4000-8000-0000000000bb" },
      failure_reason: null,
    };
    const result = await handleStripeEvent(event("refund.updated", refund), deps);
    expect(store.applyRefund).toHaveBeenCalledWith({
      providerRefundId: "re_test_1",
      refundId: "00000000-0000-4000-8000-0000000000bb",
      paymentIntentId: "pi_test_1",
      status: "succeeded",
      amountMinor: 10_000,
      currency: "USD",
      failureReason: null,
    });
    expect(result).toEqual({ status: "processed", detail: "refund completed" });
    // A dashboard refund (no or malformed metadata) is passed without a Luxora id.
    await handleStripeEvent(
      event("refund.created", { ...refund, id: "re_test_2", metadata: { refund_id: "x" } }),
      deps,
    );
    expect(store.applyRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerRefundId: "re_test_2", refundId: null }),
    );
  });

  it("records disputes with their fees", async () => {
    const { store, deps } = fakes();
    const dispute = {
      id: "dp_test_1",
      object: "dispute",
      amount: 36_189,
      currency: "usd",
      status: "needs_response",
      reason: "fraudulent",
      payment_intent: "pi_test_1",
      balance_transactions: [{ fee: 1_500 }, { fee: 0 }],
    };
    await handleStripeEvent(event("charge.dispute.created", dispute), deps);
    expect(store.recordDispute).toHaveBeenCalledWith({
      providerDisputeId: "dp_test_1",
      paymentIntentId: "pi_test_1",
      status: "needs_response",
      reason: "fraudulent",
      amountMinor: 36_189,
      currency: "USD",
      feeMinor: 1_500,
    });
  });

  it("ignores sessions Luxora did not create, declines and unrelated events", async () => {
    const { store, deps } = fakes();
    const foreign = await handleStripeEvent(
      event("checkout.session.completed", session({ client_reference_id: null, metadata: {} })),
      deps,
    );
    expect(foreign.status).toBe("ignored");
    expect((await handleStripeEvent(event("payment_intent.payment_failed", { id: "pi_1" }), deps)).status).toBe(
      "ignored",
    );
    expect((await handleStripeEvent(event("customer.created", { id: "cus_1" }), deps)).status).toBe("ignored");
    expect(store.confirmPayment).not.toHaveBeenCalled();
  });
});

describe("processStripeWebhook", () => {
  function signed(payload: string, timestamp?: number) {
    return stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, timestamp });
  }
  const verify = (body: string, signature: string) => stripe.webhooks.constructEvent(body, signature, SECRET);

  function log(begin: "process" | "duplicate" | "busy" = "process") {
    return {
      begin: vi.fn(async () => begin),
      finish: vi.fn(async () => undefined),
    } satisfies WebhookEventLog;
  }

  const completed = JSON.stringify(event("checkout.session.completed", session()));

  it("handles a correctly signed event once and records it as processed", async () => {
    const { deps, store } = fakes();
    const events = log();
    const response = await processStripeWebhook({
      rawBody: completed,
      signature: signed(completed),
      verify,
      liveModeAllowed: false,
      log: events,
      deps,
    });
    expect(response).toEqual({ status: 200, body: { received: true, detail: "payment confirmed" } });
    expect(events.finish).toHaveBeenCalledWith("evt_test_checkout_session_completed", "processed");
    expect(store.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it("rejects missing, invalid, tampered and stale signatures without touching anything", async () => {
    const { deps, store } = fakes();
    const events = log();
    const base = { verify, liveModeAllowed: false, log: events, deps };
    expect((await processStripeWebhook({ ...base, rawBody: completed, signature: null })).status).toBe(400);
    expect((await processStripeWebhook({ ...base, rawBody: completed, signature: "t=1,v1=deadbeef" })).status).toBe(
      400,
    );
    const tampered = completed.replace("36189", "1");
    expect((await processStripeWebhook({ ...base, rawBody: tampered, signature: signed(completed) })).status).toBe(400);
    const stale = signed(completed, Math.floor(Date.now() / 1000) - 3_600);
    expect((await processStripeWebhook({ ...base, rawBody: completed, signature: stale })).status).toBe(400);
    const otherSecret = stripe.webhooks.generateTestHeaderString({
      payload: completed,
      secret: "whsec_someone_else_123456",
    });
    expect((await processStripeWebhook({ ...base, rawBody: completed, signature: otherSecret })).status).toBe(400);
    expect(events.begin).not.toHaveBeenCalled();
    expect(store.confirmPayment).not.toHaveBeenCalled();
  });

  it("refuses live-mode events while live payments are not approved", async () => {
    const { deps, store } = fakes();
    const events = log();
    const live = JSON.stringify(event("checkout.session.completed", session({ livemode: true }), { livemode: true }));
    const response = await processStripeWebhook({
      rawBody: live,
      signature: signed(live),
      verify,
      liveModeAllowed: false,
      log: events,
      deps,
    });
    expect(response.status).toBe(400);
    expect(response.body.detail).toContain("test mode");
    expect(events.begin).not.toHaveBeenCalled();
    expect(store.confirmPayment).not.toHaveBeenCalled();
  });

  it("acknowledges duplicates without re-processing and asks Stripe to retry busy events", async () => {
    const { deps, store } = fakes();
    const duplicate = await processStripeWebhook({
      rawBody: completed,
      signature: signed(completed),
      verify,
      liveModeAllowed: false,
      log: log("duplicate"),
      deps,
    });
    expect(duplicate.status).toBe(200);
    const busy = await processStripeWebhook({
      rawBody: completed,
      signature: signed(completed),
      verify,
      liveModeAllowed: false,
      log: log("busy"),
      deps,
    });
    expect(busy.status).toBe(409);
    expect(store.confirmPayment).not.toHaveBeenCalled();
  });

  it("records failures and returns 500 so Stripe retries", async () => {
    const { deps, store } = fakes();
    store.confirmPayment.mockRejectedValueOnce(new Error("payment 1 USD does not match order total"));
    const events = log();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await processStripeWebhook({
      rawBody: completed,
      signature: signed(completed),
      verify,
      liveModeAllowed: false,
      log: events,
      deps,
    });
    errorSpy.mockRestore();
    expect(response.status).toBe(500);
    expect(events.finish).toHaveBeenCalledWith(
      "evt_test_checkout_session_completed",
      "failed",
      "payment 1 USD does not match order total",
    );
  });
});
