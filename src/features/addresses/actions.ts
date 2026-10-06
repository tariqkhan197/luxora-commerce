"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { addressSchema, uuidSchema } from "@/lib/validation";

function revalidateAddresses() {
  revalidatePath(ROUTES.account.addresses);
  revalidatePath(ROUTES.checkout);
}

/** Creates (addressId null) or updates an address owned by the caller. RLS enforces ownership. */
export async function saveAddress(addressId: unknown, input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = addressId ? uuidSchema.parse(addressId) : null;
    const values = addressSchema.parse(input);
    const { profile } = await assertUser();
    const supabase = await createClient();

    // One default per kind (partial unique indexes): clear the previous default first.
    if (values.isDefaultShipping) {
      let clear = supabase
        .from("addresses")
        .update({ is_default_shipping: false })
        .eq("profile_id", profile.id)
        .eq("is_default_shipping", true);
      if (id) clear = clear.neq("id", id);
      const { error } = await clear;
      if (error) throw fromPostgrestError(error);
    }
    if (values.isDefaultBilling) {
      let clear = supabase
        .from("addresses")
        .update({ is_default_billing: false })
        .eq("profile_id", profile.id)
        .eq("is_default_billing", true);
      if (id) clear = clear.neq("id", id);
      const { error } = await clear;
      if (error) throw fromPostgrestError(error);
    }

    const row = {
      type: values.type,
      label: values.label ?? null,
      full_name: values.fullName,
      phone: values.phone ?? null,
      line1: values.line1,
      line2: values.line2 ?? null,
      city: values.city,
      state: values.state ?? null,
      postal_code: values.postalCode,
      country_code: values.countryCode,
      is_default_shipping: values.isDefaultShipping,
      is_default_billing: values.isDefaultBilling,
    };

    const { data, error } = id
      ? await supabase.from("addresses").update(row).eq("id", id).select("id").maybeSingle()
      : await supabase
          .from("addresses")
          .insert({ ...row, profile_id: profile.id })
          .select("id")
          .single();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Address not found.");
    revalidateAddresses();
    return { id: data.id };
  });
}

export async function deleteAddress(addressId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(addressId);
    await assertUser();
    const supabase = await createClient();
    const { error, count } = await supabase.from("addresses").delete({ count: "exact" }).eq("id", id);
    if (error) throw fromPostgrestError(error);
    if (!count) throw AppError.notFound("Address not found.");
    revalidateAddresses();
  });
}
