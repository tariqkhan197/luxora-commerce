import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STORE_CURRENCY } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { VendorRateForm } from "@/features/shipping/components/vendor-rate-form";
import { getVendorShippingSetup } from "@/features/shipping/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { countryName } from "@/lib/countries";
import { toDecimalInput } from "@/lib/money";

export const metadata: Metadata = { title: "Shipping" };

export default async function VendorShippingPage() {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.shipping);
  const { zones, rates, canShip } = await getVendorShippingSetup(vendor.id);
  const canManage = memberRole === "owner" || memberRole === "manager";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Shipping"
        description={`Set what shoppers pay for shipping in each zone Luxora serves. Prices are in ${STORE_CURRENCY}: one price for the first item and one for each additional item in the same order, with optional free shipping above an order subtotal. Shipping is added to your order total and is not subject to commission.`}
      />

      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can change shipping rates.</AlertDescription>
        </Alert>
      ) : null}

      {zones.length > 0 && !canShip ? (
        <Alert variant="info">
          <AlertTitle>Set up at least one zone</AlertTitle>
          <AlertDescription>
            Your store cannot be published, and shoppers cannot check out with your products, until you ship to at least
            one zone.
          </AlertDescription>
        </Alert>
      ) : null}

      {zones.length > 0 ? (
        <div className="grid gap-6">
          {zones.map((zone) => {
            const rate = rates.get(zone.id);
            return (
              <Card key={zone.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{zone.name}</CardTitle>
                    <Badge variant={rate?.is_active ? "success" : "neutral"}>
                      {rate?.is_active ? "Shipping" : "Not shipping"}
                    </Badge>
                  </div>
                  <CardDescription>
                    {zone.countries.length
                      ? zone.countries.map((code) => countryName(code)).join(", ")
                      : "No countries in this zone yet."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VendorRateForm
                    zoneId={zone.id}
                    currency={STORE_CURRENCY}
                    readOnly={!canManage}
                    initial={{
                      enabled: rate?.is_active ?? false,
                      firstItem: toDecimalInput(rate?.first_item_minor, STORE_CURRENCY),
                      additionalItem: toDecimalInput(rate?.additional_item_minor ?? 0, STORE_CURRENCY),
                      freeOver: toDecimalInput(rate?.free_shipping_threshold_minor, STORE_CURRENCY),
                      minDays: rate?.min_delivery_days?.toString() ?? "",
                      maxDays: rate?.max_delivery_days?.toString() ?? "",
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Truck />}
          title="No shipping zones yet"
          description="Luxora has not opened any shipping zones yet. Once the marketplace team adds them, you can set your rates here."
        />
      )}

      <p className="text-xs text-ink-faint">
        Shoppers see the shipping cost at checkout, together with the notice that duties and taxes may apply on
        delivery. See the{" "}
        <Link href={ROUTES.legal.shipping} className="underline underline-offset-4">
          shipping policy
        </Link>
        .
      </p>
    </div>
  );
}
