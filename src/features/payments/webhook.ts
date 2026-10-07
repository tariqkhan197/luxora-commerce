import type Stripe from "stripe";
import { handleStripeEvent, type EventDeps } from "./stripe-events";

/**
 * Webhook request pipeline: verify the signature over the raw body, refuse
 * live-mode events while live payments are not approved, de-duplicate by event
 * id, handle, and record the outcome. Returns the HTTP response to send.
 *
 * Status codes follow Stripe's retry semantics: 2xx = done (no retry),
 * 400 = never valid (no point retrying), 409/500 = retry later.
 */

export type WebhookBeginResult = "process" | "duplicate" | "busy";

export interface WebhookEventLog {
  begin(event: Stripe.Event): Promise<WebhookBeginResult>;
  finish(eventId: string, status: "processed" | "ignored" | "failed", error?: string): Promise<void>;
}

export interface WebhookRequest {
  rawBody: string;
  signature: string | null;
  /** Verifies the signature and timestamp; throws when invalid. */
  verify: (rawBody: string, signature: string) => Stripe.Event;
  liveModeAllowed: boolean;
  log: WebhookEventLog;
  deps: EventDeps;
}

export interface WebhookResponse {
  status: number;
  body: { received: boolean; detail: string };
}

const respond = (status: number, received: boolean, detail: string): WebhookResponse => ({
  status,
  body: { received, detail },
});

export async function processStripeWebhook(request: WebhookRequest): Promise<WebhookResponse> {
  if (!request.signature) return respond(400, false, "missing Stripe-Signature header");

  let event: Stripe.Event;
  try {
    event = request.verify(request.rawBody, request.signature);
  } catch {
    // Never echo verification details back to the caller.
    return respond(400, false, "invalid signature");
  }

  if (event.livemode && !request.liveModeAllowed) {
    return respond(400, false, "live-mode events are not accepted: payments run in test mode");
  }

  const begin = await request.log.begin(event);
  if (begin === "duplicate") return respond(200, true, "duplicate event");
  if (begin === "busy") return respond(409, false, "event is being processed");

  try {
    const result = await handleStripeEvent(event, request.deps);
    await request.log.finish(event.id, result.status);
    return respond(200, true, result.detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await request.log.finish(event.id, "failed", message);
    console.error(`[stripe-webhook] ${event.type} ${event.id} failed:`, message);
    return respond(500, false, "processing failed; Stripe will retry");
  }
}
