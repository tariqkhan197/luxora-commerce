"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { issueReturnRefund } from "@/features/payments/refunds";
import { assertRole, assertUser } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { paymentsOn } from "@/lib/payments/status";
import { createClient } from "@/lib/supabase/server";
import {
  approveReturnSchema,
  receiveReturnSchema,
  refundReturnSchema,
  rejectReturnSchema,
  returnRequestSchema,
  returnShippedSchema,
  uuidSchema,
} from "@/lib/validation";

/**
 * Returns (RMA). Every step is a database function that re-checks who may do
 * it and in which state; these actions validate input and refresh the pages.
 */

function revalidateReturns() {
  revalidatePath(ROUTES.account.returns);
  revalidatePath(ROUTES.account.orders);
  revalidatePath("/account/orders/[id]", "page");
  revalidatePath(ROUTES.vendor.returns);
  revalidatePath(ROUTES.admin.returns);
}

// Customer -------------------------------------------------------------------

export async function requestReturn(input: unknown): Promise<ActionResult<{ returnId: string }>> {
  return runAction(async () => {
    const values = returnRequestSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_return_request", {
      p_vendor_order_id: values.vendorOrderId,
      p_items: values.items.map((item) => ({
        order_item_id: item.orderItemId,
        quantity: item.quantity,
        reason: item.reason,
      })),
      p_note: values.note ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
    return { returnId: data };
  });
}

export async function cancelReturn(returnId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(returnId);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_return_request", { p_return_id: id });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
  });
}

export async function markReturnShipped(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = returnShippedSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_return_shipped", {
      p_return_id: values.returnId,
      p_carrier: values.carrier,
      p_tracking_number: values.trackingNumber,
      p_tracking_url: values.trackingUrl ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
  });
}

// Vendor owner/manager or admin -------------------------------------------------

export async function approveReturn(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = approveReturnSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("approve_return_request", {
      p_return_id: values.returnId,
      p_instructions: values.instructions,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
  });
}

export async function rejectReturn(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = rejectReturnSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("reject_return_request", {
      p_return_id: values.returnId,
      p_reason: values.reason,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
  });
}

export async function receiveReturn(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = receiveReturnSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("mark_return_received", {
      p_return_id: values.returnId,
      p_restock: values.restock,
      p_notes: values.notes ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReturns();
    revalidatePath(ROUTES.vendor.inventory);
  });
}

// Admin ------------------------------------------------------------------------

export async function refundReturn(input: unknown): Promise<ActionResult<{ refundId: string; status: string }>> {
  return runAction(async () => {
    const values = refundReturnSchema.parse(input);
    await assertRole(["admin", "super_admin"]);
    if (!paymentsOn()) throw AppError.validation({ _form: ["Online payments are not enabled."] });
    const result = await issueReturnRefund(values.returnId, values.shipping);
    revalidateReturns();
    revalidatePath(ROUTES.admin.refunds);
    return result;
  });
}
