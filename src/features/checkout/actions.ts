"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { closeOpenCheckoutSessions, startCheckout } from "@/features/payments/checkout";
import { assertUser } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { paymentsOn } from "@/lib/payments/status";
import { createClient } from "@/lib/supabase/server";
import { placeOrderSchema, uuidSchema } from "@/lib/validation";

function revalidateOrder(orderId: string) {
  revalidatePath(ROUTES.account.orders);
  revalidatePath(ROUTES.account.order(orderId));
  revalidatePath(ROUTES.admin.orders);
  revalidatePath(ROUTES.admin.order(orderId));
}

/**
 * Places the order for the caller's cart. The browser supplies address ids, an
 * idempotency token and the total it displayed; `place_order()` recomputes
 * everything from the catalog, reserves stock and rejects any drift. With
 * payments enabled (Stripe test mode) the customer then goes straight to
 * hosted checkout; if that cannot start, the order page offers "Pay now".
 */
export async function placeOrder(input: unknown): Promise<ActionResult<void>> {
  let orderId: string | null = null;
  const result = await runAction(async () => {
    const values = placeOrderSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("place_order", {
      p_shipping_address_id: values.shippingAddressId,
      p_billing_address_id: values.billingSameAsShipping
        ? values.shippingAddressId
        : (values.billingAddressId ?? values.shippingAddressId),
      p_checkout_token: values.checkoutToken,
      p_expected_total_minor: values.expectedTotalMinor,
      p_customer_note: values.note ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    orderId = data;
    revalidatePath(ROUTES.cart);
    revalidatePath(ROUTES.account.orders);
    revalidatePath("/", "layout");
  });
  if (!result.ok || !orderId) return result;

  if (!paymentsOn()) redirect(`${ROUTES.account.order(orderId)}?placed=1`);
  let checkoutUrl: string | null = null;
  try {
    checkoutUrl = await startCheckout(orderId);
  } catch (error) {
    console.error("[payments] could not start checkout:", error instanceof Error ? error.message : error);
  }
  // redirect() must stay outside try/catch.
  redirect(checkoutUrl ?? `${ROUTES.account.order(orderId)}?payment=unavailable`);
}

/** "Pay now" / "Resume payment": reuses the open hosted checkout or starts a new attempt. */
export async function payForOrder(orderId: unknown): Promise<ActionResult<void>> {
  let checkoutUrl: string | null = null;
  const result = await runAction(async () => {
    const id = uuidSchema.parse(orderId);
    await assertUser();
    if (!paymentsOn()) throw AppError.validation({ _form: ["Online payment is not available right now."] });
    checkoutUrl = await startCheckout(id);
  });
  if (!result.ok || !checkoutUrl) return result;
  redirect(checkoutUrl);
}

/**
 * Cancels an order that is still awaiting payment and releases its stock.
 * Any open hosted-checkout session is expired with Stripe first, so a
 * cancelled order cannot be paid afterwards.
 */
export async function cancelOrder(orderId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(orderId);
    await assertUser();
    const supabase = await createClient();
    // RLS: only the order's customer or an admin can see (and so cancel) it.
    const { data: order, error: orderError } = await supabase.from("orders").select("id").eq("id", id).maybeSingle();
    if (orderError) throw fromPostgrestError(orderError);
    if (order && paymentsOn()) await closeOpenCheckoutSessions(id);
    const { error } = await supabase.rpc("cancel_pending_order", { p_order_id: id });
    if (error) throw fromPostgrestError(error);
    revalidateOrder(id);
  });
}

/** Puts the items of an unpaid, closed order back in the bag at current prices. */
export async function restoreCartFromOrder(
  orderId: unknown,
): Promise<ActionResult<{ restored: number; skipped: number }>> {
  let restoredAny = false;
  const result = await runAction(async () => {
    const id = uuidSchema.parse(orderId);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_cart_from_order", { p_order_id: id });
    if (error) throw fromPostgrestError(error);
    const row = data?.[0] ?? { restored: 0, skipped: 0 };
    revalidatePath(ROUTES.cart);
    revalidatePath("/", "layout");
    revalidateOrder(id);
    restoredAny = row.restored > 0;
    return row;
  });
  if (result.ok && restoredAny) redirect(ROUTES.cart);
  return result;
}
