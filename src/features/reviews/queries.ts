import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/supabase/database.types";
import type { ReviewSort } from "@/lib/validation";

/**
 * Review reads through the RLS client: everyone sees published reviews,
 * authors also see their own pending or rejected ones, admins see all.
 */

export type ReviewStatus = Enums<"review_status">;

const PUBLIC_REVIEW_SELECT = `
  id, rating, title, body, author_name, purchased_variant, vendor_reply, vendor_replied_at, created_at, updated_at,
  review_images ( id, storage_path, position )
`;

export const REVIEWS_PAGE_SIZE = 10;

/** Published reviews of a product, paginated, plus the rating breakdown. */
export async function getProductReviews(productId: string, options: { page?: number; sort?: ReviewSort } = {}) {
  const supabase = await createClient();
  const page = Math.max(1, options.page ?? 1);
  const from = (page - 1) * REVIEWS_PAGE_SIZE;
  let query = supabase
    .from("reviews")
    .select(PUBLIC_REVIEW_SELECT, { count: "exact" })
    .eq("product_id", productId)
    .eq("status", "approved");
  if (options.sort === "highest") query = query.order("rating", { ascending: false });
  if (options.sort === "lowest") query = query.order("rating", { ascending: true });
  query = query
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, from + REVIEWS_PAGE_SIZE - 1);

  const [reviews, stats] = await Promise.all([
    query,
    supabase
      .from("product_review_stats")
      .select("review_count, rating_sum, rating_1, rating_2, rating_3, rating_4, rating_5")
      .eq("product_id", productId)
      .maybeSingle(),
  ]);
  if (reviews.error) throw fromPostgrestError(reviews.error);
  if (stats.error) throw fromPostgrestError(stats.error);
  const total = reviews.count ?? 0;
  return {
    reviews: reviews.data ?? [],
    page,
    pageCount: Math.max(1, Math.ceil(total / REVIEWS_PAGE_SIZE)),
    stats: stats.data ?? {
      review_count: 0,
      rating_sum: 0,
      rating_1: 0,
      rating_2: 0,
      rating_3: 0,
      rating_4: 0,
      rating_5: 0,
    },
  };
}

export type PublicReview = Awaited<ReturnType<typeof getProductReviews>>["reviews"][number];
export type ReviewStats = Awaited<ReturnType<typeof getProductReviews>>["stats"];

/** Delivered purchases the signed-in customer can still review (optionally for one product). */
export async function getReviewEligibility(productId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_eligibility", productId ? { p_product_id: productId } : {});
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type ReviewEligibility = Awaited<ReturnType<typeof getReviewEligibility>>[number];

const OWN_REVIEW_SELECT = `
  id, product_id, rating, title, body, status, rejection_reason, author_name, purchased_variant,
  vendor_reply, vendor_replied_at, created_at, updated_at,
  products ( name, slug ),
  review_images ( id, storage_path, position )
`;

/** The customer's own reviews in every state. */
export async function listOwnReviews(customerId: string, productId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("reviews")
    .select(OWN_REVIEW_SELECT)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (productId) query = query.eq("product_id", productId);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type OwnReview = Awaited<ReturnType<typeof listOwnReviews>>[number];

const MANAGED_REVIEW_SELECT = `
  id, product_id, vendor_id, rating, title, body, status, rejection_reason, author_name, purchased_variant,
  vendor_reply, vendor_replied_at, moderated_at, created_at, updated_at,
  products ( name, slug ),
  vendors ( display_name ),
  review_images ( id, storage_path, position )
`;

/** Published reviews of a vendor's products (vendor portal). */
export async function listVendorReviews(vendorId: string, filters: { awaitingReply?: boolean } = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("reviews")
    .select(MANAGED_REVIEW_SELECT)
    .eq("vendor_id", vendorId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(100);
  if (filters.awaitingReply) query = query.is("vendor_reply", null);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

/** Moderation queue (admins): oldest first for pending, newest first otherwise. */
export async function listReviewsForModeration(status: ReviewStatus | null) {
  const supabase = await createClient();
  let query = supabase
    .from("reviews")
    .select(MANAGED_REVIEW_SELECT)
    .order("created_at", { ascending: status !== "pending" })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export type ManagedReview = Awaited<ReturnType<typeof listReviewsForModeration>>[number];
