import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";
import { auditLogTimeBounds, type AuditLogFilters } from "./state";

/**
 * Admin operations reads (Phase 7). RLS and the database functions decide
 * what an administrator may see; these only shape the results.
 */

const n = (value: number | string | null | undefined) => Number(value ?? 0);

// Commission rules ----------------------------------------------------------------

export async function listCommissionRules() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("commission_rules")
    .select(
      "id, scope, vendor_id, category_id, rate_bps, name, is_active, starts_at, ends_at, created_at, updated_at, vendors!commission_rules_vendor_id_fkey(display_name), categories!commission_rules_category_id_fkey(name)",
    )
    .order("scope")
    .order("starts_at", { ascending: false });
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    scope: row.scope,
    vendorId: row.vendor_id,
    categoryId: row.category_id,
    targetName:
      row.scope === "vendor"
        ? (row.vendors?.display_name ?? "Unknown vendor")
        : row.scope === "category"
          ? (row.categories?.name ?? "Unknown category")
          : "All products",
    rateBps: row.rate_bps,
    name: row.name,
    isActive: row.is_active,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    updatedAt: row.updated_at,
  }));
}

export type CommissionRuleRow = Awaited<ReturnType<typeof listCommissionRules>>[number];

/** Vendors with their own commission rate (the "vendor override"). */
export async function listCommissionVendors() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .select("id, display_name, status, commission_rate_bps")
    .order("display_name");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.status === "approved" ? v.display_name : `${v.display_name} (${v.status})`,
    commissionRateBps: v.commission_rate_bps,
  }));
}

/** The rate explain_commission_rate() resolves now, and where it comes from. */
export async function explainCommission(vendorId: string, categoryId: string | null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("explain_commission_rate", {
    p_vendor_id: vendorId,
    ...(categoryId ? { p_category_id: categoryId } : {}),
  });
  if (error) throw fromPostgrestError(error);
  const row = data?.[0];
  if (!row) return null;
  return {
    rateBps: n(row.rate_bps),
    source: row.source,
    ruleId: row.rule_id as string | null,
    categoryId: row.category_id as string | null,
  };
}

// Customers -------------------------------------------------------------------------

export const ADMIN_CUSTOMERS_PAGE_SIZE = 25;

export async function listAdminCustomers(options: {
  search?: string;
  status?: Enums<"account_status"> | null;
  page?: number;
}) {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const { data, error } = await supabase.rpc("admin_customers", {
    ...(options.search ? { p_search: options.search } : {}),
    ...(options.status ? { p_status: options.status } : {}),
    p_limit: ADMIN_CUSTOMERS_PAGE_SIZE,
    p_offset: (page - 1) * ADMIN_CUSTOMERS_PAGE_SIZE,
  });
  if (error) throw fromPostgrestError(error);
  const rows = (data ?? []).map(mapCustomer);
  const total = n(data?.[0]?.total_count);
  return { rows, page, total, pageCount: Math.max(1, Math.ceil(total / ADMIN_CUSTOMERS_PAGE_SIZE)) };
}

function mapCustomer(row: {
  profile_id: string;
  full_name: string | null;
  email: string | null;
  status: Enums<"account_status">;
  joined_at: string;
  paid_orders: number;
  spent_minor: number;
  return_requests: number;
}) {
  return {
    profileId: row.profile_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    joinedAt: row.joined_at,
    paidOrders: n(row.paid_orders),
    spent: n(row.spent_minor),
    returnRequests: n(row.return_requests),
  };
}

/** One customer account with its recent activity; null when not a customer account. */
export async function getAdminCustomer(profileId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_customers", { p_profile_id: profileId, p_limit: 1 });
  if (error) throw fromPostgrestError(error);
  const row = data?.[0];
  if (!row) return null;

  const [orders, returns, reviews, audit] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, status, payment_status, total_minor, currency, placed_at")
      .eq("customer_id", profileId)
      .order("placed_at", { ascending: false })
      .limit(20),
    supabase
      .from("return_requests")
      .select("id, rma_number, status, requested_at, order_id")
      .eq("customer_id", profileId)
      .order("requested_at", { ascending: false })
      .limit(20),
    supabase
      .from("reviews")
      .select("id, rating, title, status, created_at, products!reviews_product_id_fkey(name)")
      .eq("customer_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("audit_logs")
      .select("id, action, actor_role, created_at, metadata")
      .eq("entity_type", "profile")
      .eq("entity_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  for (const result of [orders, returns, reviews, audit]) {
    if (result.error) throw fromPostgrestError(result.error);
  }
  const orderIds = (orders.data ?? []).map((o) => o.id);
  const refunds = orderIds.length
    ? await supabase
        .from("refunds")
        .select("id, order_id, amount_minor, currency, status, kind, created_at, processed_at")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [], error: null };
  if (refunds.error) throw fromPostgrestError(refunds.error);
  const orderNumbers = new Map((orders.data ?? []).map((o) => [o.id, o.order_number]));

  return {
    customer: mapCustomer(row),
    orders: orders.data ?? [],
    returns: (returns.data ?? []).map((r) => ({ ...r, orderNumber: orderNumbers.get(r.order_id) ?? null })),
    refunds: (refunds.data ?? []).map((r) => ({ ...r, orderNumber: orderNumbers.get(r.order_id) ?? null })),
    reviews: (reviews.data ?? []).map((r) => ({ ...r, productName: r.products?.name ?? "Unknown product" })),
    audit: audit.data ?? [],
  };
}

// Audit logs -------------------------------------------------------------------------

export const AUDIT_LOG_PAGE_SIZE = 50;

export async function listAuditLogs(filters: AuditLogFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, actor_id, actor_role, metadata, created_at", { count: "exact" });
  if (filters.action) {
    query = filters.action.endsWith(".")
      ? query.like("action", `${filters.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      : query.eq("action", filters.action);
  }
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  const bounds = auditLogTimeBounds(filters);
  if (bounds.gte) query = query.gte("created_at", bounds.gte);
  if (bounds.lt) query = query.lt("created_at", bounds.lt);
  const start = (filters.page - 1) * AUDIT_LOG_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + AUDIT_LOG_PAGE_SIZE - 1);
  if (error) throw fromPostgrestError(error);

  const actorIds = Array.from(new Set((data ?? []).map((row) => row.actor_id).filter((id): id is string => !!id)));
  const actors = actorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorIds)
    : { data: [], error: null };
  if (actors.error) throw fromPostgrestError(actors.error);
  const names = new Map((actors.data ?? []).map((p) => [p.id, p.full_name]));

  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => ({ ...row, actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null })),
    total,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE)),
  };
}

// Settings ---------------------------------------------------------------------------

export async function listPlatformSettings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_settings")
    .select("key, value, description, is_public, updated_at")
    .order("key");
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}
