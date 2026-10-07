import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { getVendorFinance, listPayouts } from "@/features/payments/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Payouts" };

const ENTRY_LABELS: Record<string, string> = {
  order_earning: "Order earnings",
  fee_adjustment: "Fee adjustment",
  refund_debit: "Refund",
  adjustment: "Adjustment",
  payout: "Payout",
  payout_reversal: "Payout reversed",
};

export default async function VendorPayoutsPage() {
  const { vendor } = await requireVendorContext(ROUTES.vendor.payouts);
  const [{ balance, entries }, payouts] = await Promise.all([getVendorFinance(vendor.id), listPayouts(vendor.id)]);
  const currency = balance?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Payouts"
        description="Your earnings are your order totals (items and shipping) minus Luxora's commission on items. They become available 14 days after an order is delivered, and Luxora pays them out to you directly — you do not need a payment-provider account."
      />
      <Alert variant="info">
        <AlertTitle>Test mode</AlertTitle>
        <AlertDescription>
          Payments currently run in test mode, so these figures do not represent real money.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            title: "Pending",
            value: balance?.pending_minor ?? 0,
            hint: "Awaiting delivery or inside the 14-day hold.",
          },
          { title: "Available", value: balance?.available_minor ?? 0, hint: "Ready to be paid out by Luxora." },
          { title: "Paid out", value: balance?.paid_out_minor ?? 0, hint: "Transfers recorded by Luxora." },
        ].map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardDescription>{card.title}</CardDescription>
              <CardTitle className="font-display text-2xl tabular-nums">{formatMoney(card.value, currency)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-ink-faint">{card.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Statement</CardTitle>
          <CardDescription>Every change to your balance, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Available from</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs">
                      {entry.created_at ? formatDateTimeUtc(new Date(entry.created_at)) : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-ink">{ENTRY_LABELS[entry.entry_type ?? ""] ?? entry.entry_type}</span>
                      {entry.vendor_order_number ? (
                        <span className="text-xs text-ink-faint"> · {entry.vendor_order_number}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-ink-soft">
                      {entry.available_at
                        ? entry.isAvailable
                          ? "Available"
                          : formatDateTimeUtc(new Date(entry.available_at))
                        : "After delivery"}
                    </TableCell>
                    <TableCell
                      className={
                        (entry.amount_minor ?? 0) < 0
                          ? "text-right text-danger tabular-nums"
                          : "text-right tabular-nums"
                      }
                    >
                      {formatMoney(entry.amount_minor ?? 0, entry.currency ?? currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<Receipt />}
              title="No earnings yet"
              description="Earnings appear here when customers pay for orders with your products."
            />
          )}
        </CardContent>
      </Card>

      {payouts.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {payouts.map((payout) => (
                <li key={payout.id} className="flex flex-wrap justify-between gap-3">
                  <span>
                    {payout.paid_at ? formatDateTimeUtc(new Date(payout.paid_at)) : "—"} · {payout.method ?? "—"}
                    {payout.status === "failed" ? " · reversed" : ""}
                  </span>
                  <span className="tabular-nums">{formatMoney(payout.net_minor, payout.currency)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
