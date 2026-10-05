import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { categorySubtreeIds, getCategories, listProducts } from "@/features/catalog/queries";
import { createClient } from "@/lib/supabase/server";
import { catalogQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("name, description").eq("slug", slug).maybeSingle();
  return { title: data?.name ?? "Category", description: data?.description ?? undefined };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/category/[slug]">) {
  const [{ slug }, rawQuery] = await Promise.all([params, searchParams]);
  const categories = await getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const query = catalogQuerySchema.parse({ ...rawQuery, category: undefined });
  const children = categories.filter((c) => c.parent_id === category.id);
  const parent = category.parent_id ? categories.find((c) => c.id === category.parent_id) : undefined;
  const page = await listProducts(query, { categoryIds: categorySubtreeIds(categories, category.id) });
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.category(slug), query, overrides);

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      {parent ? (
        <Link href={ROUTES.category(parent.slug)} className="-mb-4 eyebrow hover:text-ink">
          ← {parent.name}
        </Link>
      ) : null}
      <PageHeader
        eyebrow={parent ? undefined : "Department"}
        title={category.name}
        description={category.description ?? undefined}
      />
      {children.length > 0 ? (
        <nav aria-label="Subcategories" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {children.map((child) => (
            <Link
              key={child.id}
              href={ROUTES.category(child.slug)}
              className="shrink-0 rounded-full border border-line px-4 py-1.5 text-sm transition-colors hover:border-ink"
            >
              {child.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <CatalogToolbar query={query} total={page.total} hrefWith={hrefWith} />
      <ProductGrid
        items={page.items}
        emptyTitle={`Nothing in ${category.name} yet`}
        emptyDescription="Vendors are still adding to this department."
      />
      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
      />
    </div>
  );
}
