import Link from "next/link";
import { ActionButton } from "@/components/shared/action-button";
import { ReviewStatusBadge } from "@/components/shared/status-badge";
import { ROUTES } from "@/config/routes";
import { formatDateTimeUtc } from "@/lib/format";
import { moderateReview, removeReviewReply } from "../actions";
import type { ManagedReview } from "../queries";
import { ReviewContent } from "./review-content";
import { ReviewTextDialog } from "./review-text-dialog";

interface ManagedReviewCardProps {
  review: ManagedReview;
  /** Who is looking: decides which actions are offered (the database re-checks every one). */
  viewer: "vendor" | "admin";
  /** Vendor owner/manager: may reply. */
  canReply?: boolean;
}

/** A review in the vendor portal (reply) or the admin moderation queue. */
export function ManagedReviewCard({ review, viewer, canReply = false }: ManagedReviewCardProps) {
  const productName = review.products?.name ?? "Product";
  const vendorName = review.vendors?.display_name ?? null;
  const replyActions = viewer === "vendor" && canReply && review.status === "approved";

  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">
            {viewer === "admin" && vendorName ? `${vendorName} · ` : ""}
            Submitted {formatDateTimeUtc(new Date(review.created_at))}
          </p>
          <p className="mt-1 text-sm text-ink">
            {review.products?.slug && review.status === "approved" ? (
              <Link href={ROUTES.product(review.products.slug)} className="underline-offset-4 hover:underline">
                {productName}
              </Link>
            ) : viewer === "vendor" ? (
              <Link href={ROUTES.vendor.product(review.product_id)} className="underline-offset-4 hover:underline">
                {productName}
              </Link>
            ) : (
              productName
            )}
          </p>
        </div>
        {viewer === "admin" ? <ReviewStatusBadge status={review.status} /> : null}
      </header>

      <ReviewContent review={review} vendorName={vendorName} />

      {viewer === "admin" && review.status === "rejected" && review.rejection_reason ? (
        <p className="text-sm text-ink-soft">
          <span className="text-ink">Rejection reason:</span> {review.rejection_reason}
        </p>
      ) : null}

      {replyActions || viewer === "admin" ? (
        <footer className="flex flex-wrap gap-2 border-t border-line pt-4">
          {replyActions ? (
            <ReviewTextDialog
              reviewId={review.id}
              step="reply"
              triggerLabel={review.vendor_reply ? "Edit reply" : "Reply"}
              defaultValue={review.vendor_reply}
            />
          ) : null}
          {viewer === "admin" && review.status !== "approved" ? (
            <ActionButton size="sm" action={moderateReview.bind(null, { reviewId: review.id, decision: "approve" })}>
              Approve and publish
            </ActionButton>
          ) : null}
          {viewer === "admin" && review.status !== "rejected" ? (
            <ReviewTextDialog
              reviewId={review.id}
              step="reject"
              triggerLabel={review.status === "approved" ? "Take down" : "Reject"}
            />
          ) : null}
          {review.vendor_reply && (replyActions || viewer === "admin") ? (
            <ActionButton
              size="sm"
              variant="ghost"
              confirmMessage="Remove the brand's reply from this review?"
              action={removeReviewReply.bind(null, review.id)}
            >
              Remove reply
            </ActionButton>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}
