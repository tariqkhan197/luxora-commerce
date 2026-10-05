import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { StorageImage } from "@/components/shared/storage-image";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { listProducts } from "@/features/catalog/queries";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { catalogQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: PageProps<"/brand/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("brands").select("name, description").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Brand", description: data?.description ?? undefined };
}

export default async function BrandPage({ params, searchParams }: PageProps<"/brand/[slug]">) {
  const [{ slug }, rawQuery] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: brand } = await supabase
    .from("brands")
    .select("id, name, description, logo_path, website_url, is_verified")
    .eq("slug", slug)
    .maybeSingle();
  if (!brand) notFound();

  const query = catalogQuerySchema.parse({ ...rawQuery, brand: undefined });
  const page = await listProducts(query, { brandId: brand.id });
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.brand(slug), query, overrides);

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <StorageImage
          bucket={STORAGE_BUCKETS.vendorLogos}
          path={brand.logo_path}
          alt={`${brand.name} logo`}
          className="size-24 shrink-0 rounded-lg"
          sizes="96px"
        />
        <PageHeader
          eyebrow="Brand"
          title={brand.name}
          description={brand.description ?? undefined}
          actions={brand.is_verified ? <Badge variant="accent">Verified</Badge> : undefined}
          className="flex-1"
        />
      </div>
      <CatalogToolbar query={query} total={page.total} hrefWith={hrefWith} />
      <ProductGrid items={page.items} emptyTitle={`No ${brand.name} pieces yet`} />
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
      />
    </div>
  );
}
