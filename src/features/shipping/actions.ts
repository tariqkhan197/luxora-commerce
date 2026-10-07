"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { STORE_CURRENCY } from "@/config/legal";
import { assertRole, assertVendorContext } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { parseToMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { setActiveSchema, shippingZoneSchema, uuidSchema, vendorShippingRateSchema } from "@/lib/validation";

const ADMIN_ROLES = ["admin", "super_admin"] as const;
const MANAGERS = ["owner", "manager"] as const;

/**
 * Shipping zones (admin) and vendor shipping rates. Shipping charges are only
 * ever computed in the database (`checkout_shipping_quote`, `place_order`);
 * these actions just maintain the configuration.
 */

function revalidateShipping() {
  revalidatePath(ROUTES.admin.shipping);
  revalidatePath(ROUTES.vendor.shipping);
  revalidatePath(ROUTES.vendor.dashboard);
  revalidatePath(ROUTES.vendor.storefront);
  revalidatePath(ROUTES.checkout);
}

// -----------------------------------------------------------------------------
// Admin: zones
// -----------------------------------------------------------------------------
export async function saveShippingZone(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const values = shippingZoneSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_save_shipping_zone", {
      p_zone_id: values.id,
      p_name: values.name,
      p_description: values.description,
      p_position: values.position,
      p_is_active: values.isActive,
      p_countries: values.countries,
    });
    if (error) {
      if (error.code === "P0001" && /already exists/.test(error.message)) {
        throw AppError.validation({ name: [error.message] });
      }
      if (error.code === "P0001" && /another zone/.test(error.message)) {
        throw AppError.validation({ countries: [error.message] });
      }
      throw fromPostgrestError(error);
    }
    revalidateShipping();
    return { id: data };
  });
}

export async function setShippingZoneActive(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { id, active } = setActiveSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data: zone, error: zoneError } = await supabase
      .from("shipping_zones")
      .select("name, description, position, shipping_zone_countries(country_code)")
      .eq("id", id)
      .maybeSingle();
    if (zoneError) throw fromPostgrestError(zoneError);
    if (!zone) throw AppError.notFound("Shipping zone not found.");
    // Routed through the RPC so the change is audited like any other zone edit.
    const { error } = await supabase.rpc("admin_save_shipping_zone", {
      p_zone_id: id,
      p_name: zone.name,
      p_description: zone.description ?? undefined,
      p_position: zone.position,
      p_is_active: active,
      p_countries: zone.shipping_zone_countries.map((country) => country.country_code),
    });
    if (error) throw fromPostgrestError(error);
    revalidateShipping();
  });
}

export async function deleteShippingZone(zoneId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(zoneId);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.from("shipping_zones").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Shipping zone not found.");
    revalidateShipping();
  });
}

// -----------------------------------------------------------------------------
// Vendor: rates
// -----------------------------------------------------------------------------
export async function saveVendorShippingRate(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = vendorShippingRateSchema.parse(input);
    const { vendor } = await assertVendorContext(MANAGERS);
    const supabase = await createClient();
    const { error } = await supabase.from("vendor_shipping_rates").upsert(
      {
        vendor_id: vendor.id,
        zone_id: values.zoneId,
        currency: STORE_CURRENCY,
        first_item_minor: parseToMinor(values.firstItem, STORE_CURRENCY),
        additional_item_minor: parseToMinor(values.additionalItem, STORE_CURRENCY),
        free_shipping_threshold_minor: values.freeOver ? parseToMinor(values.freeOver, STORE_CURRENCY) : null,
        min_delivery_days: values.minDays ?? null,
        max_delivery_days: values.maxDays ?? null,
        is_active: values.enabled,
      },
      { onConflict: "vendor_id,zone_id" },
    );
    if (error) {
      if (error.code === "23503") throw AppError.validation({ _form: ["That shipping zone no longer exists."] });
      throw fromPostgrestError(error);
    }
    revalidateShipping();
  });
}
