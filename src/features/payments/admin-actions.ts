"use server";

import { revalidatePath } from "next/cache";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { assertRole } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { parseToMinor } from "@/lib/money";
import { paymentsOn } from "@/lib/payments/status";
import { createClient } from "@/lib/supabase/server";
import { refundRequestSchema, reversePayoutSchema, vendorPayoutSchema } from "@/lib/validation";
import { issueRefund } from "./refunds";

const ADMIN_ROLES = ["admin", "super_admin"] as const;

/** Refunds items (and, per policy, shipping) of one vendor order through Stripe (test mode). */
export async function refundVendorOrder(input: unknown): Promise<ActionResult<{ refundId: string; status: string }>> {
  return runAction(async () => {
    const values = refundRequestSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    if (!paymentsOn()) throw AppError.validation({ _form: ["Online payments are not enabled."] });
    const result = await issueRefund(values);
    revalidatePath(ROUTES.admin.refunds);
    revalidatePath(ROUTES.admin.orders);
    revalidatePath("/admin/orders/[id]", "page");
    return result;
  });
}

/** Records a payout Luxora made to a vendor outside Stripe (bank transfer, Wise, …). */
export async function recordVendorPayout(input: unknown): Promise<ActionResult<{ payoutId: string }>> {
  return runAction(async () => {
    const values = vendorPayoutSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_vendor_payout", {
      p_vendor_id: values.vendorId,
      p_amount_minor: parseToMinor(values.amount, STORE_CURRENCY),
      p_method: values.method,
      p_reference: values.reference,
      p_notes: values.notes ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.payouts);
    return { payoutId: data };
  });
}

export async function reverseVendorPayout(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = reversePayoutSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reverse_vendor_payout", {
      p_payout_id: values.payoutId,
      p_reason: values.reason,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.payouts);
  });
}
