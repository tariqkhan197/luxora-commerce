"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertRole } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  approveApplicationSchema,
  moderateProductSchema,
  rejectApplicationSchema,
  uuidSchema,
  vendorStatusChangeSchema,
} from "@/lib/validation";

const ADMIN_ROLES = ["admin", "super_admin"] as const;

/**
 * Administrative Server Actions. Each delegates to a SECURITY DEFINER database
 * function that re-checks `is_admin()`, applies the change atomically and
 * writes the audit log — the action only validates input and revalidates UI.
 */

export async function approveVendorApplication(input: unknown): Promise<ActionResult<{ vendorId: string }>> {
  return runAction(async () => {
    const values = approveApplicationSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("approve_vendor_application", {
      p_application_id: values.applicationId,
      p_slug: values.slug,
      p_commission_rate_bps: values.commissionRateBps ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.vendors);
    revalidatePath(ROUTES.admin.root);
    return { vendorId: data };
  });
}

export async function rejectVendorApplication(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = rejectApplicationSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("reject_vendor_application", {
      p_application_id: values.applicationId,
      p_reason: values.reason,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.vendors);
    revalidatePath(ROUTES.admin.root);
  });
}

export async function markApplicationUnderReview(applicationId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(applicationId);
    const { profile } = await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase
      .from("vendor_applications")
      .update({ status: "under_review", reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "submitted");
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.vendors);
  });
}

export async function changeVendorStatus(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = vendorStatusChangeSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_vendor_status", {
      p_vendor_id: values.vendorId,
      p_status: values.status,
      p_reason: values.reason ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.vendors);
    revalidatePath(ROUTES.admin.vendor(values.vendorId));
  });
}

export async function moderateProduct(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = moderateProductSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("moderate_product", {
      p_product_id: values.productId,
      p_approve: values.approve,
      p_reason: values.reason ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.products);
    revalidatePath(ROUTES.admin.root);
  });
}
