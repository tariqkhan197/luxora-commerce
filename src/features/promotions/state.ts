import { formatBasisPoints, formatMoney } from "@/lib/money";

/**
 * Display states for coupons and flash sales, derived from their rows (pure:
 * used by server pages and unit tests). The database decides what applies.
 */

interface SaleFields {
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "active" | "ended" | "cancelled";
  disabled_by_admin_at: string | null;
}

interface CouponFields {
  is_active: boolean;
  disabled_by_admin_at: string | null;
  starts_at: string;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
}

export type FlashSaleState = "disabled" | "cancelled" | "ended" | "scheduled" | "live";
export type CouponState = "disabled" | "paused" | "expired" | "scheduled" | "used_up" | "active";

/** Where a sale is in its life, from its dates and status. */
export function flashSaleState(sale: SaleFields, now = Date.now()): FlashSaleState {
  if (sale.disabled_by_admin_at) return "disabled";
  if (sale.status === "cancelled") return "cancelled";
  if (sale.status === "ended" || new Date(sale.ends_at).getTime() <= now) return "ended";
  if (new Date(sale.starts_at).getTime() > now) return "scheduled";
  return "live";
}

/** Whether a code can be used now (ignoring the customer's bag). */
export function couponState(coupon: CouponFields, now = Date.now()): CouponState {
  if (coupon.disabled_by_admin_at) return "disabled";
  if (!coupon.is_active) return "paused";
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() <= now) return "expired";
  if (new Date(coupon.starts_at).getTime() > now) return "scheduled";
  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) return "used_up";
  return "active";
}

export const FLASH_SALE_STATE_LABELS: Record<FlashSaleState, string> = {
  live: "Live",
  scheduled: "Scheduled",
  ended: "Ended",
  cancelled: "Cancelled",
  disabled: "Disabled by Luxora",
};

export const COUPON_STATE_LABELS: Record<CouponState, string> = {
  active: "Active",
  scheduled: "Scheduled",
  paused: "Paused",
  expired: "Expired",
  used_up: "Usage limit reached",
  disabled: "Disabled by Luxora",
};

/** "10% off", "$5.00 off", "Free shipping" (percentages are basis points). */
export function couponValueLabel(
  type: "percentage" | "fixed_amount" | "free_shipping",
  value: number,
  currency: string,
  maxDiscountMinor?: number | null,
): string {
  if (type === "free_shipping") return "Free shipping";
  if (type === "fixed_amount") return `${formatMoney(value, currency)} off`;
  const percent = `${formatBasisPoints(value)} off`;
  return maxDiscountMinor ? `${percent} (up to ${formatMoney(maxDiscountMinor, currency)})` : percent;
}
