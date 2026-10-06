import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { ProductGallery } from "@/features/catalog/components/product-gallery";
import { VariantSelector } from "@/features/catalog/components/variant-selector";
import { getProductBySlug } from "@/features/catalog/queries";
import { getClientEnv } from "@/lib/env";
import { STORAGE_BUCKETS, storagePublicUrl } from "@/lib/storage";

export async function generateMetadata({ params }: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await getProductBySlug(slug);
  if (!result) return { title: "Product" };
  return { title: result.listing.name ?? "Product", description: result.listing.short_description ?? undefined };
}

function attributeEntries(value: unknown): [string, string][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => [k, String(v)]);
}

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const result = await getProductBySlug(slug);
  if (!result) notFound();
  const { listing, product, variants, images } = result;
  const supabaseUrl = getClientEnv().NEXT_PUBLIC_SUPABASE_URL;
  const gallery = images
    .map((image) => ({
      id: image.id,
      url: storagePublicUrl(supabaseUrl, STORAGE_BUCKETS.productImages, image.storage_path),
      alt: image.alt_text ?? "",
    }))
    .filter((image): image is { id: string; url: string; alt: string } => Boolean(image.url));
  const attributes = attributeEntries(product.attributes);

  return (
    <div className="container-editorial py-10 md:py-16">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <Link href={ROUTES.shop} className="hover:text-ink">
          Shop
        </Link>
        {listing.category_slug && listing.category_name ? (
          <>
            <span aria-hidden>/</span>
            <Link href={ROUTES.category(listing.category_slug)} className="hover:text-ink">
              {listing.category_name}
            </Link>
          </>
        ) : null}
        <span aria-hidden>/</span>
        <span className="text-ink">{listing.name}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <ProductGallery images={gallery} name={listing.name ?? "Product"} />

        <div className="flex flex-col gap-8 lg:sticky lg:top-28 lg:self-start">
          <div>
            {listing.store_slug && listing.store_name ? (
              <Link href={ROUTES.store(listing.store_slug)} className="eyebrow hover:text-ink">
                {listing.store_name}
              </Link>
            ) : null}
            <h1 className="mt-2 display-2">{listing.name}</h1>
            {listing.brand_slug && listing.brand_name ? (
              <p className="mt-2 text-sm text-ink-soft">
                by{" "}
                <Link href={ROUTES.brand(listing.brand_slug)} className="text-ink underline-offset-4 hover:underline">
                  {listing.brand_name}
                </Link>
              </p>
            ) : null}
            {listing.short_description ? (
              <p className="mt-4 text-base leading-relaxed text-ink-soft">{listing.short_description}</p>
            ) : null}
          </div>

          <VariantSelector variants={variants} currency={listing.currency ?? "USD"} returnPath={ROUTES.product(slug)} />

          {product.description ? (
            <section className="border-t border-line pt-6">
              <p className="mb-3 eyebrow">Description</p>
              <div className="text-sm leading-relaxed whitespace-pre-line text-ink-soft">{product.description}</div>
            </section>
          ) : null}

          {attributes.length > 0 ? (
            <section className="border-t border-line pt-6">
              <p className="mb-3 eyebrow">Details</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                {attributes.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-ink-soft capitalize">{key.replace(/_/g, " ")}</dt>
                    <dd className="text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="border-t border-line pt-6 text-xs text-ink-faint">
            {product.requires_shipping ? "Ships from the vendor's studio." : "No shipping required."}
            {listing.tags && listing.tags.length > 0 ? ` · ${listing.tags.join(" · ")}` : ""}
          </section>
        </div>
      </div>
    </div>
  );
}
