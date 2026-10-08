"use server";

import { revalidatePath } from "next/cache";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { assertRole, assertVendorContext } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { parseToMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  adminDisableSchema,
  couponActiveSchema,
  couponFormSchema,
  dateTimeInputToIso,
  flashSaleFormSchema,
  percentToBasisPoints,
  uuidSchema,
  type CouponFormValues,
} from "@/lib/validation";

/**
 * Coupons and flash sales. Every write is a database function that checks
 * who may do it (vendor owner/manager, administrator) and the promotion
 * rules; these actions validate input, convert amounts to minor units and
 * refresh the pages.
 */

const ADMIN_ROLES = ["admin", "super_admin"] as const;
const VENDOR_MANAGERS = ["owner", "manager"] as const;

function revalidatePromotions() {
  revalidatePath(ROUTES.vendor.coupons);
  revalidatePath(ROUTES.vendor.flashSales);
  revalidatePath(ROUTES.admin.coupons);
  revalidatePath(ROUTES.admin.flashSales);
  revalidatePath(ROUTES.cart);
  revalidatePath(ROUTES.shop);
  revalidatePath("/product/[slug]", "page");
}

/**
 * These functions take every argument (no SQL defaults) but accept SQL null for
 * optional ones; the generated types do not express that, so send an explicit null.
 */
function sqlNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T;
}

function couponArgs(values: CouponFormValues, vendorId: string | null) {
  const value =
    values.discountType === "percentage"
      ? (percentToBasisPoints(values.percent ?? "") ?? 0)
      : values.discountType === "fixed_amount" && values.amount
        ? parseToMinor(values.amount, STORE_CURRENCY)
        : 0;
  return {
    p_coupon_id: sqlNull(values.couponId),
    p_vendor_id: sqlNull(vendorId),
    p_code: values.code,
    p_name: values.name,
    p_description: sqlNull(values.description),
    p_discount_type: values.discountType,
    p_discount_value: value,
    p_min_subtotal_minor: values.minSubtotal ? parseToMinor(values.minSubtotal, STORE_CURRENCY) : 0,
    p_max_discount_minor: sqlNull(values.maxDiscount ? parseToMinor(values.maxDiscount, STORE_CURRENCY) : null),
    p_usage_limit: sqlNull(values.usageLimit),
    p_usage_limit_per_customer: sqlNull(values.usageLimitPerCustomer),
    p_starts_at: sqlNull(dateTimeInputToIso(values.startsAt)),
    p_ends_at: sqlNull(dateTimeInputToIso(values.endsAt)),
  };
}

// Coupons ---------------------------------------------------------------------

/** Vendor owners/managers: create or edit one of their own codes (funded by the vendor). */
export async function saveVendorCoupon(input: unknown): Promise<ActionResult<{ couponId: string }>> {
  return runAction(async () => {
    const values = couponFormSchema.parse(input);
    const { vendor } = await assertVendorContext(VENDOR_MANAGERS);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_coupon", couponArgs(values, vendor.id));
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
    return { couponId: data };
  });
}

/** Administrators: create or edit a Luxora code (funded by Luxora). */
export async function savePlatformCoupon(input: unknown): Promise<ActionResult<{ couponId: string }>> {
  return runAction(async () => {
    const values = couponFormSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_coupon", couponArgs(values, null));
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
    return { couponId: data };
  });
}

/** Pause or resume a code (its owner: the vendor, or an administrator for Luxora codes). */
export async function setCouponActive(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = couponActiveSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_coupon_active", {
      p_coupon_id: values.couponId,
      p_active: values.active,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
  });
}

export async function adminDisableCoupon(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = adminDisableSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_coupon_disabled", {
      p_coupon_id: values.id,
      p_disabled: true,
      p_reason: values.reason,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
  });
}

export async function adminEnableCoupon(couponId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(couponId);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_set_coupon_disabled", { p_coupon_id: id, p_disabled: false });
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
  });
}

// Flash sales -----------------------------------------------------------------

/** Vendor owners/managers: create or edit a sale and (until it starts) its items. */
export async function saveFlashSale(input: unknown): Promise<ActionResult<{ saleId: string }>> {
  return runAction(async () => {
    const values = flashSaleFormSchema.parse(input);
    const { vendor } = await assertVendorContext(VENDOR_MANAGERS);
    const supabase = await createClient();
    const { data: saleId, error } = await supabase.rpc("save_flash_sale", {
      p_sale_id: sqlNull(values.saleId),
      p_vendor_id: vendor.id,
      p_name: values.name,
      p_description: sqlNull(values.description),
      p_starts_at: dateTimeInputToIso(values.startsAt) ?? "",
      p_ends_at: dateTimeInputToIso(values.endsAt) ?? "",
    });
    if (error) throw fromPostgrestError(error);

    const { data: sale, error: readError } = await supabase
      .from("flash_sales")
      .select("starts_at, flash_sale_items(id)")
      .eq("id", saleId)
      .single();
    if (readError) throw fromPostgrestError(readError);
    // Items can change until the sale starts (or once, while a started sale is still empty).
    const editable = new Date(sale.starts_at) > new Date() || sale.flash_sale_items.length === 0;
    if (editable) {
      const { error: itemsError } = await supabase.rpc("set_flash_sale_items", {
        p_sale_id: saleId,
        p_items: values.items.map((item) => ({
          variant_id: item.variantId,
          sale_price_minor: parseToMinor(item.salePrice, STORE_CURRENCY),
          quantity_limit: item.quantityLimit ?? null,
        })),
      });
      if (itemsError) throw fromPostgrestError(itemsError);
    }
    revalidatePromotions();
    return { saleId };
  });
}

export async function endFlashSale(saleId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(saleId);
    await assertVendorContext(VENDOR_MANAGERS);
    const supabase = await createClient();
    const { error } = await supabase.rpc("end_flash_sale", { p_sale_id: id });
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
  });
}

export async function adminDisableFlashSale(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = adminDisableSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.rpc("admin_disable_flash_sale", { p_sale_id: values.id, p_reason: values.reason });
    if (error) throw fromPostgrestError(error);
    revalidatePromotions();
  });
}
