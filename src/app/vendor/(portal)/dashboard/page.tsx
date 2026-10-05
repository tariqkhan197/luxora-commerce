import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { requireVendorContext } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Vendor dashboard" };

const PRODUCT_STATUSES = ["draft", "pending_review", "active", "rejected", "archived"] as const;

export default async function VendorDashboardPage() {
  const { vendor } = await requireVendorContext(ROUTES.vendor.dashboard);
  const supabase = await createClient();

  // Real, RLS-scoped counts. With an empty catalog these are simply zero.
  const [
    { data: products, error: productsError },
    { data: store, error: storeError },
    { data: inventory, error: inventoryError },
  ] = await Promise.all([
    supabase.from("products").select("status").eq("vendor_id", vendor.id),
    supabase.from("stores").select("slug, name, status").eq("vendor_id", vendor.id).maybeSingle(),
    supabase
      .from("inventory")
      .select("available_quantity, low_stock_threshold, track_inventory")
      .eq("vendor_id", vendor.id),
  ]);
  if (productsError) throw fromPostgrestError(productsError);
  if (storeError) throw fromPostgrestError(storeError);
  if (inventoryError) throw fromPostgrestError(inventoryError);
  const lowStock = (inventory ?? []).filter(
    (row) => row.track_inventory && (row.available_quantity ?? 0) <= row.low_stock_threshold,
  ).length;

  const counts = Object.fromEntries(PRODUCT_STATUSES.map((status) => [status, 0])) as Record<
    (typeof PRODUCT_STATUSES)[number],
    number
  >;
  for (const product of products ?? []) counts[product.status] += 1;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title={vendor.display_name}
        description="An overview of your store and catalog."
      />

      {vendor.status !== "approved" ? (
        <Alert variant="info">
          <AlertTitle>Your vendor account is {vendor.status}.</AlertTitle>
          <AlertDescription>Listing and selling products requires an approved vendor account.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Storefront</CardTitle>
            <CardDescription>
              {store ? `${store.name} · ${store.status}` : "No storefront has been created yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {store?.status === "published" ? (
              <Button asChild variant="outline" size="sm">
                <Link href={ROUTES.store(store.slug)}>View public store</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm">
                <Link href={ROUTES.vendor.storefront}>Set up storefront</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catalog</CardTitle>
            <CardDescription>
              <Link href={ROUTES.vendor.products} className="underline-offset-4 hover:underline">
                Products by status
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {PRODUCT_STATUSES.map((status) => (
                <div key={status} className="flex items-baseline justify-between border-b border-line pb-1">
                  <dt className="text-ink-soft capitalize">{status.replace("_", " ")}</dt>
                  <dd className="font-display text-lg">{counts[status]}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
            <CardDescription>
              {inventory?.length
                ? `${inventory.length} variant${inventory.length === 1 ? "" : "s"} tracked · ${lowStock} low on stock`
                : "No inventory records yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href={lowStock ? `${ROUTES.vendor.inventory}?filter=low` : ROUTES.vendor.inventory}>
                Manage inventory
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commission</CardTitle>
            <CardDescription>
              {vendor.commission_rate_bps === null
                ? "Your rate follows category and platform rules."
                : `A vendor-specific rate of ${(vendor.commission_rate_bps / 100).toFixed(2)}% applies.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href={ROUTES.vendor.payouts}>Payouts & statements</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
