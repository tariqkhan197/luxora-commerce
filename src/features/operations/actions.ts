"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertRole } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  accountStatusSchema,
  commissionRuleActiveSchema,
  commissionRuleFormSchema,
  dateTimeInputToIso,
} from "@/lib/validation";

/**
 * Commission rules and customer account status (Phase 7). Every write is a
 * database function that checks the caller is an administrator, validates the
 * change and records it in the audit log; these actions validate input and
 * refresh the pages.
 */

const ADMIN_ROLES = ["admin", "super_admin"] as const;

/** Optional arguments without SQL defaults take an explicit null (see promotions/actions.ts). */
function sqlNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

/** Create or edit a commission rule. New rates apply to orders placed afterwards only. */
export async function saveCommissionRule(input: unknown): Promise<ActionResult<{ ruleId: string }>> {
  return runAction(async () => {
    const values = commissionRuleFormSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_commission_rule", {
      p_rule_id: sqlNull(values.ruleId),
      p_scope: values.scope,
      p_vendor_id: sqlNull(values.vendorId),
      p_category_id: sqlNull(values.categoryId),
      p_rate_bps: values.rate,
      p_name: values.name,
      p_starts_at: sqlNull(dateTimeInputToIso(values.startsAt)),
      p_ends_at: sqlNull(dateTimeInputToIso(values.endsAt)),
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.commissions);
    return { ruleId: data };
  });
}

export async function setCommissionRuleActive(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = commissionRuleActiveSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_commission_rule_active", {
      p_rule_id: values.ruleId,
      p_active: values.active,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.commissions);
  });
}

/** Suspend or reactivate a customer account, with a reason (audited). */
export async function setCustomerAccountStatus(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = accountStatusSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_account_status", {
      p_profile_id: values.profileId,
      p_status: values.status,
      p_reason: values.reason,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.admin.customers);
    revalidatePath(ROUTES.admin.customer(values.profileId));
  });
}
