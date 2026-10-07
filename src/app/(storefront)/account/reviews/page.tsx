import type { Metadata } from "next";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StorageImage } from "@/components/shared/storage-image";
import { REVIEW_WINDOW_DAYS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { OwnReviewCard } from "@/features/reviews/components/own-review-card";
import { ReviewFormDialog } from "@/features/reviews/components/review-form-dialog";
import { getReviewEligibility, listOwnReviews } from "@/features/reviews/queries";
import { requireUser } from "@/lib/auth/dal";
import { formatDate } from "@/lib/format";
import { STORAGE_BUCKETS } from "@/lib/storage";

export const metadata: Metadata = { title: "Your reviews" };

export default async function ReviewsPage() {
  const { profile } = await requireUser(ROUTES.account.reviews);
  const [eligible, reviews] = await Promise.all([getReviewEligibility(), listOwnReviews(profile.id)]);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow="Account"
        title="Your reviews"
        description={`Review products you bought within ${REVIEW_WINDOW_DAYS} days of delivery. Our team checks every review before it is published.`}
      />

      {eligible.length ? (
        <section className="flex flex-col gap-4">
          <h2 className="display-3">Awaiting your review</h2>
          <ul className="grid gap-3">
            {eligible.map((item) => (
              <li
                key={item.order_item_id}
                className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-surface p-4"
              >
                <StorageImage
                  bucket={STORAGE_BUCKETS.productImages}
                  path={item.image_path}
                  alt=""
                  sizes="64px"
                  className="size-16 shrink-0 rounded-md"
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate text-ink">{item.product_name}</p>
                  <p className="text-xs text-ink-faint">
                    {item.variant_title} · review by {formatDate(item.window_ends_at)}
                  </p>
                </div>
                <ReviewFormDialog mode="create" orderItemId={item.order_item_id} productName={item.product_name} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        {eligible.length ? <h2 className="display-3">Your reviews</h2> : null}
        {reviews.length ? (
          <div className="grid gap-4">
            {reviews.map((review) => (
              <OwnReviewCard key={review.id} review={review} profileId={profile.id} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Star />}
            title="No reviews yet"
            description="Once an order has been delivered, you can review what you bought here or from the order page."
          />
        )}
      </section>
    </div>
  );
}
