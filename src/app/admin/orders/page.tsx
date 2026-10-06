import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { listOrdersForAdmin } from "@/features/orders/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import type { Enums } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Orders" };

const STATUSES: Enums<"order_status">[] = [
  "pending",
  "confirmed",
  "processing",
  "fulfilled",
  "completed",
  "cancelled",
  "refunded",
];
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.orders);
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Enums<"order_status">)
    ? (params.status as Enums<"order_status">)
    : null;
  const orders = await listOrdersForAdmin(status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Commerce"
        title="Orders"
        description="Every customer checkout across the marketplace, with its vendor split."
      />
      <div className="flex flex-wrap gap-1">
        <Button asChild size="sm" variant={status ? "ghost" : "primary"}>
          <Link href={ROUTES.admin.orders}>All</Link>
        </Button>
        {STATUSES.map((value) => (
          <Button key={value} asChild size="sm" variant={status === value ? "primary" : "ghost"}>
            <Link href={`${ROUTES.admin.orders}?status=${value}`} className="capitalize">
              {value}
            </Link>
          </Button>
        ))}
      </div>
      {orders.length === 0 ? (
        <EmptyState title="No orders" description="Orders appear here as customers check out." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Vendors</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link href={ROUTES.admin.order(order.id)} className="font-medium text-ink hover:underline">
                    {order.order_number}
                  </Link>
                  <p className="text-xs text-ink-faint">{dateFormat.format(new Date(order.placed_at))}</p>
                </TableCell>
                <TableCell className="text-ink-soft">{order.customer_email}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <OrderStatusBadge status={order.status} />
                    <PaymentStatusBadge status={order.payment_status} />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{order.vendor_orders.length}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(order.total_minor, order.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
