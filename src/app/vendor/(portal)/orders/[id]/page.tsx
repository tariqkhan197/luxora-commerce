import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { VendorOrderStatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { AddressBlock } from "@/features/addresses/components/address-card";
import { addressLines, asAddress } from "@/features/addresses/format";
import { FulfilmentControls } from "@/features/orders/components/fulfilment-form";
import { OrderLineItems } from "@/features/orders/components/order-line-items";
import { getVendorOrderDetail } from "@/features/orders/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { formatBasisPoints, formatMoney } from "@/lib/money";
import { uuidSchema } from "@/lib/validation";
import { formatDateTimeUtc } from "@/lib/format";

export const metadata: Metadata = { title: "Order details" };

export default async function VendorOrderDetailPage({ params }: PageProps<"/vendor/orders/[id]">) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { vendor } = await requireVendorContext(ROUTES.vendor.order(id));
  const order = await getVendorOrderDetail(id, vendor.id);
  if (!order) notFound();
  const { currency } = order;
  // Vendor-funded part of the discounts (a Luxora code is funded by Luxora).
  const vendorDiscount = order.discount_minor + order.shipping_discount_minor - order.platform_funded_minor;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={`Received ${formatDateTimeUtc(new Date(order.created_at))}`}
        title={order.vendor_order_number}
        actions={<VendorOrderStatusBadge status={order.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderLineItems items={order.order_items} currency={currency} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Fulfilment</CardTitle>
              {order.tracking_number ? (
                <CardDescription>
                  Shipped with {order.carrier ?? "carrier"} · {order.tracking_number}
                  {order.shipped_at ? ` · ${formatDateTimeUtc(new Date(order.shipped_at))}` : ""}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              <FulfilmentControls vendorOrderId={order.id} status={order.status} />
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardContent className="pt-6">
              <AddressBlock title="Ship to" lines={addressLines(asAddress(order.shipping_address))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Earnings</CardTitle>
              <CardDescription>
                Fixed when the order was placed; later commission changes do not affect it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Merchandise</dt>
                  <dd className="tabular-nums">{formatMoney(order.subtotal_minor, currency)}</dd>
                </div>
                {vendorDiscount > 0 ? (
                  <div className="flex justify-between">
                    <dt className="text-ink-soft">Your discount code</dt>
                    <dd className="tabular-nums">−{formatMoney(vendorDiscount, currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Shipping charged</dt>
                  <dd className="tabular-nums">{formatMoney(order.shipping_minor, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">
                    Commission on merchandise ({formatBasisPoints(order.commission_rate_bps)})
                  </dt>
                  <dd className="tabular-nums">−{formatMoney(order.commission_minor, currency)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Payment fees</dt>
                  <dd className="tabular-nums">−{formatMoney(order.payment_fee_minor, currency)}</dd>
                </div>
                <div className="mt-2 flex justify-between border-t border-line pt-3">
                  <dt className="font-medium">Your earnings</dt>
                  <dd className="font-display text-xl tabular-nums">
                    {formatMoney(order.vendor_earnings_minor, currency)}
                  </dd>
                </div>
              </dl>
              {order.platform_funded_minor > 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                  The customer used a Luxora code worth {formatMoney(order.platform_funded_minor, currency)} on this
                  order. Luxora pays it, so it does not reduce your earnings or change your commission.
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Link href={ROUTES.vendor.orders} className="text-sm text-ink-soft underline-offset-4 hover:underline">
            ← All orders
          </Link>
        </aside>
      </div>
    </div>
  );
}
