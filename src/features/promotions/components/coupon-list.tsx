import { ActionButton } from "@/components/shared/action-button";
import { Badge } from "@/components/ui/badge";
import { STORE_CURRENCY } from "@/config/legal";
import { adminEnableCoupon, setCouponActive } from "../actions";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney, toDecimalInput } from "@/lib/money";
import { basisPointsToPercentInput, isoToDateTimeInput } from "@/lib/validation";
import type { CouponRow } from "../queries";
import { COUPON_STATE_LABELS, couponState, couponValueLabel } from "../state";
import { AdminDisableDialog } from "./admin-disable-dialog";
import { CouponFormDialog } from "./coupon-form-dialog";

const STATE_VARIANT = {
  active: "success",
  scheduled: "accent",
  paused: "neutral",
  expired: "neutral",
  used_up: "warning",
  disabled: "danger",
} as const;

interface CouponListProps {
  coupons: CouponRow[];
  redemptions: Record<string, { count: number; discountMinor: number }>;
  viewer: "vendor" | "admin";
  /** Vendor owner/manager (vendor) — admins manage Luxora codes and disable any code. */
  canManage: boolean;
}

function couponWindow(coupon: CouponRow) {
  const starts = formatDateTimeUtc(new Date(coupon.starts_at));
  return coupon.ends_at ? `${starts} → ${formatDateTimeUtc(new Date(coupon.ends_at))}` : `From ${starts}`;
}

/** Discount codes with their state and usage. Every action is re-checked by the database. */
export function CouponList({ coupons, redemptions, viewer, canManage }: CouponListProps) {
  return (
    <ul className="grid gap-4">
      {coupons.map((coupon) => {
        const state = couponState(coupon);
        const redeemed = redemptions[coupon.id] ?? { count: 0, discountMinor: 0 };
        const ownsIt = viewer === "vendor" ? coupon.scope === "vendor" : coupon.scope === "platform";
        const manage = canManage && ownsIt;
        return (
          <li key={coupon.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium tracking-wide text-ink">{coupon.code}</p>
                <p className="text-sm text-ink-soft">
                  {coupon.name} ·{" "}
                  {couponValueLabel(
                    coupon.discount_type,
                    coupon.discount_value,
                    STORE_CURRENCY,
                    coupon.max_discount_minor,
                  )}
                  {coupon.min_subtotal_minor > 0
                    ? ` · minimum spend ${formatMoney(coupon.min_subtotal_minor, STORE_CURRENCY)}`
                    : ""}
                </p>
                <p className="text-xs text-ink-faint">
                  {viewer === "admin"
                    ? coupon.scope === "platform"
                      ? "Luxora code (funded by Luxora) · "
                      : `${coupon.vendors?.display_name ?? "Vendor"} (funded by the vendor) · `
                    : ""}
                  {couponWindow(coupon)}
                </p>
              </div>
              <Badge variant={STATE_VARIANT[state]}>{COUPON_STATE_LABELS[state]}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <dt className="text-ink-soft">Uses (incl. unpaid)</dt>
              <dd className="tabular-nums">
                {coupon.used_count}
                {coupon.usage_limit ? ` / ${coupon.usage_limit}` : ""}
              </dd>
              <dt className="text-ink-soft">Paid orders · discount</dt>
              <dd className="tabular-nums">
                {redeemed.count} · {formatMoney(redeemed.discountMinor, STORE_CURRENCY)}
              </dd>
            </dl>
            {coupon.disabled_by_admin_at ? (
              <p className="text-sm text-danger">Disabled by Luxora: {coupon.disabled_reason}</p>
            ) : null}
            {manage || viewer === "admin" ? (
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                {manage ? (
                  <CouponFormDialog
                    scope={coupon.scope}
                    locked={coupon.used_count > 0 || redeemed.count > 0}
                    initial={{
                      couponId: coupon.id,
                      code: coupon.code,
                      name: coupon.name,
                      description: coupon.description ?? "",
                      discountType: coupon.discount_type,
                      percent:
                        coupon.discount_type === "percentage" ? basisPointsToPercentInput(coupon.discount_value) : "",
                      amount:
                        coupon.discount_type === "fixed_amount"
                          ? toDecimalInput(coupon.discount_value, STORE_CURRENCY)
                          : "",
                      minSubtotal: coupon.min_subtotal_minor
                        ? toDecimalInput(coupon.min_subtotal_minor, STORE_CURRENCY)
                        : "",
                      maxDiscount: toDecimalInput(coupon.max_discount_minor, STORE_CURRENCY),
                      usageLimit: coupon.usage_limit ? String(coupon.usage_limit) : "",
                      usageLimitPerCustomer: coupon.usage_limit_per_customer
                        ? String(coupon.usage_limit_per_customer)
                        : "",
                      startsAt: isoToDateTimeInput(coupon.starts_at),
                      endsAt: isoToDateTimeInput(coupon.ends_at),
                    }}
                  />
                ) : null}
                {manage && !coupon.disabled_by_admin_at ? (
                  <ActionButton
                    size="sm"
                    variant="ghost"
                    action={setCouponActive.bind(null, { couponId: coupon.id, active: !coupon.is_active })}
                  >
                    {coupon.is_active ? "Pause" : "Resume"}
                  </ActionButton>
                ) : null}
                {viewer === "admin" && !coupon.disabled_by_admin_at ? (
                  <AdminDisableDialog id={coupon.id} kind="coupon" />
                ) : null}
                {viewer === "admin" && coupon.disabled_by_admin_at ? (
                  <ActionButton size="sm" variant="ghost" action={adminEnableCoupon.bind(null, coupon.id)}>
                    Re-enable
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
