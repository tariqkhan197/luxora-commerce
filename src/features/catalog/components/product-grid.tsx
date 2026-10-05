import { PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import type { ProductListing } from "@/lib/supabase/database.types";
import { ProductCard } from "./product-card";

interface ProductGridProps {
  items: ProductListing[];
  emptyTitle?: string;
  emptyDescription?: string;
}

export function ProductGrid({
  items,
  emptyTitle = "Nothing here yet",
  emptyDescription = "No products match this view right now. Check back soon.",
}: ProductGridProps) {
  if (items.length === 0) {
    return <EmptyState icon={<PackageSearch />} title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 xl:grid-cols-4">
      {items.map((listing, index) => (
        <li key={listing.id}>
          <ProductCard listing={listing} priority={index < 4} />
        </li>
      ))}
    </ul>
  );
}
