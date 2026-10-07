import type { Metadata } from "next";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ROUTES } from "@/config/routes";
import { ManagedReviewCard } from "@/features/reviews/components/managed-review-card";
import { ReviewFilter } from "@/features/reviews/components/review-filter";
import { listVendorReviews } from "@/features/reviews/queries";
import { requireVendorContext } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Reviews" };

const FILTERS = [
  { value: "all", label: "All published" },
  { value: "unanswered", label: "Without a reply" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export default async function VendorReviewsPage({ searchParams }: PageProps<"/vendor/reviews">) {
  const { vendor, memberRole } = await requireVendorContext(ROUTES.vendor.reviews);
  const { show: raw } = await searchParams;
  const active: Filter = FILTERS.find((filter) => filter.value === raw)?.value ?? "all";
  const reviews = await listVendorReviews(vendor.id, { awaitingReply: active === "unanswered" });
  const canReply = memberRole === "owner" || memberRole === "manager";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Vendor portal"
        title="Reviews"
        description="Published reviews of your products from verified buyers. Luxora checks every review before it appears. You can post one public reply per review; it appears straight away."
      />
      {!canReply ? (
        <Alert variant="info">
          <AlertTitle>Read-only</AlertTitle>
          <AlertDescription>Only owners and managers can reply to reviews.</AlertDescription>
        </Alert>
      ) : null}
      <ReviewFilter basePath={ROUTES.vendor.reviews} param="show" options={FILTERS} active={active} />
      {reviews.length ? (
        <div className="grid gap-4">
          {reviews.map((review) => (
            <ManagedReviewCard key={review.id} review={review} viewer="vendor" canReply={canReply} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Star />}
          title="No reviews here"
          description="Reviews of your products appear here once they are published."
        />
      )}
    </div>
  );
}
