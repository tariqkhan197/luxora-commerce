import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/shared/action-button";
import { PageHeader } from "@/components/shared/page-header";
import { StoreStatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { StoreBranding } from "@/features/vendors/components/store-branding";
import { StoreSettingsForm } from "@/features/vendors/components/store-settings-form";
import { setStorePublished } from "@/features/vendors/store-actions";
import { requireVendorContext } from "@/lib/auth/dal";
import { getClientEnv } from "@/lib/env";
import { fromPostgrestError } from "@/lib/errors";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Storefront" };

export default async function VendorStorefrontPage() {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.storefront);
  const supabase = await createClient();
  const { data: store, error } = await supabase.from("stores").select("*").eq("vendor_id", vendor.id).maybeSingle();
  if (error) throw fromPostgrestError(error);

  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const canManage = memberRole === "owner" || memberRole === "manager";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Storefront"
        description="How your brand appears to customers: name, story, imagery and policies."
        actions={store ? <StoreStatusBadge status={store.status} /> : null}
      />

      {!canManage ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can change storefront settings.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Store details</CardTitle>
              <CardDescription>Your store URL is public once published.</CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <StoreSettingsForm store={store} fallbackName={vendor.display_name} />
              ) : (
                <dl className="grid gap-2 text-sm">
                  <dt className="eyebrow">Name</dt>
                  <dd>{store?.name ?? "—"}</dd>
                  <dt className="eyebrow">Tagline</dt>
                  <dd>{store?.tagline ?? "—"}</dd>
                </dl>
              )}
            </CardContent>
          </Card>

          {store && canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Branding</CardTitle>
                <CardDescription>Uploads go directly to secure storage under your vendor folder.</CardDescription>
              </CardHeader>
              <CardContent>
                <StoreBranding
                  vendorId={vendor.id}
                  logoUrl={storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.vendorLogos, store.logo_path)}
                  coverUrl={storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.vendorCovers, store.cover_path)}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Visibility</CardTitle>
              <CardDescription>
                {store?.status === "published"
                  ? "Your store is live. Customers can browse your active products."
                  : vendor.status !== "approved"
                    ? "Publishing requires an approved vendor account."
                    : "Your store is hidden until you publish it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-3">
              {store && canManage ? (
                store.status === "published" ? (
                  <ActionButton
                    variant="outline"
                    size="sm"
                    confirmMessage="Unpublish your store? Customers will no longer see it."
                    action={() => setStorePublished({ publish: false })}
                  >
                    Unpublish store
                  </ActionButton>
                ) : (
                  <ActionButton
                    size="sm"
                    disabled={vendor.status !== "approved"}
                    action={() => setStorePublished({ publish: true })}
                  >
                    Publish store
                  </ActionButton>
                )
              ) : null}
              {store?.status === "published" ? (
                <Button asChild variant="link" className="h-auto p-0 text-sm">
                  <Link href={ROUTES.store(store.slug)}>View public store →</Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
