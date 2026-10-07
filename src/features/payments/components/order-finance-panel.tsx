import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { OrderFinance } from "../queries";

function label(value: string) {
  return value.replace(/_/g, " ");
}

/** Admin view of everything money-related on one order. */
export function OrderFinancePanel({ finance, currency }: { finance: OrderFinance; currency: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments &amp; refunds</CardTitle>
        <CardDescription>
          Stripe test mode. Amounts are recorded by the database from verified webhooks.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <section className="grid gap-2">
          <h3 className="eyebrow">Payments</h3>
          {finance.payments.length ? (
            finance.payments.map((payment) => (
              <dl key={payment.id} className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-ink-soft">Reference</dt>
                <dd className="truncate font-mono text-xs">{payment.provider_payment_id}</dd>
                <dt className="text-ink-soft">Status</dt>
                <dd className="capitalize">{label(payment.status)}</dd>
                <dt className="text-ink-soft">Amount</dt>
                <dd className="tabular-nums">{formatMoney(payment.amount_minor, payment.currency)}</dd>
                <dt className="text-ink-soft">Processing fee (platform)</dt>
                <dd className="tabular-nums">{formatMoney(payment.fee_minor, payment.currency)}</dd>
                <dt className="text-ink-soft">Refunded</dt>
                <dd className="tabular-nums">{formatMoney(payment.refunded_minor, payment.currency)}</dd>
              </dl>
            ))
          ) : (
            <p className="text-ink-faint">No payment recorded.</p>
          )}
        </section>

        {finance.attempts.length ? (
          <section className="grid gap-2">
            <h3 className="eyebrow">Checkout attempts</h3>
            <ul className="grid gap-1">
              {finance.attempts.map((attempt) => (
                <li key={attempt.attempt_no} className="flex justify-between gap-3">
                  <span>
                    #{attempt.attempt_no} · <span className="capitalize">{attempt.status}</span>
                  </span>
                  <span className="text-xs text-ink-faint">
                    expires {formatDateTimeUtc(new Date(attempt.expires_at))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {finance.refunds.length ? (
          <section className="grid gap-2">
            <h3 className="eyebrow">Refunds</h3>
            <ul className="grid gap-3">
              {finance.refunds.map((refund) => (
                <li key={refund.id} className="grid gap-1 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {formatMoney(refund.amount_minor, refund.currency)}
                    </span>
                    <div className="flex gap-1">
                      <Badge variant="outline">{label(refund.kind)}</Badge>
                      <Badge
                        variant={
                          refund.status === "completed" ? "success" : refund.status === "failed" ? "danger" : "warning"
                        }
                      >
                        {label(refund.status)}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-xs text-ink-soft">{refund.reason}</p>
                  {refund.refund_items.length ? (
                    <p className="text-xs text-ink-faint">
                      {refund.refund_items
                        .map((item) => `${item.quantity} × ${item.order_items?.product_name ?? "item"}`)
                        .join(", ")}
                      {refund.shipping_minor > 0
                        ? ` + shipping ${formatMoney(refund.shipping_minor, refund.currency)}`
                        : ""}
                    </p>
                  ) : null}
                  {refund.failure_message ? <p className="text-xs text-danger">{refund.failure_message}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {finance.disputes.length ? (
          <section className="grid gap-2">
            <h3 className="eyebrow">Disputes</h3>
            {finance.disputes.map((dispute) => (
              <p key={dispute.provider_dispute_id}>
                {formatMoney(dispute.amount_minor, dispute.currency)} ·{" "}
                <span className="capitalize">{label(dispute.status)}</span>
                {dispute.reason ? ` · ${label(dispute.reason)}` : ""}
              </p>
            ))}
          </section>
        ) : null}

        {finance.ledger.length ? (
          <section className="grid gap-2">
            <h3 className="eyebrow">Platform ledger</h3>
            <ul className="grid gap-1">
              {finance.ledger.map((entry) => (
                <li key={entry.id} className="flex justify-between gap-3">
                  <span className="text-ink-soft capitalize">{label(entry.entry_type)}</span>
                  <span className={entry.amount_minor < 0 ? "text-danger tabular-nums" : "tabular-nums"}>
                    {formatMoney(entry.amount_minor, entry.currency ?? currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
