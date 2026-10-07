import { describe, expect, it } from "vitest";
import { REVIEW_WINDOW_DAYS } from "@/config/legal";
import {
  averageRating,
  isReviewImagePath,
  moderateReviewSchema,
  parseReviewSort,
  ratingLabel,
  REVIEW_IMAGE_MAX_BYTES,
  REVIEW_IMAGE_MIME_TYPES,
  REVIEW_MAX_IMAGES,
  reviewImageSchema,
  reviewReplySchema,
  reviewSubmitSchema,
  reviewUpdateSchema,
} from "@/lib/validation";

const ITEM = "00000000-0000-4000-8000-000000000001";
const REVIEW = "00000000-0000-4000-8000-000000000002";
const PROFILE = "00000000-0000-4000-8000-000000000003";

describe("reviewSubmitSchema", () => {
  it("accepts a rating from the form and trims the text", () => {
    expect(
      reviewSubmitSchema.parse({ orderItemId: ITEM, rating: "4", title: "  ", body: "  Lovely fabric and fit.  " }),
    ).toEqual({ orderItemId: ITEM, rating: 4, title: undefined, body: "Lovely fabric and fit." });
  });

  it("requires a whole rating from 1 to 5", () => {
    for (const rating of ["", "0", "6", "3.5", undefined]) {
      const result = reviewSubmitSchema.safeParse({ orderItemId: ITEM, rating, body: "Lovely fabric and fit." });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Choose a rating from 1 to 5 stars.");
    }
  });

  it("mirrors the database length limits", () => {
    const short = reviewSubmitSchema.safeParse({ orderItemId: ITEM, rating: 5, body: "Too short" });
    expect(short.error?.issues[0]?.message).toBe("Tell other shoppers a little more (at least 10 characters).");
    expect(reviewSubmitSchema.safeParse({ orderItemId: ITEM, rating: 5, body: "x".repeat(4001) }).success).toBe(false);
    expect(
      reviewSubmitSchema.safeParse({ orderItemId: ITEM, rating: 5, title: "t".repeat(121), body: "Long enough body" })
        .success,
    ).toBe(false);
  });
});

describe("reviewUpdateSchema", () => {
  it("needs the review id", () => {
    expect(reviewUpdateSchema.safeParse({ reviewId: "nope", rating: 3, body: "Long enough body" }).success).toBe(false);
    expect(reviewUpdateSchema.parse({ reviewId: REVIEW, rating: 3, body: "Long enough body" }).rating).toBe(3);
  });
});

describe("reviewReplySchema and moderateReviewSchema", () => {
  it("requires reply text", () => {
    expect(reviewReplySchema.safeParse({ reviewId: REVIEW, reply: " " }).success).toBe(false);
    expect(reviewReplySchema.parse({ reviewId: REVIEW, reply: " Thank you! " }).reply).toBe("Thank you!");
  });

  it("requires a reason only when rejecting", () => {
    expect(moderateReviewSchema.parse({ reviewId: REVIEW, decision: "approve" })).toEqual({
      reviewId: REVIEW,
      decision: "approve",
      reason: undefined,
    });
    const missing = moderateReviewSchema.safeParse({ reviewId: REVIEW, decision: "reject", reason: "" });
    expect(missing.error?.issues[0]?.message).toBe("Give the customer a reason (at least 3 characters).");
    expect(moderateReviewSchema.parse({ reviewId: REVIEW, decision: "reject", reason: "Off-topic" }).reason).toBe(
      "Off-topic",
    );
    expect(moderateReviewSchema.safeParse({ reviewId: REVIEW, decision: "delete" }).success).toBe(false);
  });
});

describe("review photos", () => {
  it("accepts only <profile>/<review>/<file> paths", () => {
    expect(isReviewImagePath(`${PROFILE}/${REVIEW}/a1b2.jpg`, PROFILE, REVIEW)).toBe(true);
    expect(isReviewImagePath(`${REVIEW}/${PROFILE}/a1b2.jpg`, PROFILE, REVIEW)).toBe(false);
    expect(isReviewImagePath(`${PROFILE}/${REVIEW}/../x.jpg`, PROFILE, REVIEW)).toBe(false);
    expect(isReviewImagePath(`${PROFILE}/${REVIEW}/sub/x.jpg`, PROFILE, REVIEW)).toBe(false);
    expect(isReviewImagePath(`${PROFILE}/${REVIEW}/.hidden`, PROFILE, REVIEW)).toBe(false);
    expect(reviewImageSchema.safeParse({ reviewId: REVIEW, path: "" }).success).toBe(false);
  });

  it("matches the approved photo policy and the storage bucket", () => {
    expect(REVIEW_MAX_IMAGES).toBe(4);
    expect(REVIEW_IMAGE_MAX_BYTES).toBe(5_242_880);
    expect([...REVIEW_IMAGE_MIME_TYPES]).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(REVIEW_WINDOW_DAYS).toBe(30);
  });
});

describe("rating display helpers", () => {
  it("averages integer totals to one decimal", () => {
    expect(averageRating(0, 0)).toBeNull();
    expect(averageRating(null, null)).toBeNull();
    expect(averageRating(9, 2)).toBe(4.5);
    expect(averageRating(14, 3)).toBe(4.7);
    expect(averageRating(5, 1)).toBe(5);
  });

  it("labels ratings for screen readers", () => {
    expect(ratingLabel(4.5, 2)).toBe("4.5 out of 5 stars, 2 reviews");
    expect(ratingLabel(5, 1)).toBe("5.0 out of 5 stars, 1 review");
  });

  it("falls back to the newest sort", () => {
    expect(parseReviewSort("lowest")).toBe("lowest");
    expect(parseReviewSort("random")).toBe("newest");
    expect(parseReviewSort(undefined)).toBe("newest");
  });
});
