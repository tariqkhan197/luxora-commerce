import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Order reads. Every query goes through the RLS client, so the same functions
 * return a customer's own orders, a vendor's own vendor orders, or everything
 * for an administrator — the database decides.
 */

const ORDER_DETAIL = `
  id, order_number, status, payment_status, currency, subtotal_minor, discount_minor, shipping_minor,
  shipping_discount_minor, coupon_code, tax_minor, total_minor, customer_email, customer_note, shipping_address, billing_address, placed_at, confirmed_at,
  cancelled_at, cancellation_reason, reservation_expires_at, customer_id, metadata,
  payment_attempts!payment_attempts_order_id_fkey ( attempt_no, status, expires_at ),
  vendor_orders!vendor_orders_order_id_fkey (
    id, vendor_order_number, status, currency, subtotal_minor, discount_minor, shipping_minor, shipping_discount_minor,
    platform_funded_minor, tax_minor, total_minor, commission_rate_bps, commission_minor, payment_fee_minor,
    vendor_earnings_minor,
    carrier, tracking_number, tracking_url, shipped_at, delivered_at,
    vendors!vendor_orders_vendor_id_fkey ( display_name ),
    order_items!order_items_vendor_order_id_fkey (
      id, product_id, product_name, variant_title, sku, image_path, quantity, unit_price_minor, list_price_minor,
      discount_minor, platform_discount_minor, flash_sale_item_id, total_minor, fulfilled_quantity, refunded_quantity
    )
  ),
  payments!payments_order_id_fkey ( id, provider, status, amount_minor, refunded_minor, currency, captured_at )
`;

export async function listOrdersForCustomer(profileId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, payment_status, currency, total_minor, placed_at, reservation_expires_at, vendor_orders!vendor_orders_order_id_fkey(id, order_items!order_items_vendor_order_id_fkey(quantity, image_path, product_name))",
    )
    .eq("customer_id", profileId)
    .order("placed_at", { ascending: false })
    .limit(100);
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export async function getOrderDetail(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select(ORDER_DETAIL).eq("id", orderId).maybeSingle();
  if (error) throw fromPostgrestError(error);
  return data;
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

export async function listOrdersForAdmin(status: Enums<"order_status"> | null) {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, order_number, status, payment_status, currency, total_minor, customer_email, placed_at, vendor_orders!vendor_orders_order_id_fkey(id)",
    )
    .order("placed_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export async function listVendorOrders(vendorId: string, status: Enums<"vendor_order_status"> | null) {
  const supabase = await createClient();
  let query = supabase
    .from("vendor_orders")
    .select(
      "id, vendor_order_number, status, currency, total_minor, vendor_earnings_minor, created_at, shipping_address, order_items!order_items_vendor_order_id_fkey(quantity)",
    )
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export async function getVendorOrderDetail(vendorOrderId: string, vendorId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendor_orders")
    .select(
      `id, vendor_order_number, status, currency, subtotal_minor, discount_minor, shipping_minor, shipping_discount_minor,
       platform_funded_minor, tax_minor, total_minor, commission_rate_bps,
       commission_minor, payment_fee_minor, vendor_earnings_minor, shipping_address, carrier, tracking_number, tracking_url,
       shipped_at, delivered_at, cancelled_at, vendor_note, created_at,
       order_items!order_items_vendor_order_id_fkey(id, product_id, product_name, variant_title, sku, image_path, quantity,
         unit_price_minor, list_price_minor, discount_minor, platform_discount_minor, flash_sale_item_id, total_minor,
         commission_rate_bps, commission_minor, fulfilled_quantity)`,
    )
    .eq("id", vendorOrderId)
    .eq("vendor_id", vendorId)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  return data;
}
