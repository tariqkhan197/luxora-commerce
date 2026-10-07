import type { Metadata } from "next";
import Link from "next/link";
import { Tags } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StorageImage } from "@/components/shared/storage-image";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { listActiveBrands } from "@/features/catalog/queries";
import { STORAGE_BUCKETS } from "@/lib/storage";

export const metadata: Metadata = {
  title: "Brands",
  description: "Every independent brand on Luxora, from A to Z.",
};

export default async function BrandsPage() {
  const brands = await listActiveBrands();

  return (
    <div className="container-editorial flex flex-col gap-10 py-12 md:py-16">
      <PageHeader
        eyebrow="Brands"
        title="The houses of Luxora"
        description="Independent fashion and lifestyle brands, each shipping from its own studio."
      />
      {brands.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Link
                href={ROUTES.brand(brand.slug)}
                className="group flex h-full flex-col items-center gap-4 rounded-lg border border-line bg-surface p-6 text-center transition-colors hover:border-ink"
              >
                <StorageImage
                  bucket={STORAGE_BUCKETS.catalogAssets}
                  path={brand.logo_path}
                  alt=""
                  className="size-20 rounded-full"
                  sizes="80px"
                />
                <span className="font-display text-lg text-ink group-hover:underline group-hover:underline-offset-4">
                  {brand.name}
                </span>
                {brand.is_verified ? <Badge variant="accent">Verified</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Tags />}
          title="No brands yet"
          description="Brands appear here as independent designers join Luxora."
        />
      )}
    </div>
  );
}
