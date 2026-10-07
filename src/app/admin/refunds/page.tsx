import type { Metadata } from "next";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { listRefunds } from "@/features/payments/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatDateTimeUtc } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Refunds" };

export default async function AdminRefundsPage() {
  await requireRole(["admin", "super_admin"], ROUTES.admin.refunds);
  const refunds = await listRefunds();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Finance"
        title="Refunds"
        description="Every refund, including automatic refunds of late payments and refunds made in the Stripe Dashboard. Issue new refunds from an order's page."
      />
      {refunds.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunds.map((refund) => (
              <TableRow key={refund.id}>
                <TableCell>
                  <Link
                    href={ROUTES.admin.order(refund.order_id)}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {refund.vendor_orders?.vendor_order_number ?? refund.orders?.order_number ?? "Order"}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{formatDateTimeUtc(new Date(refund.created_at))}</TableCell>
                <TableCell className="capitalize">{refund.kind.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(refund.amount_minor, refund.currency)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      refund.status === "completed" ? "success" : refund.status === "failed" ? "danger" : "warning"
                    }
                  >
                    {refund.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-xs text-ink-soft">
                  {refund.failure_message ?? refund.reason}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState icon={<Undo2 />} title="No refunds yet" description="Refunds issued from an order appear here." />
      )}
    </div>
  );
}
