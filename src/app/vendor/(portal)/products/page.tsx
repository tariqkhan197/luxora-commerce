import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ProductStatusBadge } from "@/components/shared/status-badge";
import { StorageImage } from "@/components/shared/storage-image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROUTES } from "@/config/routes";
import { requireVendorContext } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { ProductStatus } from "@/lib/supabase/database.types";

export const metadata: Metadata = { title: "Products" };

const STATUSES: ProductStatus[] = ["draft", "pending_review", "active", "rejected", "archived"];
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function VendorProductsPage({ searchParams }: PageProps<"/vendor/products">) {
  const { vendor } = await requireVendorContext(ROUTES.vendor.products);
  const params = await searchParams;
  const status = STATUSES.includes(params.status as ProductStatus) ? (params.status as ProductStatus) : null;
  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select(
      "id, name, status, currency, updated_at, product_variants(price_minor, is_active), product_images(storage_path, is_primary, position)",
    )
    .eq("vendor_id", vendor.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  const { data: products, error } = await query;
  if (error) throw fromPostgrestError(error);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Catalog"
        title="Products"
        description="Create products, add variants and images, then submit them for review."
        actions={
          vendor.status === "approved" ? (
            <Button asChild>
              <Link href={ROUTES.vendor.newProduct}>
                <Plus /> New product
              </Link>
            </Button>
          ) : null
        }
      />

      {vendor.status !== "approved" ? (
        <Alert variant="info">
          <AlertTitle>Vendor account {vendor.status}</AlertTitle>
          <AlertDescription>Products can be created once your vendor account is approved.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-1">
        <Button asChild size="sm" variant={status ? "ghost" : "primary"}>
          <Link href={ROUTES.vendor.products}>All</Link>
        </Button>
        {STATUSES.map((value) => (
          <Button key={value} asChild size="sm" variant={status === value ? "primary" : "ghost"}>
            <Link href={`${ROUTES.vendor.products}?status=${value}`} className="capitalize">
              {value.replace("_", " ")}
            </Link>
          </Button>
        ))}
      </div>

      {products && products.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Variants</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const prices = product.product_variants.filter((v) => v.is_active).map((v) => v.price_minor);
              const primary = [...product.product_images].sort(
                (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position,
              )[0];
              return (
                <TableRow key={product.id}>
                  <TableCell>
                    <Link href={ROUTES.vendor.product(product.id)} className="flex items-center gap-3">
                      <StorageImage
                        bucket={STORAGE_BUCKETS.productImages}
                        path={primary?.storage_path}
                        alt=""
                        className="size-12 shrink-0 rounded-md"
                        sizes="48px"
                      />
                      <span className="font-medium text-ink hover:underline">{product.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ProductStatusBadge status={product.status} />
                  </TableCell>
                  <TableCell>
                    {prices.length ? (
                      formatMoney(Math.min(...prices), product.currency)
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell>{product.product_variants.length}</TableCell>
                  <TableCell>{dateFormat.format(new Date(product.updated_at))}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={status ? `No ${status.replace("_", " ")} products` : "No products yet"}
          description="Your catalog starts with a single product. Add variants for sizes or colours, upload images and submit for review."
          action={
            vendor.status === "approved" ? (
              <Button asChild>
                <Link href={ROUTES.vendor.newProduct}>Create your first product</Link>
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
