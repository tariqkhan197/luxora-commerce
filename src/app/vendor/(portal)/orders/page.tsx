import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { VendorOrderStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { asAddress } from "@/features/addresses/format";
import { listVendorOrders } from "@/features/orders/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import type { Enums } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Orders" };

const STATUSES: Enums<"vendor_order_status">[] = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];
const STATUS_LABEL: Partial<Record<Enums<"vendor_order_status">, string>> = {
  pending: "Awaiting payment",
  confirmed: "To fulfil",
};
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function VendorOrdersPage({ searchParams }: PageProps<"/vendor/orders">) {
  const { vendor } = await requireVendorContext(ROUTES.vendor.orders);
  const params = await searchParams;
  const status = STATUSES.includes(params.status as Enums<"vendor_order_status">)
    ? (params.status as Enums<"vendor_order_status">)
    : null;
  const orders = await listVendorOrders(vendor.id, status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Orders"
        description="Orders for your products only. Ship paid orders; unpaid ones are reserved but must not be fulfilled."
      />
      <div className="flex flex-wrap gap-1">
        <Button asChild size="sm" variant={status ? "ghost" : "primary"}>
          <Link href={ROUTES.vendor.orders}>All</Link>
        </Button>
        {STATUSES.map((value) => (
          <Button key={value} asChild size="sm" variant={status === value ? "primary" : "ghost"}>
            <Link href={`${ROUTES.vendor.orders}?status=${value}`} className="capitalize">
              {STATUS_LABEL[value] ?? value}
            </Link>
          </Button>
        ))}
      </div>
      {orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart />}
          title="No orders here yet"
          description="Orders appear as soon as a customer checks out with your products."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Your earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link href={ROUTES.vendor.order(order.id)} className="font-medium text-ink hover:underline">
                    {order.vendor_order_number}
                  </Link>
                  <p className="text-xs text-ink-faint">{dateFormat.format(new Date(order.created_at))}</p>
                </TableCell>
                <TableCell>{asAddress(order.shipping_address).full_name ?? "—"}</TableCell>
                <TableCell>
                  <VendorOrderStatusBadge status={order.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {order.order_items.reduce((n, item) => n + item.quantity, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(order.total_minor, order.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(order.vendor_earnings_minor, order.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
