"use client";

import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { ImageUploader } from "@/components/shared/image-uploader";
import { Badge } from "@/components/ui/badge";
import { IMAGE_MIME_TYPES, STORAGE_BUCKETS } from "@/lib/storage";
import { addProductImage, removeProductImage, setPrimaryImage } from "../actions";

export interface ManagedImage {
  id: string;
  url: string | null;
  altText: string | null;
  isPrimary: boolean;
}

interface ProductImagesManagerProps {
  productId: string;
  vendorId: string;
  images: ManagedImage[];
}

export function ProductImagesManager({ productId, vendorId, images }: ProductImagesManagerProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">
          {images.length === 0
            ? "Add at least one image. The first becomes the primary image."
            : `${images.length} of 12 images`}
        </p>
        <ImageUploader
          bucket={STORAGE_BUCKETS.productImages}
          folder={`${vendorId}/${productId}`}
          accept={IMAGE_MIME_TYPES}
          maxBytes={10 * 1024 * 1024}
          multiple
          label="Upload images"
          onUploaded={async (path) => {
            const result = await addProductImage({ productId, path, altText: "" });
            if (result.ok) router.refresh();
            return result;
          }}
        />
      </div>
      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <li
              key={image.id}
              className="group relative overflow-hidden rounded-lg border border-line bg-surface-muted"
            >
              <div className="aspect-[4/5]">
                {image.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- management thumbnails of freshly uploaded assets
                  <img src={image.url} alt={image.altText ?? ""} className="size-full object-cover" />
                ) : null}
              </div>
              {image.isPrimary ? (
                <Badge variant="ink" className="absolute top-2 left-2">
                  Primary
                </Badge>
              ) : null}
              <div className="flex items-center justify-between gap-1 border-t border-line bg-surface p-1.5">
                {!image.isPrimary ? (
                  <ActionButton size="sm" variant="ghost" action={() => setPrimaryImage(productId, image.id)}>
                    <Star /> Make primary
                  </ActionButton>
                ) : (
                  <span />
                )}
                <ActionButton
                  size="icon"
                  variant="ghost"
                  aria-label="Remove image"
                  className="text-danger hover:bg-danger-soft"
                  confirmMessage="Remove this image?"
                  action={() => removeProductImage(productId, image.id)}
                >
                  <Trash2 />
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
