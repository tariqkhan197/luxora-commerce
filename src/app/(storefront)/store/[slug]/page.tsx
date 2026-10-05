import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/shared/pagination";
import { StorageImage } from "@/components/shared/storage-image";
import { ROUTES } from "@/config/routes";
import { buildCatalogHref, CatalogToolbar } from "@/features/catalog/components/catalog-toolbar";
import { ProductGrid } from "@/features/catalog/components/product-grid";
import { listProducts } from "@/features/catalog/queries";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { catalogQuerySchema } from "@/lib/validation";

export async function generateMetadata({ params }: PageProps<"/store/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("stores")
    .select("name, seo_title, seo_description, tagline")
    .eq("slug", slug)
    .maybeSingle();
  return {
    title: data?.seo_title ?? data?.name ?? "Store",
    description: data?.seo_description ?? data?.tagline ?? undefined,
  };
}

/** Only published stores of approved vendors are visible here (enforced by RLS). */
export default async function StorePage({ params, searchParams }: PageProps<"/store/[slug]">) {
  const [{ slug }, rawQuery] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("vendor_id, name, tagline, description, logo_path, cover_path, shipping_policy, return_policy")
    .eq("slug", slug)
    .maybeSingle();
  if (!store) notFound();

  const query = catalogQuerySchema.parse({ ...rawQuery, store: undefined });
  const page = await listProducts(query, { vendorId: store.vendor_id });
  const hrefWith = (overrides: Partial<Record<string, string | null>>) =>
    buildCatalogHref(ROUTES.store(slug), query, overrides);

  return (
    <>
      <section className="relative border-b border-line">
        <StorageImage
          bucket={STORAGE_BUCKETS.vendorCovers}
          path={store.cover_path}
          alt=""
          className="h-48 w-full md:h-72 lg:h-80"
          sizes="100vw"
          priority
        />
        <div className="relative container-editorial -mt-10 flex flex-col gap-5 pb-10 md:-mt-12 md:flex-row md:items-end md:gap-8">
          <StorageImage
            bucket={STORAGE_BUCKETS.vendorLogos}
            path={store.logo_path}
            alt={`${store.name} logo`}
            className="size-20 rounded-lg border-4 border-canvas md:size-24"
            sizes="96px"
          />
          <div className="flex-1">
            <p className="mb-2 eyebrow">Store</p>
            <h1 className="display-2">{store.name}</h1>
            {store.tagline ? <p className="mt-2 text-base text-ink-soft">{store.tagline}</p> : null}
          </div>
        </div>
      </section>

      <div className="container-editorial grid gap-10 py-12 md:py-16 lg:grid-cols-[18rem_1fr]">
        <aside className="flex flex-col gap-8 text-sm leading-relaxed text-ink-soft lg:border-r lg:border-line lg:pr-8">
          {store.description ? (
            <section>
              <p className="mb-3 eyebrow">About</p>
              <p className="whitespace-pre-line">{store.description}</p>
            </section>
          ) : null}
          {store.shipping_policy ? (
            <section>
              <p className="mb-3 eyebrow">Shipping</p>
              <p className="whitespace-pre-line">{store.shipping_policy}</p>
            </section>
          ) : null}
          {store.return_policy ? (
            <section>
              <p className="mb-3 eyebrow">Returns</p>
              <p className="whitespace-pre-line">{store.return_policy}</p>
            </section>
          ) : null}
          {!store.description && !store.shipping_policy && !store.return_policy ? (
            <p className="text-ink-faint">This store has not added a description yet.</p>
          ) : null}
        </aside>
        <div className="flex flex-col gap-8">
          <CatalogToolbar query={query} total={page.total} hrefWith={hrefWith} />
          <ProductGrid
            items={page.items}
            emptyTitle={`${store.name} hasn't listed products yet`}
            emptyDescription="Check back soon — the collection is on its way."
          />
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            hrefFor={(p) => hrefWith({ page: p > 1 ? String(p) : null })}
          />
        </div>
      </div>
    </>
  );
}
