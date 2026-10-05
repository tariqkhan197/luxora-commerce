import Link from "next/link";
import { CATALOG_SORTS, type CatalogQuery, type CatalogSort } from "@/lib/validation";
import { cn } from "@/lib/utils";

const SORT_LABELS: Record<CatalogSort, string> = {
  newest: "Newest",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  name: "Name",
};

interface CatalogToolbarProps {
  query: CatalogQuery;
  total: number;
  /** Builds an href with the given overrides applied to the current query. */
  hrefWith: (overrides: Partial<Record<"sort" | "inStock" | "page" | "category" | "brand", string | null>>) => string;
  categories?: { slug: string; name: string }[];
}

/** Server-rendered filter bar: every control is a link, so it works without JavaScript. */
export function CatalogToolbar({ query, total, hrefWith, categories }: CatalogToolbarProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">
          {total} {total === 1 ? "piece" : "pieces"}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-2 eyebrow">Sort</span>
          {CATALOG_SORTS.map((sort) => (
            <Link
              key={sort}
              href={hrefWith({ sort, page: null })}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                query.sort === sort ? "bg-ink text-canvas" : "text-ink-soft hover:bg-surface-muted hover:text-ink",
              )}
            >
              {SORT_LABELS[sort]}
            </Link>
          ))}
          <Link
            href={hrefWith({ inStock: query.inStock ? null : "1", page: null })}
            className={cn(
              "ml-2 rounded-full border px-3 py-1 text-xs transition-colors",
              query.inStock
                ? "border-ink bg-ink text-canvas"
                : "border-line text-ink-soft hover:border-ink hover:text-ink",
            )}
            aria-pressed={query.inStock}
          >
            In stock only
          </Link>
        </div>
      </div>
      {categories && categories.length > 0 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Link
            href={hrefWith({ category: null, page: null })}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs",
              !query.category ? "border-ink bg-ink text-canvas" : "border-line text-ink-soft hover:border-ink",
            )}
          >
            All
          </Link>
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={hrefWith({ category: category.slug, page: null })}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs",
                query.category === category.slug
                  ? "border-ink bg-ink text-canvas"
                  : "border-line text-ink-soft hover:border-ink",
              )}
            >
              {category.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Serialises a catalog query back into a search string. */
export function buildCatalogHref(
  basePath: string,
  query: CatalogQuery,
  overrides: Partial<Record<string, string | null>> = {},
): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | null | undefined> = {
    q: query.q,
    category: query.category,
    brand: query.brand,
    store: query.store,
    sort: query.sort === "newest" ? null : query.sort,
    inStock: query.inStock ? "1" : null,
    page: query.page > 1 ? String(query.page) : null,
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
