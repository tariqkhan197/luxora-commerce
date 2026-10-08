import Link from "next/link";
import { DUTIES_AND_TAXES_NOTICE } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { formatMoney } from "@/lib/money";
import { deliveryEstimateLabel, type CheckoutQuote } from "../quote";

/** Totals panel shared by the cart and checkout pages. */
export function OrderSummary({
  quote,
  children,
  coupon,
}: {
  quote: CheckoutQuote;
  children?: React.ReactNode;
  /** The discount-code form (bag page) or nothing. */
  coupon?: React.ReactNode;
}) {
  const { currency } = quote;
  const code = quote.promotion?.applied ? quote.promotion.code : null;
  const freeShippingPending =
    quote.promotion?.applied && quote.promotion.discountType === "free_shipping" && !quote.shippingKnown;
  const shippingValue = !quote.shippingKnown
    ? "Calculated at checkout"
    : quote.unshippableGroups.length > 0
      ? "Unavailable"
      : quote.shipping.amountMinor === 0
        ? "Free"
        : formatMoney(quote.shipping.amountMinor, currency);
  const deliveryLabel =
    quote.shippingKnown && quote.groups.length === 1 ? deliveryEstimateLabel(quote.groups[0].deliveryDays) : null;

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 shadow-soft">
      <h2 className="display-3">Summary</h2>
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-soft">
            Subtotal · {quote.itemCount} {quote.itemCount === 1 ? "item" : "items"}
          </dt>
          <dd className="tabular-nums">{formatMoney(quote.subtotal.amountMinor, currency)}</dd>
        </div>
        {quote.discount.amountMinor > 0 ? (
          <div className="flex justify-between gap-4 text-success">
            <dt>Discount{code ? ` (${code})` : ""}</dt>
            <dd className="tabular-nums">−{formatMoney(quote.discount.amountMinor, currency)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-ink-soft">Shipping</dt>
          <dd className={quote.shippingKnown ? "tabular-nums" : "text-right text-ink-soft"}>{shippingValue}</dd>
        </div>
        {quote.shippingKnown && quote.unshippableGroups.length === 0 && quote.groups.length > 1
          ? quote.groups.map((group) => (
              <div key={group.vendorId} className="flex justify-between gap-4 pl-3 text-xs text-ink-faint">
                <dt className="truncate">{group.vendorName}</dt>
                <dd className="tabular-nums">
                  {group.shipping.amountMinor === 0 ? "Free" : formatMoney(group.shipping.amountMinor, currency)}
                </dd>
              </div>
            ))
          : null}
        {quote.shippingDiscount.amountMinor > 0 ? (
          <div className="flex justify-between gap-4 text-success">
            <dt>Free shipping{code ? ` (${code})` : ""}</dt>
            <dd className="tabular-nums">−{formatMoney(quote.shippingDiscount.amountMinor, currency)}</dd>
          </div>
        ) : null}
        {freeShippingPending ? (
          <div className="flex justify-between gap-4 text-xs text-success">
            <dt>Free shipping{code ? ` (${code})` : ""}</dt>
            <dd>Applied at checkout</dd>
          </div>
        ) : null}
        {deliveryLabel ? (
          <div className="flex justify-between gap-4 text-xs text-ink-faint">
            <dt>Estimated delivery</dt>
            <dd>{deliveryLabel}</dd>
          </div>
        ) : null}
        <div className="mt-2 flex justify-between border-t border-line pt-3 text-base">
          <dt className="font-medium text-ink">{quote.shippingKnown ? "Total" : "Total before shipping"}</dt>
          <dd className="font-display text-xl tabular-nums">{formatMoney(quote.total.amountMinor, currency)}</dd>
        </div>
      </dl>
      {coupon}
      <p className="text-xs leading-relaxed text-ink-soft">
        {DUTIES_AND_TAXES_NOTICE}{" "}
        <Link href={ROUTES.legal.shipping} className="underline underline-offset-4">
          Shipping policy
        </Link>
      </p>
      {quote.groups.length > 1 ? (
        <p className="text-xs leading-relaxed text-ink-faint">
          Your bag contains pieces from {quote.groups.length} independent brands. Each ships separately from its own
          studio.
        </p>
      ) : null}
      {children}
    </div>
  );
}
