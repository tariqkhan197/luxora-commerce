import { NextResponse, type NextRequest } from "next/server";
import { LIVE_PAYMENTS_APPROVED } from "@/config/payments";
import { createEventDeps, createWebhookEventLog } from "@/features/payments/server";
import { processStripeWebhook } from "@/features/payments/webhook";
import { getPaymentProvider } from "@/lib/payments/provider";
import { getStripe, getStripeConfig } from "@/lib/payments/stripe-client";

/**
 * Stripe webhook endpoint (TEST MODE).
 *
 * The raw body is read as text and verified against the endpoint's signing
 * secret before anything else happens; unsigned or tampered requests get 400.
 * Each event is recorded once (payment_webhook_events) and handled by the
 * idempotent database payment functions. Excluded from the proxy (no session).
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!getPaymentProvider()) {
    return NextResponse.json({ received: false, detail: "payments are not enabled" }, { status: 503 });
  }
  const stripe = getStripe();
  const { webhookSecret } = getStripeConfig();
  const rawBody = await request.text();

  const result = await processStripeWebhook({
    rawBody,
    signature: request.headers.get("stripe-signature"),
    verify: (body, signature) => stripe.webhooks.constructEvent(body, signature, webhookSecret),
    liveModeAllowed: LIVE_PAYMENTS_APPROVED,
    log: createWebhookEventLog(),
    deps: createEventDeps(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
