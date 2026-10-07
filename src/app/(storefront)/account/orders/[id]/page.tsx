import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { OrderStatusBadge, PaymentStatusBadge, VendorOrderStatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DUTIES_AND_TAXES_NOTICE } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { AddressBlock } from "@/features/addresses/components/address-card";
import { addressLines, asAddress } from "@/features/addresses/format";
import { cancelOrder } from "@/features/checkout/actions";
import { OrderLineItems } from "@/features/orders/components/order-line-items";
import { PaymentNotice } from "@/features/orders/components/payment-notice";
import { getOrderDetail } from "@/features/orders/queries";
import { requireUser } from "@/lib/auth/dal";
import { formatMoney } from "@/lib/money";
import { uuidSchema } from "@/lib/validation";
import { formatDateTimeUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Order details" };

const CANCELLATION_COPY: Record<string, string> = {
  checkout_expired: "The reservation expired before payment, so the items were released.",
  cancelled_by_customer: "You cancelled this order.",
  cancelled_by_admin: "This order was cancelled by Luxora.",
};

export default async function OrderDetailPage({ params, searchParams }: PageProps<"/account/orders/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!uuidSchema.safeParse(id).success) notFound();
  const { profile } = await requireUser(ROUTES.account.order(id));
  const order = await getOrderDetail(id);
  // RLS already hides other customers' orders; the explicit check also keeps admins on their own account view.
  if (!order || order.customer_id !== profile.id) notFound();

  const awaitingPayment = order.status === "pending" && order.payment_status === "pending";
  const vendorOrders = [...order.vendor_orders].sort((a, b) =>
    a.vendor_order_number.localeCompare(b.vendor_order_number),
  );

  return (
    <div className="flex flex-col gap-8">
      {query.placed === "1" && awaitingPayment ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>Order placed</AlertTitle>
          <AlertDescription>
            Your items are reserved. A confirmation is shown below; nothing has been charged.
          </AlertDescription>
        </Alert>
      ) : null}

      <PageHeader
        eyebrow={`Placed ${formatDateTimeUtc(new Date(order.placed_at))}`}
        title={order.order_number}
        actions={
          <div className="flex flex-wrap gap-2">
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.payment_status} />
          </div>
        }
      />

      {awaitingPayment ? (
        <div className="flex flex-col gap-3">
          <PaymentNotice reservationExpiresAt={order.reservation_expires_at} />
          <ActionButton
            variant="outline"
            size="sm"
            confirmMessage="Cancel this order and release the items?"
            action={cancelOrder.bind(null, order.id)}
          >
            Cancel order
          </ActionButton>
        </div>
      ) : null}
      {order.status === "cancelled" ? (
        <Alert>
          <AlertTitle>Order cancelled</AlertTitle>
          <AlertDescription>
            {CANCELLATION_COPY[order.cancellation_reason ?? ""] ?? "This order was cancelled."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          {vendorOrders.map((vendorOrder) => (
            <Card key={vendorOrder.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Shipment {vendorOrder.vendor_order_number}</p>
                    <CardTitle className="mt-1">{vendorOrder.vendors?.display_name ?? "Vendor"}</CardTitle>
                  </div>
                  <VendorOrderStatusBadge status={vendorOrder.status} />
                </div>
                {vendorOrder.tracking_number ? (
                  <p className="text-sm text-ink-soft">
                    {vendorOrder.carrier ?? "Carrier"} ·{" "}
                    {vendorOrder.tracking_url ? (
                      <a
                        href={vendorOrder.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink underline-offset-4 hover:underline"
                      >
                        {vendorOrder.tracking_number}
                      </a>
                    ) : (
                      vendorOrder.tracking_number
                    )}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent>
                <OrderLineItems items={vendorOrder.order_items} currency={order.currency} />
                <p className="mt-2 flex justify-between border-t border-line pt-3 text-sm">
                  <span className="text-ink-soft">Shipment subtotal</span>
                  <span className="tabular-nums">{formatMoney(vendorOrder.total_minor, order.currency)}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Subtotal</dt>
                  <dd className="tabular-nums">{formatMoney(order.subtotal_minor, order.currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Shipping</dt>
                  <dd className="tabular-nums">{formatMoney(order.shipping_minor, order.currency)}</dd>
                </div>
                {order.tax_minor > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">Tax</dt>
                    <dd className="tabular-nums">{formatMoney(order.tax_minor, order.currency)}</dd>
                  </div>
                ) : null}
                <div className="mt-2 flex justify-between border-t border-line pt-3">
                  <dt className="font-medium">Total</dt>
                  <dd className="font-display text-xl tabular-nums">
                    {formatMoney(order.total_minor, order.currency)}
                  </dd>
                </div>
              </dl>
              {order.tax_minor === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">{DUTIES_AND_TAXES_NOTICE}</p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <AddressBlock title="Ship to" lines={addressLines(asAddress(order.shipping_address))} />
              <AddressBlock title="Bill to" lines={addressLines(asAddress(order.billing_address))} />
              {order.customer_note ? (
                <div>
                  <p className="mb-2 eyebrow">Note</p>
                  <p className="text-sm whitespace-pre-line text-ink-soft">{order.customer_note}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Link href={ROUTES.account.orders} className="text-sm text-ink-soft underline-offset-4 hover:underline">
            ← All orders
          </Link>
        </aside>
      </div>
    </div>
  );
}
