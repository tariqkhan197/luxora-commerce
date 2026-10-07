import Link from "next/link";
import { ActionButton } from "@/components/shared/action-button";
import { ReviewStatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ROUTES } from "@/config/routes";
import { deleteReview } from "../actions";
import type { OwnReview } from "../queries";
import { ReviewContent } from "./review-content";
import { ReviewFormDialog } from "./review-form-dialog";
import { ReviewPhotos } from "./review-photos";

/** The author's view of their review: status, moderation reason, edit, photos, delete. */
export function OwnReviewCard({
  review,
  profileId,
  showProduct = true,
}: {
  review: OwnReview;
  profileId: string;
  showProduct?: boolean;
}) {
  const productName = review.products?.name ?? "This product";
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Your review</p>
          {showProduct ? (
            <p className="mt-1 text-sm text-ink">
              {review.products?.slug ? (
                <Link href={ROUTES.product(review.products.slug)} className="underline-offset-4 hover:underline">
                  {productName}
                </Link>
              ) : (
                productName
              )}
            </p>
          ) : null}
        </div>
        <ReviewStatusBadge status={review.status} />
      </header>

      {review.status === "pending" ? (
        <p className="text-sm text-ink-soft">Our team checks every review before it is published.</p>
      ) : null}
      {review.status === "rejected" && review.rejection_reason ? (
        <Alert variant="destructive">
          <AlertTitle>Not published</AlertTitle>
          <AlertDescription>
            {review.rejection_reason} You can edit your review and it will be checked again.
          </AlertDescription>
        </Alert>
      ) : null}

      <ReviewContent review={{ ...review, review_images: [] }} />
      <ReviewPhotos reviewId={review.id} profileId={profileId} images={review.review_images} />

      <footer className="flex flex-wrap gap-2 border-t border-line pt-4">
        <ReviewFormDialog mode="edit" productName={productName} review={review} />
        <ActionButton
          size="sm"
          variant="ghost"
          confirmMessage="Delete your review? This cannot be undone."
          action={deleteReview.bind(null, review.id)}
        >
          Delete review
        </ActionButton>
      </footer>
    </article>
  );
}
