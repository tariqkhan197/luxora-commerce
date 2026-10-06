"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { placeOrderSchema, uuidSchema } from "@/lib/validation";

/**
 * Places the order for the caller's cart. The browser supplies address ids, an
 * idempotency token and the total it displayed; `place_order()` recomputes
 * everything from the catalog, reserves stock and rejects any drift.
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
  if (result.ok && orderId) redirect(`${ROUTES.account.order(orderId)}?placed=1`);
  return result;
}

/** Cancels an order that is still awaiting payment and releases its stock. */
export async function cancelOrder(orderId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(orderId);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_pending_order", { p_order_id: id });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.account.orders);
    revalidatePath(ROUTES.account.order(id));
    revalidatePath(ROUTES.admin.orders);
    revalidatePath(ROUTES.admin.order(id));
  });
}
