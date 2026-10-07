import "server-only";

import { ROUTES } from "@/config/routes";
import { getClientEnv } from "@/lib/env";
import { AppError, fromPostgrestError } from "@/lib/errors";
import { buildCheckoutSessionParams, type CheckoutOrder } from "@/lib/payments/checkout-session";
import { getStripe, getStripeConfig } from "@/lib/payments/stripe-client";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { asAddress } from "@/features/addresses/format";
import { applyCheckoutSession, type EventResult } from "./stripe-events";
import { createEventDeps } from "./server";

/**
 * Hosted checkout for an order (Stripe Checkout, TEST MODE).
 *
 * The signed-in customer's own Supabase client is used for everything the
 * customer is allowed to do (begin an attempt, read their order); the service
 * role is used only to record the session the platform created.
 */

export function successUrl(): string {
  return `${getClientEnv().NEXT_PUBLIC_SITE_URL}${ROUTES.checkoutSuccess}?session_id={CHECKOUT_SESSION_ID}`;
}

export function cancelUrl(orderId: string): string {
  return `${getClientEnv().NEXT_PUBLIC_SITE_URL}${ROUTES.account.order(orderId)}?payment=cancelled`;
}

async function stripeCustomerFor(profileId: string, email: string, name: string | null): Promise<string> {
  const admin = createAdminClient();
  const livemode = getStripeConfig().mode === "live";
  const { data: existing, error } = await admin
    .from("payment_customers")
    .select("provider_customer_id")
    .eq("profile_id", profileId)
    .eq("provider", "stripe")
    .eq("livemode", livemode)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (existing) return existing.provider_customer_id;

  const customer = await getStripe().customers.create(
    { email, name: name ?? undefined, metadata: { profile_id: profileId } },
    { idempotencyKey: `luxora-customer:${profileId}:${livemode ? "live" : "test"}` },
  );
  const { error: insertError } = await admin
    .from("payment_customers")
    .upsert(
      { profile_id: profileId, provider: "stripe", provider_customer_id: customer.id, livemode },
      { onConflict: "profile_id,provider,livemode", ignoreDuplicates: true },
    );
  if (insertError) throw fromPostgrestError(insertError);
  return customer.id;
}

async function loadCheckoutOrder(orderId: string): Promise<CheckoutOrder & { customerId: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, currency, subtotal_minor, shipping_minor, tax_minor, total_minor, customer_email, customer_id, shipping_address, order_items!order_items_order_id_fkey(product_name, variant_title, sku, quantity, unit_price_minor, total_minor, image_path, tax_code, created_at)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data) throw AppError.notFound("Order not found.");
  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const items = [...data.order_items].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.sku.localeCompare(b.sku),
  );
  return {
    id: data.id,
    orderNumber: data.order_number,
    currency: data.currency,
    subtotalMinor: data.subtotal_minor,
    shippingMinor: data.shipping_minor,
    taxMinor: data.tax_minor,
    totalMinor: data.total_minor,
    customerEmail: data.customer_email,
    customerId: data.customer_id,
    shippingAddress: asAddress(data.shipping_address),
    items: items.map((item) => {
      const imageUrl = storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.productImages, item.image_path);
      return {
        productName: item.product_name,
        variantTitle: item.variant_title,
        sku: item.sku,
        quantity: item.quantity,
        unitPriceMinor: item.unit_price_minor,
        totalMinor: item.total_minor,
        // Stripe fetches product images itself: only publicly reachable https URLs are useful.
        imageUrl: imageUrl?.startsWith("https://") ? imageUrl : null,
        taxCode: item.tax_code,
      };
    }),
  };
}

/**
 * Returns the hosted checkout URL for an order awaiting payment: the open
 * session when there is one, otherwise a new session recorded against the
 * order. Raises user-safe errors when the order can no longer be paid.
 */
export async function startCheckout(orderId: string): Promise<string> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("begin_payment_attempt", { p_order_id: orderId });
  if (error) throw fromPostgrestError(error);
  const attempt = rows?.[0];
  if (!attempt) throw AppError.notFound("Order not found.");
  if (attempt.action === "reuse" && attempt.checkout_url) return attempt.checkout_url;

  const order = await loadCheckoutOrder(orderId);
  const stripe = getStripe();
  const customerId = await stripeCustomerFor(
    order.customerId,
    order.customerEmail,
    order.shippingAddress.full_name ?? null,
  );
  const expiresAt = new Date(attempt.session_expires_at);
  const params = buildCheckoutSessionParams(order, {
    attemptNo: attempt.attempt_no,
    expiresAt,
    successUrl: successUrl(),
    cancelUrl: cancelUrl(orderId),
    customerId,
  });
  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: `luxora-checkout:${orderId}:${attempt.attempt_no}:${Math.floor(expiresAt.getTime() / 1000)}`,
  });
  if (!session.url) throw new Error(`Stripe returned no URL for checkout session ${session.id}`);

  const { error: recordError } = await createAdminClient().rpc("record_checkout_session", {
    p_order_id: orderId,
    p_attempt_no: attempt.attempt_no,
    p_provider: "stripe",
    p_session_id: session.id,
    p_checkout_url: session.url,
    p_expires_at: new Date(session.expires_at * 1000).toISOString(),
    p_amount_minor: session.amount_total ?? -1,
    p_currency: (session.currency ?? "").toUpperCase(),
    p_livemode: session.livemode,
  });
  if (recordError) {
    // Never leave a payable session that the database does not know about.
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    throw fromPostgrestError(recordError);
  }
  return session.url;
}

/**
 * Closes the order's open hosted-checkout sessions with Stripe (so they can no
 * longer take money) before the customer or an admin cancels the order.
 * Refuses when a session already completed: the order is paid or being paid.
 */
export async function closeOpenCheckoutSessions(orderId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: attempts, error } = await admin
    .from("payment_attempts")
    .select("provider_session_id")
    .eq("order_id", orderId)
    .eq("status", "open");
  if (error) throw fromPostgrestError(error);
  const stripe = getStripe();
  for (const { provider_session_id: sessionId } of attempts ?? []) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") {
      await applyCheckoutSession(session, createEventDeps());
      throw AppError.validation({ _form: ["This order has just been paid, so it can no longer be cancelled here."] });
    }
    if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
    const { error: closeError } = await admin.rpc("close_payment_attempt", { p_session_id: sessionId });
    if (closeError) throw fromPostgrestError(closeError);
  }
}

/**
 * Success-page reconciliation: re-reads a session from Stripe and applies it
 * through the same idempotent path as the webhook, so the customer sees the
 * paid order even if the webhook is delayed. Only for the session's own customer.
 */
export async function reconcileCheckoutSession(
  sessionId: string,
): Promise<{ orderId: string; result: EventResult | null } | null> {
  const admin = createAdminClient();
  const { data: attempt, error } = await admin
    .from("payment_attempts")
    .select("order_id")
    .eq("provider_session_id", sessionId)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!attempt) return null;
  // The customer must be able to read the order (RLS) — otherwise it is not theirs.
  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("id").eq("id", attempt.order_id).maybeSingle();
  if (!order) return null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    return { orderId: order.id, result: await applyCheckoutSession(session, createEventDeps()) };
  } catch (error) {
    // The webhook remains the source of truth; the order page keeps refreshing.
    console.error("[payments] success-page reconciliation failed:", error instanceof Error ? error.message : error);
    return { orderId: order.id, result: null };
  }
}
