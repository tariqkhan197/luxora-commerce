import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";

/**
 * Return reads through the RLS client: customers see their own returns,
 * vendor members their vendor's, admins everything.
 */

const RETURN_SELECT = `
  id, rma_number, status, order_id, vendor_order_id, vendor_id, customer_id, customer_note, return_instructions,
  rejection_reason, carrier, tracking_number, tracking_url, inspection_notes, restocked, refund_id,
  requested_at, approved_at, rejected_at, shipped_at, received_at, completed_at, cancelled_at,
  orders!return_requests_order_id_fkey ( order_number, currency, customer_email ),
  vendor_orders!return_requests_vendor_order_id_fkey ( vendor_order_number ),
  vendors!return_requests_vendor_id_fkey ( display_name ),
  return_request_items (
    id, quantity, reason,
    order_items!return_request_items_order_item_id_fkey ( product_name, variant_title, sku, unit_price_minor )
  )
`;

export type ReturnStatus = Enums<"return_status">;

export async function listReturns(
  filters: { orderId?: string; vendorId?: string; customerId?: string; status?: ReturnStatus | null } = {},
) {
  const supabase = await createClient();
  let query = supabase
    .from("return_requests")
    .select(RETURN_SELECT)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (filters.orderId) query = query.eq("order_id", filters.orderId);
  if (filters.vendorId) query = query.eq("vendor_id", filters.vendorId);
  if (filters.customerId) query = query.eq("customer_id", filters.customerId);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type ReturnRequestRow = Awaited<ReturnType<typeof listReturns>>[number];

/** Per-item returnable quantities for the signed-in customer's order. */
export async function getReturnEligibility(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("return_eligibility", { p_order_id: orderId });
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}
