import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * Finance reads. All go through the signed-in user's client, so RLS decides:
 * admins see everything, vendor members see their own ledger and payouts.
 */

/** Payments, attempts, refunds, disputes and platform ledger lines of one order (admin). */
export async function getOrderFinance(orderId: string) {
  const supabase = await createClient();
  const [payments, attempts, refunds, disputes, ledger] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "id, provider, provider_payment_id, status, amount_minor, fee_minor, refunded_minor, currency, captured_at, metadata",
      )
      .eq("order_id", orderId)
      .order("created_at"),
    supabase
      .from("payment_attempts")
      .select("attempt_no, status, amount_minor, currency, expires_at, completed_at, created_at")
      .eq("order_id", orderId)
      .order("attempt_no"),
    supabase
      .from("refunds")
      .select(
        "id, vendor_order_id, kind, status, amount_minor, shipping_minor, currency, reason, commission_reversed_minor, vendor_debit_minor, provider_refund_id, failure_message, created_at, processed_at, refund_items(quantity, amount_minor, order_items(product_name, variant_title))",
      )
      .eq("order_id", orderId)
      .order("created_at", { ascending: false }),
    supabase
      .from("payment_disputes")
      .select("provider_dispute_id, status, reason, amount_minor, fee_minor, currency, opened_at, closed_at")
      .eq("order_id", orderId),
    supabase
      .from("platform_ledger_entries")
      .select("id, entry_type, amount_minor, currency, description, created_at")
      .eq("order_id", orderId)
      .order("id"),
  ]);
  for (const result of [payments, attempts, refunds, disputes, ledger]) {
    if (result.error) throw fromPostgrestError(result.error);
  }
  return {
    payments: payments.data ?? [],
    attempts: attempts.data ?? [],
    refunds: refunds.data ?? [],
    disputes: disputes.data ?? [],
    ledger: ledger.data ?? [],
  };
}

export type OrderFinance = Awaited<ReturnType<typeof getOrderFinance>>;

export async function listRefunds() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("refunds")
    .select(
      "id, kind, status, amount_minor, shipping_minor, currency, reason, failure_message, created_at, processed_at, order_id, orders!refunds_order_id_fkey(order_number), vendor_orders!refunds_vendor_order_id_fkey(vendor_order_number)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export async function listVendorBalances() {
  const supabase = await createClient();
  const [{ data: balances, error }, { data: vendors, error: vendorError }] = await Promise.all([
    supabase.from("vendor_balances").select("*"),
    supabase.from("vendors").select("id, display_name, status").order("display_name"),
  ]);
  if (error) throw fromPostgrestError(error);
  if (vendorError) throw fromPostgrestError(vendorError);
  const byVendor = new Map((balances ?? []).map((row) => [row.vendor_id, row]));
  return (vendors ?? [])
    .map((vendor) => ({ vendor, balance: byVendor.get(vendor.id) ?? null }))
    .filter((row) => row.balance !== null);
}

export async function listPayouts(vendorId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("payouts")
    .select(
      "id, vendor_id, status, currency, net_minor, method, reference, paid_at, notes, created_at, vendors(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (vendorId) query = query.eq("vendor_id", vendorId);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

/** Platform result by entry type (admin). */
export async function getPlatformLedgerSummary() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_ledger_entries")
    .select("entry_type, amount_minor, currency")
    .limit(10_000);
  if (error) throw fromPostgrestError(error);
  const totals = new Map<string, number>();
  for (const row of data ?? []) totals.set(row.entry_type, (totals.get(row.entry_type) ?? 0) + row.amount_minor);
  return [...totals.entries()].map(([entryType, amountMinor]) => ({ entryType, amountMinor }));
}

export async function getVendorFinance(vendorId: string) {
  const supabase = await createClient();
  const [{ data: balance, error }, { data: entries, error: entryError }] = await Promise.all([
    supabase.from("vendor_balances").select("*").eq("vendor_id", vendorId).maybeSingle(),
    supabase
      .from("vendor_ledger_view")
      .select("id, entry_type, amount_minor, currency, description, created_at, available_at, vendor_order_number")
      .eq("vendor_id", vendorId)
      .order("id", { ascending: false })
      .limit(100),
  ]);
  if (error) throw fromPostgrestError(error);
  if (entryError) throw fromPostgrestError(entryError);
  const now = Date.now();
  return {
    balance,
    entries: (entries ?? []).map((entry) => ({
      ...entry,
      isAvailable: entry.available_at !== null && new Date(entry.available_at).getTime() <= now,
    })),
  };
}
