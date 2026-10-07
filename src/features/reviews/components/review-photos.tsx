"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { ImageUploader } from "@/components/shared/image-uploader";
import { StorageImage } from "@/components/shared/storage-image";
import { STORAGE_BUCKETS } from "@/lib/storage";
import { REVIEW_IMAGE_MAX_BYTES, REVIEW_IMAGE_MIME_TYPES, REVIEW_MAX_IMAGES } from "@/lib/validation";
import { attachReviewImage, removeReviewImage } from "../actions";

interface ReviewPhotosProps {
  reviewId: string;
  profileId: string;
  images: { id: string; storage_path: string; position: number }[];
}

/**
 * The author's photos on their review. Files go straight to
 * review-images/<profile>/<review>/ (storage policy), then the database
 * records them; a new photo sends the review back to moderation.
 */
export function ReviewPhotos({ reviewId, profileId, images }: ReviewPhotosProps) {
  const router = useRouter();
  const sorted = [...images].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-3">
      {sorted.length ? (
        <ul className="flex flex-wrap gap-3">
          {sorted.map((image) => (
            <li key={image.id} className="flex flex-col items-start gap-1">
              <StorageImage
                bucket={STORAGE_BUCKETS.reviewImages}
                path={image.storage_path}
                alt="Your review photo"
                sizes="96px"
                className="size-20 rounded-md md:size-24"
              />
              <ActionButton
                size="sm"
                variant="ghost"
                action={() => removeReviewImage(image.id)}
                confirmMessage="Remove this photo from your review?"
              >
                <X /> Remove
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : null}
      {sorted.length < REVIEW_MAX_IMAGES ? (
        <div className="flex flex-col gap-1">
          <ImageUploader
            bucket={STORAGE_BUCKETS.reviewImages}
            folder={`${profileId}/${reviewId}`}
            accept={REVIEW_IMAGE_MIME_TYPES}
            maxBytes={REVIEW_IMAGE_MAX_BYTES}
            multiple
            label="Add photos"
            onUploaded={async (path) => {
              const result = await attachReviewImage({ reviewId, path });
              if (result.ok) router.refresh();
              return result;
            }}
          />
          <p className="text-xs text-ink-faint">
            Up to {REVIEW_MAX_IMAGES} photos (JPEG, PNG or WebP, 5 MB each). New photos are checked before they are
            published.
          </p>
        </div>
      ) : null}
    </div>
  );
}
