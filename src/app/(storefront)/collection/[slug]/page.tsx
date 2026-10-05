import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { listProducts } from "@/features/catalog/queries";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { catalogQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: PageProps<"/collection/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("collections").select("name, description").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Collection", description: data?.description ?? undefined };
}

export default async function CollectionPage({ params, searchParams }: PageProps<"/collection/[slug]">) {
  const [{ slug }, rawQuery] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: collection } = await supabase
    .from("collections")
    .select("id, name, description")
    .eq("slug", slug)
    .maybeSingle();
  if (!collection) notFound();

  const { data: members, error } = await supabase
    .from("collection_products")
    .select("product_id")
    .eq("collection_id", collection.id)
    .order("position");
  if (error) throw fromPostgrestError(error);

  const query = catalogQuerySchema.parse(rawQuery);
  const page = await listProducts(query, { productIds: (members ?? []).map((m) => m.product_id) });
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.collection(slug), query, overrides);

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <PageHeader eyebrow="Collection" title={collection.name} description={collection.description ?? undefined} />
      <CatalogToolbar query={query} total={page.total} hrefWith={hrefWith} />
      <ProductGrid
        items={page.items}
        emptyTitle="This collection is being curated"
        emptyDescription="Pieces will appear here once they are selected and published."
      />
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
      />
    </div>
  );
}
