import Link from "next/link";
import { Pagination } from "@/components/shared/pagination";
import { ReviewStatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { REVIEW_WINDOW_DAYS } from "@/config/legal";
import { ROUTES } from "@/config/routes";
import { getCurrentUser } from "@/lib/auth/dal";
import type { ReviewSort } from "@/lib/validation";
import { getProductReviews, getReviewEligibility, listOwnReviews } from "../queries";
import { RatingSummary } from "./rating-summary";
import { ReviewContent } from "./review-content";
import { ReviewFormDialog } from "./review-form-dialog";

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "highest", label: "Highest rated" },
  { value: "lowest", label: "Lowest rated" },
];

interface ProductReviewsProps {
  productId: string;
  productName: string;
  /** Shown on brand replies. */
  vendorName: string | null;
  slug: string;
  page: number;
  sort: ReviewSort;
}

/** Product page reviews: summary, the signed-in buyer's options, and published reviews. */
export async function ProductReviews({ productId, productName, vendorName, slug, page, sort }: ProductReviewsProps) {
  const user = await getCurrentUser();
  const [{ reviews, stats, pageCount, page: current }, eligible, own] = await Promise.all([
    getProductReviews(productId, { page, sort }),
    user ? getReviewEligibility(productId) : Promise.resolve([]),
    user ? listOwnReviews(user.profile.id, productId) : Promise.resolve([]),
  ]);
  const ownReview = own[0];
  const purchase = eligible[0];
  const href = (next: { page?: number; sort?: ReviewSort }) =>
    `${ROUTES.product(slug)}?reviews=${next.page ?? 1}&sort=${next.sort ?? sort}#reviews`;

  return (
    <section
      id="reviews"
      className="mt-16 grid scroll-mt-28 gap-10 border-t border-line pt-12 lg:grid-cols-[20rem_1fr] lg:gap-16"
    >
      <div className="flex flex-col gap-6">
        <h2 className="display-3">Reviews</h2>
        <RatingSummary stats={stats} />
        {purchase ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-line p-4 text-sm">
            <p className="text-ink">You bought this. How was it?</p>
            <ReviewFormDialog mode="create" orderItemId={purchase.order_item_id} productName={productName} />
          </div>
        ) : ownReview ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-line p-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-ink">Your review</span>
              <ReviewStatusBadge status={ownReview.status} />
            </div>
            <Link href={ROUTES.account.reviews} className="text-ink-soft underline-offset-4 hover:underline">
              Edit or manage it in your account
            </Link>
          </div>
        ) : (
          <p className="text-xs text-ink-faint">
            Reviews come from verified buyers, within {REVIEW_WINDOW_DAYS} days of delivery, and are checked by our team
            before they are published.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {reviews.length ? (
          <>
            <div className="flex flex-wrap gap-1" aria-label="Sort reviews">
              {SORTS.map((option) => (
                <Button key={option.value} asChild size="sm" variant={option.value === sort ? "primary" : "ghost"}>
                  <Link href={href({ sort: option.value })} scroll={false}>
                    {option.label}
                  </Link>
                </Button>
              ))}
            </div>
            <ul className="flex flex-col divide-y divide-line">
              {reviews.map((review) => (
                <li key={review.id} className="py-6 first:pt-0">
                  <ReviewContent review={review} vendorName={vendorName} />
                </li>
              ))}
            </ul>
            <Pagination page={current} pageCount={pageCount} hrefFor={(next) => href({ page: next })} />
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            No reviews yet. Reviews appear here once verified buyers have shared them.
          </p>
        )}
      </div>
    </section>
  );
}
