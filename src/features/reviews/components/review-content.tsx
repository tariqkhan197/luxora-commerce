import { BadgeCheck } from "lucide-react";
import { StorageImage } from "@/components/shared/storage-image";
import { formatDate } from "@/lib/format";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { StarRating } from "./star-rating";

export interface ReviewContentData {
  rating: number;
  title: string | null;
  body: string;
  author_name: string;
  purchased_variant: string | null;
  vendor_reply: string | null;
  vendor_replied_at: string | null;
  created_at: string;
  review_images: { id: string; storage_path: string; position: number }[];
}

/** One review as shoppers see it: rating, text, photos and the vendor's reply. */
export function ReviewContent({ review, vendorName }: { review: ReviewContentData; vendorName?: string | null }) {
  const images = [...review.review_images].sort((a, b) => a.position - b.position);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StarRating value={review.rating} />
        {review.title ? <h3 className="text-sm font-medium text-ink">{review.title}</h3> : null}
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line text-ink-soft">{review.body}</p>
      {images.length ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image) => (
            <li key={image.id}>
              <StorageImage
                bucket={STORAGE_BUCKETS.reviewImages}
                path={image.storage_path}
                alt={`Photo from ${review.author_name}`}
                sizes="96px"
                className="size-20 rounded-md md:size-24"
              />
            </li>
          ))}
        </ul>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
        <span className="text-ink-soft">{review.author_name}</span>
        <span className="inline-flex items-center gap-1">
          <BadgeCheck className="size-3.5" aria-hidden /> Verified purchase
        </span>
        {review.purchased_variant ? <span>· {review.purchased_variant}</span> : null}
        <span>· {formatDate(review.created_at)}</span>
      </p>
      {review.vendor_reply ? (
        <div className="rounded-md border-l-2 border-ink bg-surface-muted px-4 py-3 text-sm">
          <p className="eyebrow">
            Reply from {vendorName ?? "the brand"}
            {review.vendor_replied_at ? ` · ${formatDate(review.vendor_replied_at)}` : ""}
          </p>
          <p className="mt-1 leading-relaxed whitespace-pre-line text-ink-soft">{review.vendor_reply}</p>
        </div>
      ) : null}
    </div>
  );
}
