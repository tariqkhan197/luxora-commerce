import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import type { DateRange } from "@/lib/reporting/periods";
import { createClient } from "@/lib/supabase/server";

/**
 * Report reads. Every figure is computed by a database function that checks
 * the caller (admin, or a member of that vendor) and uses UTC day ranges; the
 * application only formats the results. See docs/DATABASE.md for definitions.
 */

const n = (value: number | string | null | undefined) => Number(value ?? 0);

async function rpc<T>(promise: PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error);
  return data;
}

// Admin ----------------------------------------------------------------------

export async function adminSalesSummary(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_sales_summary", { p_from: range.from, p_to: range.to }));
  const row = rows?.[0];
  return {
    grossSales: n(row?.gross_sales_minor),
    refunds: n(row?.refunds_minor),
    netSales: n(row?.net_sales_minor),
    paidOrders: n(row?.paid_orders),
    units: n(row?.units),
    averageOrderValue: n(row?.average_order_value_minor),
    newCustomers: n(row?.new_customers),
    returnedUnits: n(row?.returned_units),
    luxoraNetRevenue: n(row?.luxora_net_revenue_minor),
  };
}

export type AdminSalesSummary = Awaited<ReturnType<typeof adminSalesSummary>>;

export async function adminRevenueBreakdown(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_revenue_breakdown", { p_from: range.from, p_to: range.to }));
  return (rows ?? []).map((row) => ({
    entryType: row.entry_type,
    amount: n(row.amount_minor),
    entries: n(row.entries),
  }));
}

export async function adminSalesDaily(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_sales_daily", { p_from: range.from, p_to: range.to }));
  return (rows ?? []).map((row) => ({
    day: String(row.day).slice(0, 10),
    grossSales: n(row.gross_sales_minor),
    refunds: n(row.refunds_minor),
    paidOrders: n(row.paid_orders),
  }));
}

export async function adminTopVendors(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_top_vendors", { p_from: range.from, p_to: range.to, p_limit: 10 }));
  return (rows ?? []).map((row) => ({
    vendorId: row.vendor_id,
    name: row.vendor_name,
    paidOrders: n(row.paid_orders),
    sales: n(row.sales_minor),
    commission: n(row.commission_minor),
  }));
}

export async function adminTopProducts(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_top_products", { p_from: range.from, p_to: range.to, p_limit: 10 }));
  return (rows ?? []).map((row) => ({
    productId: row.product_id,
    name: row.product_name,
    vendorName: row.vendor_name,
    units: n(row.units),
    sales: n(row.sales_minor),
  }));
}

export async function adminDiscountUsage(range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(supabase.rpc("admin_discount_usage", { p_from: range.from, p_to: range.to }));
  const row = rows?.[0];
  return {
    ordersWithCode: n(row?.orders_with_code),
    luxoraFunded: n(row?.luxora_funded_minor),
    vendorCodes: n(row?.vendor_code_minor),
    flashSaleSavings: n(row?.flash_sale_savings_minor),
  };
}

// Vendor ---------------------------------------------------------------------

export async function vendorSalesSummary(vendorId: string, range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(
    supabase.rpc("vendor_sales_summary", { p_vendor_id: vendorId, p_from: range.from, p_to: range.to }),
  );
  const row = rows?.[0];
  return {
    sales: n(row?.sales_minor),
    customerPaid: n(row?.customer_paid_minor),
    paidOrders: n(row?.paid_orders),
    units: n(row?.units),
    commission: n(row?.commission_minor),
    earnings: n(row?.earnings_minor),
    refunds: n(row?.refunds_minor),
    returnRequests: n(row?.return_requests),
    returnedUnits: n(row?.returned_units),
    reviewCount: n(row?.review_count),
    ratingSum: n(row?.rating_sum),
  };
}

export type VendorSalesSummary = Awaited<ReturnType<typeof vendorSalesSummary>>;

export async function vendorSalesDaily(vendorId: string, range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(
    supabase.rpc("vendor_sales_daily", { p_vendor_id: vendorId, p_from: range.from, p_to: range.to }),
  );
  return (rows ?? []).map((row) => ({
    day: String(row.day).slice(0, 10),
    sales: n(row.sales_minor),
    paidOrders: n(row.paid_orders),
  }));
}

export async function vendorTopProducts(vendorId: string, range: DateRange) {
  const supabase = await createClient();
  const rows = await rpc(
    supabase.rpc("vendor_top_products", { p_vendor_id: vendorId, p_from: range.from, p_to: range.to, p_limit: 10 }),
  );
  return (rows ?? []).map((row) => ({
    productId: row.product_id,
    name: row.product_name,
    units: n(row.units),
    sales: n(row.sales_minor),
  }));
}

export const CUSTOMERS_PAGE_SIZE = 25;

export async function vendorCustomers(vendorId: string, options: { search?: string; page?: number } = {}) {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const rows = await rpc(
    supabase.rpc("vendor_customers", {
      p_vendor_id: vendorId,
      p_search: options.search ?? "",
      p_limit: CUSTOMERS_PAGE_SIZE,
      p_offset: (page - 1) * CUSTOMERS_PAGE_SIZE,
    }),
  );
  const list = (rows ?? []).map((row) => ({
    key: row.customer_key,
    name: row.customer_name as string | null,
    city: row.city as string | null,
    countryCode: row.country_code as string | null,
    paidOrders: n(row.paid_orders),
    spent: n(row.spent_minor),
    lastOrderAt: row.last_order_at,
  }));
  const total = n(rows?.[0]?.total_count);
  return { rows: list, page, pageCount: Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE)), total };
}

/** Tracked variants at or below their low-stock threshold (current stock, not period-based). */
export async function vendorLowStock(vendorId: string, limit = 10) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory")
    .select(
      "variant_id, available_quantity, low_stock_threshold, track_inventory, product_variants!inventory_variant_id_fkey(sku, title, products!product_variants_product_id_fkey(name))",
    )
    .eq("vendor_id", vendorId)
    .eq("track_inventory", true)
    .order("available_quantity", { ascending: true });
  if (error) throw fromPostgrestError(error);
  const low = (data ?? []).filter((row) => (row.available_quantity ?? 0) <= row.low_stock_threshold);
  return {
    count: low.length,
    rows: low.slice(0, limit).map((row) => ({
      variantId: row.variant_id,
      productName: row.product_variants?.products?.name ?? "Unknown product",
      variantTitle: row.product_variants?.title ?? null,
      sku: row.product_variants?.sku ?? null,
      available: row.available_quantity ?? 0,
      threshold: row.low_stock_threshold,
    })),
  };
}
