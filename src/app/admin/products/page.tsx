import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductStatusBadge } from "@/components/shared/status-badge";
import { StorageImage } from "@/components/shared/storage-image";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { ProductModerationControls } from "@/features/admin/components/product-moderation";
import { requireRole } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { ProductStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Product moderation" };

const STATUSES: ProductStatus[] = ["pending_review", "active", "rejected", "draft", "archived"];

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin/products">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.products);
  const params = await searchParams;
  const status = STATUSES.includes(params.status as ProductStatus)
    ? (params.status as ProductStatus)
    : "pending_review";
  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("products")
    .select(
      "id, name, slug, status, currency, short_description, rejection_reason, updated_at, vendors!products_vendor_id_fkey(display_name), categories!products_category_id_fkey(name), product_variants(price_minor, is_active), product_images(storage_path, is_primary, position)",
    )
    .eq("status", status)
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) throw fromPostgrestError(error);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="Product moderation"
        description="Products submitted by vendors are reviewed here before going live."
      />
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((value) => (
          <Button key={value} asChild size="sm" variant={status === value ? "primary" : "ghost"}>
            <Link href={`${ROUTES.admin.products}?status=${value}`} className="capitalize">
              {value.replace("_", " ")}
            </Link>
          </Button>
        ))}
      </div>

      {products && products.length > 0 ? (
        <ul className="grid gap-4">
          {products.map((product) => {
            const prices = product.product_variants.filter((v) => v.is_active).map((v) => v.price_minor);
            const primary = [...product.product_images].sort(
              (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position,
            )[0];
            return (
              <li
                key={product.id}
                className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[6rem_1fr_auto] sm:items-start"
              >
                <StorageImage
                  bucket={STORAGE_BUCKETS.productImages}
                  path={primary?.storage_path}
                  alt=""
                  className="aspect-[4/5] w-24 rounded-md"
                  sizes="96px"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium text-ink">{product.name}</h2>
                    <ProductStatusBadge status={product.status} />
                  </div>
                  <p className="text-xs text-ink-faint">
                    {product.vendors?.display_name ?? "Unknown vendor"}
                    {product.categories?.name ? ` · ${product.categories.name}` : ""} · {prices.length} active variant
                    {prices.length === 1 ? "" : "s"}
                    {prices.length ? ` · from ${formatMoney(Math.min(...prices), product.currency)}` : ""} ·{" "}
                    {product.product_images.length} image
                    {product.product_images.length === 1 ? "" : "s"}
                  </p>
                  {product.short_description ? (
                    <p className="text-sm text-ink-soft">{product.short_description}</p>
                  ) : null}
                  {product.status === "rejected" && product.rejection_reason ? (
                    <p className="text-xs text-danger">Rejected: {product.rejection_reason}</p>
                  ) : null}
                  {product.status === "active" ? (
                    <Link
                      href={ROUTES.product(product.slug)}
                      className="text-xs text-ink underline-offset-4 hover:underline"
                    >
                      View on storefront →
                    </Link>
                  ) : null}
                </div>
                {product.status === "pending_review" ? (
                  <ProductModerationControls productId={product.id} productName={product.name} />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title={`No ${status.replace("_", " ")} products`}
          description={
            status === "pending_review" ? "Nothing is waiting for moderation." : "No products in this state."
          }
        />
      )}
    </div>
  );
}
