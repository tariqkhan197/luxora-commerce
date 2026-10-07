"use server";

import { revalidatePath } from "next/cache";
import { VENDOR_TERMS_VERSION } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { vendorApplicationSchema } from "@/lib/validation";

/**
 * Submits a vendor application for the signed-in user. RLS guarantees the row
 * is owned by the caller and starts in `submitted`; the partial unique index
 * rejects a second open application (surfaced as a CONFLICT error).
 */
export async function submitVendorApplication(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const values = vendorApplicationSchema.parse(input);
    const { profile } = await assertUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("vendor_applications")
      .insert({
        profile_id: profile.id,
        business_name: values.businessName,
        business_email: values.businessEmail,
        business_phone: values.businessPhone ?? null,
        website_url: values.websiteUrl ?? null,
        description: values.description,
        product_categories: values.productCategories,
        // Acceptance time is set by the database (record_vendor_terms_acceptance).
        terms_version: VENDOR_TERMS_VERSION,
      })
      .select("id")
      .single();
    if (error) throw fromPostgrestError(error);

    revalidatePath(ROUTES.vendor.onboarding);
    return { id: data.id };
  });
}
