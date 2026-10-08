import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Promotion reads through the RLS client: vendor members see their vendor's
 * coupons and sales, administrators see everything, customers no coupons.
 */

const COUPON_SELECT = `
  id, code, scope, funded_by, vendor_id, name, description, discount_type, discount_value, min_subtotal_minor,
  max_discount_minor, usage_limit, usage_limit_per_customer, used_count, starts_at, ends_at, is_active,
  disabled_by_admin_at, disabled_reason, created_at,
  vendors ( display_name )
`;

export async function listCoupons(filters: { vendorId?: string; scope?: "platform" | "vendor" } = {}) {
  const supabase = await createClient();
  let query = supabase.from("coupons").select(COUPON_SELECT).order("created_at", { ascending: false }).limit(200);
  if (filters.vendorId) query = query.eq("vendor_id", filters.vendorId);
  if (filters.scope) query = query.eq("scope", filters.scope);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type CouponRow = Awaited<ReturnType<typeof listCoupons>>[number];

/** Redeemed (paid) uses and the discount they gave, per coupon. */
export async function couponRedemptions(couponIds: readonly string[]) {
  if (!couponIds.length) return {} as Record<string, { count: number; discountMinor: number }>;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("coupon_usages")
    .select("coupon_id, discount_minor")
    .in("coupon_id", [...couponIds])
    .eq("status", "redeemed");
  if (error) throw fromPostgrestError(error);
  const totals: Record<string, { count: number; discountMinor: number }> = {};
  for (const row of data ?? []) {
    const entry = (totals[row.coupon_id] ??= { count: 0, discountMinor: 0 });
    entry.count += 1;
    entry.discountMinor += row.discount_minor;
  }
  return totals;
}

const FLASH_SALE_SELECT = `
  id, vendor_id, name, description, starts_at, ends_at, status, disabled_by_admin_at, disabled_reason, created_at,
  vendors ( display_name ),
  flash_sale_items (
    id, variant_id, sale_price_minor, quantity_limit, sold_count,
    product_variants ( sku, title, price_minor, products ( name ) )
  )
`;

export async function listFlashSales(filters: { vendorId?: string } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("flash_sales")
    .select(FLASH_SALE_SELECT)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (filters.vendorId) query = query.eq("vendor_id", filters.vendorId);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type FlashSaleRow = Awaited<ReturnType<typeof listFlashSales>>[number];

/** The vendor's active product options, for the flash-sale item picker. */
export async function listVendorVariantOptions(vendorId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, sku, title, price_minor, is_active, products!inner ( name, vendor_id, status )")
    .eq("products.vendor_id", vendorId)
    .eq("is_active", true)
    .order("sku")
    .limit(500);
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${row.products.name} · ${row.title} (${row.sku})`,
    priceMinor: row.price_minor,
  }));
}

export type VariantOption = Awaited<ReturnType<typeof listVendorVariantOptions>>[number];
