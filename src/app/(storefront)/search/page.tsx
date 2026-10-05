import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Pagination } from "@/components/shared/pagination";
import { StorageImage } from "@/components/shared/storage-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { listProducts, searchStoresAndBrands } from "@/features/catalog/queries";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { catalogQuerySchema } from "@/lib/validation";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const query = catalogQuerySchema.parse(await searchParams);
  const term = query.q ?? "";
  const [page, related] = term ? await Promise.all([listProducts(query), searchStoresAndBrands(term)]) : [null, null];
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.search, query, overrides);

  return (
    <div className="container-editorial flex flex-col gap-8 py-12 md:py-16">
      <form action={ROUTES.search} method="get" role="search" className="flex max-w-2xl flex-col gap-3 sm:flex-row">
        <label htmlFor="q" className="sr-only">
          Search products, brands and stores
        </label>
        <Input
          id="q"
          name="q"
          type="search"
          defaultValue={term}
          placeholder="Search products, brands, stores…"
          autoFocus={!term}
          className="h-12 text-base"
        />
        <Button type="submit" size="lg">
          <Search /> Search
        </Button>
      </form>

      {!term ? (
        <p className="text-sm text-ink-soft">Try a material, a garment or a brand name.</p>
      ) : (
        <>
          {related && (related.stores.length > 0 || related.brands.length > 0) ? (
            <section className="flex flex-col gap-3">
              <p className="eyebrow">Stores & brands</p>
              <ul className="flex flex-wrap gap-3">
                {related.stores.map((store) => (
                  <li key={`store-${store.slug}`}>
                    <Link
                      href={ROUTES.store(store.slug)}
                      className="flex items-center gap-3 rounded-full border border-line py-1.5 pr-4 pl-1.5 text-sm transition-colors hover:border-ink"
                    >
                      <StorageImage
                        bucket={STORAGE_BUCKETS.vendorLogos}
                        path={store.logo_path}
                        alt=""
                        className="size-8 rounded-full"
                        sizes="32px"
                      />
                      {store.name}
                    </Link>
                  </li>
                ))}
                {related.brands.map((brand) => (
                  <li key={`brand-${brand.slug}`}>
                    <Link
                      href={ROUTES.brand(brand.slug)}
                      className="flex items-center rounded-full border border-line px-4 py-2 text-sm transition-colors hover:border-ink"
                    >
                      {brand.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {page ? (
            <>
              <CatalogToolbar query={query} total={page.total} hrefWith={hrefWith} />
              <ProductGrid
                items={page.items}
                emptyTitle={`No results for “${term}”`}
                emptyDescription="Check the spelling or try a broader term."
              />
              <Pagination
                page={page.page}
                pageCount={page.pageCount}
                hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
