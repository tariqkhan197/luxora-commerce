import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/shared/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, PaymentStatusBadge, VendorOrderStatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { AddressBlock } from "@/features/addresses/components/address-card";
import { addressLines, asAddress } from "@/features/addresses/format";
import { cancelOrder } from "@/features/checkout/actions";
import { OrderLineItems } from "@/features/orders/components/order-line-items";
import { getOrderDetail } from "@/features/orders/queries";
import { requireRole } from "@/lib/auth/dal";
import { formatBasisPoints, formatMoney } from "@/lib/money";
import { uuidSchema } from "@/lib/validation";
import { formatDateTimeUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  await requireRole(["admin", "super_admin"], ROUTES.admin.order(id));
  const order = await getOrderDetail(id);
  if (!order) notFound();
  const { currency } = order;
  const vendorOrders = [...order.vendor_orders].sort((a, b) =>
    a.vendor_order_number.localeCompare(b.vendor_order_number),
  );
  const commission = vendorOrders.reduce((total, vo) => total + vo.commission_minor, 0);
  const awaitingPayment = order.status === "pending" && order.payment_status === "pending";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Placed ${formatDateTimeUtc(new Date(order.placed_at))}`}
        title={order.order_number}
        description={order.customer_email}
        actions={
          <div className="flex flex-wrap gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.payment_status} />
          </div>
        }
      />
      {awaitingPayment ? (
        <Card>
          <CardHeader>
            <CardTitle>Awaiting payment</CardTitle>
            <CardDescription>
              Stock is reserved
              {order.reservation_expires_at
                ? ` until ${formatDateTimeUtc(new Date(order.reservation_expires_at))}`
                : ""}
              . No payment provider is enabled, so this order cannot be paid yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionButton
              variant="outline"
              size="sm"
              confirmMessage="Cancel this order and release its reservations? This is audited."
              action={cancelOrder.bind(null, order.id)}
            >
              Cancel order
            </ActionButton>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          {vendorOrders.map((vendorOrder) => (
            <Card key={vendorOrder.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">{vendorOrder.vendor_order_number}</p>
                    <CardTitle className="mt-1">{vendorOrder.vendors?.display_name ?? "Vendor"}</CardTitle>
                  </div>
                  <VendorOrderStatusBadge status={vendorOrder.status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <OrderLineItems items={vendorOrder.order_items} currency={currency} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 border-t border-line pt-3 text-sm sm:grid-cols-4">
                  <dt className="text-ink-soft">Total</dt>
                  <dd className="tabular-nums">{formatMoney(vendorOrder.total_minor, currency)}</dd>
                  <dt className="text-ink-soft">Commission ({formatBasisPoints(vendorOrder.commission_rate_bps)})</dt>
                  <dd className="tabular-nums">{formatMoney(vendorOrder.commission_minor, currency)}</dd>
                  <dt className="text-ink-soft">Payment fee</dt>
                  <dd className="tabular-nums">{formatMoney(vendorOrder.payment_fee_minor, currency)}</dd>
                  <dt className="text-ink-soft">Vendor earnings</dt>
                  <dd className="tabular-nums">{formatMoney(vendorOrder.vendor_earnings_minor, currency)}</dd>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Customer total</dt>
                  <dd className="tabular-nums">{formatMoney(order.total_minor, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Platform commission</dt>
                  <dd className="tabular-nums">{formatMoney(commission, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Payments recorded</dt>
                  <dd className="tabular-nums">
                    {order.payments.length
                      ? order.payments.map((p) => `${p.provider} · ${p.status}`).join(", ")
                      : "None"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <AddressBlock title="Ship to" lines={addressLines(asAddress(order.shipping_address))} />
              <AddressBlock title="Bill to" lines={addressLines(asAddress(order.billing_address))} />
              {order.cancellation_reason ? (
                <AddressBlock title="Cancellation" lines={[order.cancellation_reason.replace(/_/g, " ")]} />
              ) : null}
            </CardContent>
          </Card>
          <Link href={ROUTES.admin.orders} className="text-sm text-ink-soft underline-offset-4 hover:underline">
            ← All orders
          </Link>
        </aside>
      </div>
    </div>
  );
}
