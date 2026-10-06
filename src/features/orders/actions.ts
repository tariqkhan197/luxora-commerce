"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertVendorContext } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { vendorFulfilmentSchema } from "@/lib/validation";

/**
 * Vendor fulfilment. Column grants limit what can change; the database trigger
 * enforces that only paid orders move forward (confirmed → processing →
 * shipped → delivered) and stamps shipped/delivered times.
 */
export async function updateFulfilment(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = vendorFulfilmentSchema.parse(input);
    const { vendor } = await assertVendorContext();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("vendor_orders")
      .update({
        status: values.status,
        ...(values.status === "shipped"
          ? {
              carrier: values.carrier ?? null,
              tracking_number: values.trackingNumber ?? null,
              tracking_url: values.trackingUrl ?? null,
            }
          : {}),
      })
      .eq("id", values.vendorOrderId)
      .eq("vendor_id", vendor.id)
      .select("id, order_items!order_items_vendor_order_id_fkey(id, quantity)")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Order not found.");

    if (values.status === "shipped") {
      for (const item of data.order_items) {
        const { error: itemError } = await supabase
          .from("order_items")
          .update({ fulfilled_quantity: item.quantity })
          .eq("id", item.id);
        if (itemError) throw fromPostgrestError(itemError);
      }
    }
    revalidatePath(ROUTES.vendor.orders);
    revalidatePath(ROUTES.vendor.order(values.vendorOrderId));
  });
}
