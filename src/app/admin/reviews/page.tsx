import type { Metadata } from "next";
import { Star } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROUTES } from "@/config/routes";
import { ManagedReviewCard } from "@/features/reviews/components/managed-review-card";
import { ReviewFilter } from "@/features/reviews/components/review-filter";
import { listReviewsForModeration, type ReviewStatus } from "@/features/reviews/queries";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Reviews" };

const FILTERS = [
  { value: "pending", label: "Awaiting moderation" },
  { value: "approved", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

export default async function AdminReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireRole(["admin", "super_admin"], ROUTES.admin.reviews);
  const { status: raw } = await searchParams;
  const active: Filter = FILTERS.find((filter) => filter.value === raw)?.value ?? "pending";
  const reviews = await listReviewsForModeration(active === "all" ? null : (active as ReviewStatus));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Marketplace"
        title="Reviews"
        description="Every review is checked here before it is published. Approve it, or reject it with a reason the customer sees. Published reviews can be taken down, and brand replies removed."
      />
      <ReviewFilter basePath={ROUTES.admin.reviews} param="status" options={FILTERS} active={active} />
      {reviews.length ? (
        <div className="grid gap-4">
          {reviews.map((review) => (
            <ManagedReviewCard key={review.id} review={review} viewer="admin" />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Star />} title="No reviews here" description="Nothing in this state right now." />
      )}
    </div>
  );
}
