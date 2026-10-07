import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { RecordPayoutDialog, ReversePayoutDialog } from "@/features/payments/components/payout-dialogs";
import { getPlatformLedgerSummary, listPayouts, listVendorBalances } from "@/features/payments/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Payouts" };

const PLATFORM_LABELS: Record<string, string> = {
  commission_earned: "Commission earned",
  commission_reversed: "Commission reversed",
  processing_fee: "Payment processing fees",
  refund_loss: "Refunds borne by Luxora",
  dispute_loss: "Disputed payments",
  dispute_fee: "Dispute fees",
  dispute_recovered: "Disputes recovered",
  adjustment: "Adjustments",
};

export default async function AdminPayoutsPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.payouts);
  const [balances, payouts, platform] = await Promise.all([
    listVendorBalances(),
    listPayouts(),
    getPlatformLedgerSummary(),
  ]);
  const platformNet = platform.reduce((sum, row) => sum + row.amountMinor, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Finance"
        title="Payouts"
        description="What Luxora owes each vendor. Earnings become available 14 days after delivery. Vendors are paid outside Stripe; record each transfer here so the ledger stays exact."
      />
      <Alert variant="info">
        <AlertTitle>Test mode</AlertTitle>
        <AlertDescription>
          Payments run in Stripe test mode, so these balances come from test payments. No real money is owed.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Vendor balances</CardTitle>
          <CardDescription>
            Pending: not yet delivered, or inside the 14-day hold. Available: can be paid out now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {balances.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Paid out</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map(({ vendor, balance }) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium text-ink">{vendor.display_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(balance?.pending_minor ?? 0, balance?.currency ?? "USD")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(balance?.available_minor ?? 0, balance?.currency ?? "USD")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(balance?.paid_out_minor ?? 0, balance?.currency ?? "USD")}
                    </TableCell>
                    <TableCell className="text-right">
                      <RecordPayoutDialog
                        vendorId={vendor.id}
                        vendorName={vendor.display_name}
                        availableMinor={balance?.available_minor ?? 0}
                        currency={balance?.currency ?? "USD"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={<Receipt />}
              title="No vendor earnings yet"
              description="Balances appear once orders are paid."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recorded payouts</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((payout) => (
                  <TableRow key={payout.id}>
                    <TableCell>{payout.vendors?.display_name ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {payout.paid_at ? formatDateTimeUtc(new Date(payout.paid_at)) : "—"}
                    </TableCell>
                    <TableCell>{payout.method ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{payout.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(payout.net_minor, payout.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={payout.status === "paid" ? "success" : "neutral"}>
                        {payout.status === "failed" ? "reversed" : payout.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {payout.status === "paid" ? <ReversePayoutDialog payoutId={payout.id} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-ink-faint">No payouts recorded yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platform result</CardTitle>
          <CardDescription>
            Luxora&apos;s side of every paid order: commission in, and the costs Luxora bears under the current policy
            (processing fees, refunds, chargebacks).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {platform.length ? (
            <dl className="grid gap-2 text-sm">
              {platform.map((row) => (
                <div key={row.entryType} className="flex justify-between gap-4">
                  <dt className="text-ink-soft">{PLATFORM_LABELS[row.entryType] ?? row.entryType}</dt>
                  <dd className={row.amountMinor < 0 ? "text-danger tabular-nums" : "tabular-nums"}>
                    {formatMoney(row.amountMinor, "USD")}
                  </dd>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-medium">
                <dt>Net</dt>
                <dd className="tabular-nums">{formatMoney(platformNet, "USD")}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-ink-faint">No platform ledger entries yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
