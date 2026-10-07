import Link from "next/link";
import { StorageImage } from "@/components/shared/storage-image";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/routes";
import { formatMoney } from "@/lib/money";
import { STORAGE_BUCKETS } from "@/lib/storage";
import type { ProductListing } from "@/lib/supabase/database.types";
import { averageRating, ratingLabel } from "@/lib/validation";
import { StarRating } from "@/features/reviews/components/star-rating";

export function priceLabel(listing: Pick<ProductListing, "min_price_minor" | "max_price_minor" | "currency">): string {
  const currency = listing.currency ?? "USD";
  const min = listing.min_price_minor ?? 0;
  const max = listing.max_price_minor ?? min;
  return min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`;
}

export function ProductCard({ listing, priority }: { listing: ProductListing; priority?: boolean }) {
  if (!listing.slug || !listing.name) return null;
  const onSale =
    listing.compare_at_price_minor !== null &&
    listing.min_price_minor !== null &&
    listing.compare_at_price_minor > listing.min_price_minor;
  const average = averageRating(listing.rating_sum, listing.review_count);

  return (
    <article className="group flex flex-col gap-3">
      <Link href={ROUTES.product(listing.slug)} className="relative block overflow-hidden rounded-lg">
        <StorageImage
          bucket={STORAGE_BUCKETS.productImages}
          path={listing.primary_image_path}
          alt={listing.primary_image_alt ?? listing.name}
          priority={priority}
          className="aspect-[4/5] w-full transition-transform duration-700 ease-out-expo group-hover:scale-[1.03]"
        />
        <div className="absolute top-3 left-3 flex gap-2">
          {!listing.in_stock ? <Badge variant="neutral">Sold out</Badge> : null}
          {onSale ? <Badge variant="accent">Sale</Badge> : null}
        </div>
      </Link>
      <div className="flex flex-col gap-1">
        {listing.store_name && listing.store_slug ? (
          <Link href={ROUTES.store(listing.store_slug)} className="eyebrow hover:text-ink">
            {listing.store_name}
          </Link>
        ) : listing.brand_name ? (
          <p className="eyebrow">{listing.brand_name}</p>
        ) : null}
        <h3 className="text-sm leading-snug text-ink">
          <Link href={ROUTES.product(listing.slug)} className="underline-offset-4 hover:underline">
            {listing.name}
          </Link>
        </h3>
        <p className="text-sm text-ink-soft">
          {priceLabel(listing)}
          {onSale && listing.compare_at_price_minor ? (
            <span className="ml-2 text-xs text-ink-faint line-through">
              {formatMoney(listing.compare_at_price_minor, listing.currency ?? "USD")}
            </span>
          ) : null}
        </p>
        {average !== null && listing.review_count ? (
          <p className="flex items-center gap-1.5 text-xs text-ink-faint">
            <StarRating value={average} label={ratingLabel(average, listing.review_count)} />
            <span aria-hidden>({listing.review_count})</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}
