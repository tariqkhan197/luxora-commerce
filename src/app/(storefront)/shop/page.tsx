import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { categorySubtreeIds, getCategories, listProducts } from "@/features/catalog/queries";
import { catalogQuerySchema } from "@/lib/validation";

export const metadata: Metadata = {
  title: "Shop",
  description: "Browse every piece on Luxora from independent fashion and lifestyle brands.",
};

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const query = catalogQuerySchema.parse(await searchParams);
  const categories = await getCategories();
  const selected = query.category ? categories.find((c) => c.slug === query.category) : undefined;
  const page = await listProducts(query, {
    categoryIds: selected ? categorySubtreeIds(categories, selected.id) : undefined,
  });
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.shop, query, overrides);

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <PageHeader
        eyebrow="Shop"
        title={selected ? selected.name : "All pieces"}
        description={selected?.description ?? "The complete edit, across every brand and department."}
      />
      <CatalogToolbar
        query={query}
        total={page.total}
        hrefWith={hrefWith}
        categories={categories.filter((c) => c.parent_id === null)}
      />
      <ProductGrid
        items={page.items}
        emptyTitle="The shop is being stocked"
        emptyDescription="Products appear here as soon as vendors publish them."
      />
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
      />
    </div>
  );
}
