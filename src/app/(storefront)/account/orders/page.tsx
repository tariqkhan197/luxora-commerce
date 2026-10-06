import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/shared/status-badge";
import { StorageImage } from "@/components/shared/storage-image";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { listOrdersForCustomer } from "@/features/orders/queries";
import { requireUser } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";

export const metadata: Metadata = { title: "Orders" };

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function OrdersPage() {
  const { profile } = await requireUser(ROUTES.account.orders);
  const orders = await listOrdersForCustomer(profile.id);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Account"
        title="Orders"
        description="Every order you've placed. Pieces from different brands ship separately."
      />
      {orders.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title="No orders yet"
          description="When you place an order it will appear here with its status and shipments."
          action={
            <Button asChild>
              <Link href={ROUTES.shop}>Explore the shop</Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {orders.map((order) => {
            const items = order.vendor_orders.flatMap((vo) => vo.order_items);
            const count = items.reduce((total, item) => total + item.quantity, 0);
            return (
              <li key={order.id}>
                <Link
                  href={ROUTES.account.order(order.id)}
                  className="group flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong sm:flex-row sm:items-center"
                >
                  <div className="flex -space-x-3">
                    {items.slice(0, 3).map((item, index) => (
                      <StorageImage
                        key={index}
                        bucket={STORAGE_BUCKETS.productImages}
                        path={item.image_path}
                        alt=""
                        className="aspect-[4/5] w-12 rounded-md border-2 border-surface"
                        sizes="48px"
                      />
                    ))}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <p className="font-medium text-ink group-hover:underline">{order.order_number}</p>
                    <p className="text-xs text-ink-faint">
                      {dateFormat.format(new Date(order.placed_at))} · {count} {count === 1 ? "item" : "items"} ·{" "}
                      {order.vendor_orders.length} {order.vendor_orders.length === 1 ? "shipment" : "shipments"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderStatusBadge status={order.status} />
                    <PaymentStatusBadge status={order.payment_status} />
                  </div>
                  <p className="font-display text-lg tabular-nums">{formatMoney(order.total_minor, order.currency)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
