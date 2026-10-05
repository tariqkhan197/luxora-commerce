import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ProductStatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";
import { categoryOptions } from "@/features/catalog/category-options";
import { ProductDetailsForm } from "@/features/catalog/components/product-details-form";
import { ProductImagesManager } from "@/features/catalog/components/product-images-manager";
import { ProductStatusActions } from "@/features/catalog/components/product-status-actions";
import { VariantEditor } from "@/features/catalog/components/variant-editor";
import { getBrands, getCategories } from "@/features/catalog/queries";
import { requireVendorContext } from "@/lib/auth/dal";
import { getClientEnv } from "@/lib/env";
import { fromPostgrestError } from "@/lib/errors";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit product" };

export default async function VendorProductDetailPage({ params }: PageProps<"/vendor/products/[id]">) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { vendor } = await requireVendorContext(ROUTES.vendor.product(id));
  const supabase = await createClient();

  const [
    { data: product, error },
    { data: variants, error: variantError },
    { data: images, error: imageError },
    categories,
    brands,
  ] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).eq("vendor_id", vendor.id).maybeSingle(),
    supabase
      .from("product_variants")
      .select("*, inventory(stock_quantity, reserved_quantity, available_quantity)")
      .eq("product_id", id)
      .order("position")
      .order("created_at"),
    supabase
      .from("product_images")
      .select("id, storage_path, alt_text, is_primary, position")
      .eq("product_id", id)
      .order("is_primary", { ascending: false })
      .order("position"),
    getCategories(),
    getBrands(),
  ]);
  if (error) throw fromPostgrestError(error);
  if (!product) notFound();
  if (variantError) throw fromPostgrestError(variantError);
  if (imageError) throw fromPostgrestError(imageError);

  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const stockByVariant = Object.fromEntries(
    (variants ?? []).map((variant) => [
      variant.id,
      variant.inventory
        ? {
            stock: variant.inventory.stock_quantity,
            reserved: variant.inventory.reserved_quantity,
            available: variant.inventory.available_quantity ?? 0,
          }
        : { stock: 0, reserved: 0, available: 0 },
    ]),
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title={product.name}
        description={product.status === "active" ? "Live on the storefront." : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <ProductStatusBadge status={product.status} />
            <Button asChild size="sm" variant="ghost">
              <Link href={ROUTES.vendor.products}>All products</Link>
            </Button>
            {product.status === "active" ? (
              <Button asChild size="sm" variant="outline">
                <Link href={ROUTES.product(product.slug)}>View</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {product.status === "rejected" && product.rejection_reason ? (
        <Alert variant="destructive">
          <AlertTitle>Changes requested</AlertTitle>
          <AlertDescription>{product.rejection_reason}</AlertDescription>
        </Alert>
      ) : null}
      {product.status === "pending_review" ? (
        <Alert variant="info">
          <AlertTitle>Awaiting review</AlertTitle>
          <AlertDescription>
            Our team reviews new products before they go live. You can still edit details in the meantime.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Publishing</CardTitle>
          <CardDescription>
            Submit for review once the product has at least one active variant and one image.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductStatusActions productId={product.id} status={product.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variants & pricing</CardTitle>
          <CardDescription>
            Each variant has its own SKU, price and inventory record. Stock changes live in Inventory.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VariantEditor
            productId={product.id}
            productStatus={product.status}
            currency={product.currency}
            variants={variants ?? []}
            stockByVariant={stockByVariant}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
          <CardDescription>Portrait 4:5 images look best. JPEG, PNG, WebP or AVIF up to 10 MB each.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductImagesManager
            productId={product.id}
            vendorId={vendor.id}
            images={(images ?? []).map((image) => ({
              id: image.id,
              url: storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.productImages, image.storage_path),
              altText: image.alt_text,
              isPrimary: image.is_primary,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Name, category, description and tags. Currency is fixed once the product exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProductDetailsForm
            product={product}
            categories={categoryOptions(categories)}
            brands={brands}
            defaultCurrency={vendor.default_currency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
