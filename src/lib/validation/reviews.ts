import { z } from "zod";
import { optionalText, uuidSchema } from "./common";

/**
 * Product reviews (Phase 6A). Mirrors the checks in the review functions of
 * migration 0022; the database stays the final authority on eligibility.
 */

/** Photos per review (`reviews.max_images`). */
export const REVIEW_MAX_IMAGES = 4;
/** Matches the `review-images` bucket: 5 MB, JPEG/PNG/WebP. */
export const REVIEW_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const ratingSchema = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? undefined : Number(value)),
  z
    .number({ error: "Choose a rating from 1 to 5 stars." })
    .int({ error: "Choose a rating from 1 to 5 stars." })
    .min(1, { error: "Choose a rating from 1 to 5 stars." })
    .max(5, { error: "Choose a rating from 1 to 5 stars." }),
);

const reviewContent = {
  rating: ratingSchema,
  title: optionalText(z.string().trim().max(120, { error: "Keep the title under 120 characters." })),
  body: z
    .string()
    .trim()
    .min(10, { error: "Tell other shoppers a little more (at least 10 characters)." })
    .max(4000, { error: "Keep the review under 4000 characters." }),
};

export const reviewSubmitSchema = z.object({ orderItemId: uuidSchema, ...reviewContent });
export type ReviewSubmitInput = z.input<typeof reviewSubmitSchema>;

export const reviewUpdateSchema = z.object({ reviewId: uuidSchema, ...reviewContent });
export type ReviewUpdateInput = z.input<typeof reviewUpdateSchema>;
export type ReviewUpdateValues = z.output<typeof reviewUpdateSchema>;

export const reviewImageSchema = z.object({
  reviewId: uuidSchema,
  path: z.string().trim().min(1).max(300),
});

export const reviewReplySchema = z.object({
  reviewId: uuidSchema,
  reply: z
    .string()
    .trim()
    .min(2, { error: "Write a reply (at least 2 characters)." })
    .max(2000, { error: "Keep the reply under 2000 characters." }),
});

export const moderateReviewSchema = z
  .object({
    reviewId: uuidSchema,
    decision: z.enum(["approve", "reject"]),
    reason: optionalText(z.string().trim().max(1000, { error: "Keep the reason under 1000 characters." })),
  })
  .superRefine((data, ctx) => {
    if (data.decision === "reject" && (data.reason ?? "").length < 3) {
      ctx.addIssue({
        code: "custom",
        message: "Give the customer a reason (at least 3 characters).",
        path: ["reason"],
      });
    }
  });

export const REVIEW_SORTS = ["newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export function parseReviewSort(value: unknown): ReviewSort {
  return REVIEW_SORTS.find((sort) => sort === value) ?? "newest";
}

/** Average of approved ratings to one decimal, from integer totals; null without reviews. */
export function averageRating(ratingSum: number | null | undefined, reviewCount: number | null | undefined) {
  if (!reviewCount || reviewCount <= 0 || !ratingSum) return null;
  return Math.round((ratingSum * 10) / reviewCount) / 10;
}

/** "4.5 out of 5 (12 reviews)" style label for screen readers and summaries. */
export function ratingLabel(average: number, count: number): string {
  return `${average.toFixed(1)} out of 5 stars, ${count} ${count === 1 ? "review" : "reviews"}`;
}

/**
 * True when `path` is `<profileId>/<reviewId>/<file>` with a safe file name,
 * the only shape the storage policy and attach_review_image() accept.
 */
export function isReviewImagePath(path: string, profileId: string, reviewId: string): boolean {
  const segments = path.split("/");
  return (
    segments.length === 3 &&
    segments[0] === profileId &&
    segments[1] === reviewId &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(segments[2])
  );
}
