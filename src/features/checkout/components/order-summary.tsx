import { formatMoney } from "@/lib/money";
import type { CheckoutQuote } from "../quote";

/** Totals panel shared by the cart and checkout pages. */
export function OrderSummary({ quote, children }: { quote: CheckoutQuote; children?: React.ReactNode }) {
  const { currency } = quote;
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
        <div className="flex justify-between">
          <dt className="text-ink-soft">Shipping</dt>
          <dd className="text-ink-soft">Not charged</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-soft">Tax</dt>
          <dd className="text-ink-soft">Not calculated</dd>
        </div>
        <div className="mt-2 flex justify-between border-t border-line pt-3 text-base">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="font-display text-xl tabular-nums">{formatMoney(quote.total.amountMinor, currency)}</dd>
        </div>
      </dl>
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
