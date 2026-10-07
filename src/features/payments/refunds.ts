import "server-only";

import { AppError, fromPostgrestError } from "@/lib/errors";
import { getStripe } from "@/lib/payments/stripe-client";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { shippingChoiceToFlag, type RefundRequestValues } from "@/lib/validation";

/**
 * Admin-initiated refund of (part of) one vendor order.
 *   1. request_refund() — as the signed-in admin: validates quantities, applies
 *      the shipping and liability policies, reserves the amount (processing).
 *   2. Stripe refund, keyed by the Luxora refund id (idempotent).
 *   3. mark_refund_submitted() — completes immediately when Stripe settles it,
 *      otherwise the refund.* webhook completes or fails it later.
 * If Stripe rejects the call, the refund is marked failed so the amount is
 * refundable again.
 */
export async function issueRefund(values: RefundRequestValues): Promise<{ refundId: string; status: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_refund", {
    p_vendor_order_id: values.vendorOrderId,
    p_items: values.items.map((item) => ({ order_item_id: item.orderItemId, quantity: item.quantity })),
    p_kind: values.kind,
    p_reason: values.reason,
    p_include_shipping: shippingChoiceToFlag(values.shipping) ?? undefined,
  });
  if (error) throw fromPostgrestError(error);
  const request = data?.[0];
  if (!request) throw AppError.notFound("Vendor order not found.");

  return submitRefundToProvider(request, { vendor_order_id: values.vendorOrderId });
}

interface RequestedRefund {
  refund_id: string;
  amount_minor: number;
  provider_payment_id: string;
  order_id: string;
}

/** Steps 2–3 above for a refund the database has already accepted. */
async function submitRefundToProvider(
  request: RequestedRefund,
  metadata: Record<string, string>,
): Promise<{ refundId: string; status: string }> {
  const admin = createAdminClient();
  let providerRefund: { id: string; status: string | null };
  try {
    const refund = await getStripe().refunds.create(
      {
        payment_intent: request.provider_payment_id,
        amount: request.amount_minor,
        metadata: { refund_id: request.refund_id, order_id: request.order_id, ...metadata },
      },
      { idempotencyKey: `luxora-refund:${request.refund_id}` },
    );
    providerRefund = { id: refund.id, status: refund.status };
  } catch (stripeError) {
    const message = stripeError instanceof Error ? stripeError.message : "Stripe refused the refund.";
    await admin.rpc("fail_refund", { p_refund_id: request.refund_id, p_message: message });
    throw AppError.validation({ _form: [`The payment provider did not accept the refund: ${message}`] });
  }

  const { data: status, error: submitError } = await admin.rpc("mark_refund_submitted", {
    p_refund_id: request.refund_id,
    p_provider_refund_id: providerRefund.id,
    p_provider_status: providerRefund.status ?? "pending",
  });
  if (submitError) throw fromPostgrestError(submitError);
  return { refundId: request.refund_id, status: status ?? "submitted" };
}

/**
 * Refunds a received return (admin). request_return_refund() builds the refund
 * from the returned items with the "return" shipping policy, links it to the
 * return and marks the return completed; a provider failure reopens it.
 */
export async function issueReturnRefund(
  returnId: string,
  shipping: RefundRequestValues["shipping"],
): Promise<{ refundId: string; status: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_return_refund", {
    p_return_id: returnId,
    p_include_shipping: shippingChoiceToFlag(shipping) ?? undefined,
  });
  if (error) throw fromPostgrestError(error);
  const request = data?.[0];
  if (!request) throw AppError.notFound("Return not found.");
  return submitRefundToProvider(request, { return_request_id: returnId });
}
