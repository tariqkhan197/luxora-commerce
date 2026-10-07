"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import {
  isReviewImagePath,
  moderateReviewSchema,
  reviewImageSchema,
  reviewReplySchema,
  reviewSubmitSchema,
  reviewUpdateSchema,
  uuidSchema,
} from "@/lib/validation";

/**
 * Product reviews. Every step is a database function that re-checks who may
 * do it (verified purchase, window, ownership, vendor role, admin); these
 * actions validate input, tidy up storage and refresh the pages.
 */

function revalidateReviews() {
  revalidatePath("/product/[slug]", "page");
  revalidatePath(ROUTES.account.reviews);
  revalidatePath("/account/orders/[id]", "page");
  revalidatePath(ROUTES.vendor.reviews);
  revalidatePath(ROUTES.admin.reviews);
}

/** Best-effort removal of review photos the caller owns (storage policy decides). */
async function removeReviewFiles(paths: string[]) {
  if (!paths.length) return;
  const supabase = await createClient();
  await supabase.storage.from(STORAGE_BUCKETS.reviewImages).remove(paths);
}

// Customer -------------------------------------------------------------------

export async function submitReview(input: unknown): Promise<ActionResult<{ reviewId: string }>> {
  return runAction(async () => {
    const values = reviewSubmitSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("submit_review", {
      p_order_item_id: values.orderItemId,
      p_rating: values.rating,
      p_title: values.title ?? "",
      p_body: values.body,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
    return { reviewId: data };
  });
}

export async function updateReview(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = reviewUpdateSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_review", {
      p_review_id: values.reviewId,
      p_rating: values.rating,
      p_title: values.title ?? "",
      p_body: values.body,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
  });
}

export async function deleteReview(reviewId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(reviewId);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_review", { p_review_id: id });
    if (error) throw fromPostgrestError(error);
    await removeReviewFiles(data ?? []);
    revalidateReviews();
  });
}

/** Records a photo the browser uploaded to review-images/<profile>/<review>/<file>. */
export async function attachReviewImage(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = reviewImageSchema.parse(input);
    const { profile } = await assertUser();
    if (!isReviewImagePath(values.path, profile.id, values.reviewId)) {
      throw AppError.validation({ path: ["This photo was not uploaded for this review."] });
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("attach_review_image", {
      p_review_id: values.reviewId,
      p_storage_path: values.path,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
  });
}

export async function removeReviewImage(imageId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(imageId);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("remove_review_image", { p_image_id: id });
    if (error) throw fromPostgrestError(error);
    await removeReviewFiles(data ? [data] : []);
    revalidateReviews();
  });
}

// Vendor owner/manager -------------------------------------------------------

export async function replyToReview(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = reviewReplySchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("reply_to_review", { p_review_id: values.reviewId, p_reply: values.reply });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
  });
}

/** Vendor owner/manager of the product, or an administrator. */
export async function removeReviewReply(reviewId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(reviewId);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_review_reply", { p_review_id: id });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
  });
}

// Administrator --------------------------------------------------------------

export async function moderateReview(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = moderateReviewSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("moderate_review", {
      p_review_id: values.reviewId,
      p_approve: values.decision === "approve",
      p_reason: values.reason ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidateReviews();
  });
}
