"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/shared/action-button";
import { ImageUploader } from "@/components/shared/image-uploader";
import type { ActionResult } from "@/lib/errors";
import { IMAGE_MIME_TYPES, STORAGE_BUCKETS, type CatalogAssetKind } from "@/lib/storage";
import { cn } from "@/lib/utils";

interface CatalogImageFieldProps {
  kind: CatalogAssetKind;
  entityId: string;
  imageUrl: string | null;
  label: string;
  hint: string;
  /** Persists the uploaded path (or null to remove). */
  save: (path: string | null) => Promise<ActionResult<void>>;
  contain?: boolean;
}

/** Image upload for admin-managed catalog assets (`catalog-assets/<kind>/<id>/…`). */
export function CatalogImageField({ kind, entityId, imageUrl, label, hint, save, contain }: CatalogImageFieldProps) {
  const router = useRouter();
  return (
    <section className="flex flex-col gap-3 rounded-md border border-line p-4">
      <div>
        <h3 className="text-sm font-medium text-ink">{label}</h3>
        <p className="text-xs text-ink-faint">{hint}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-muted">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of a just-uploaded asset; dimensions unknown
            <img src={imageUrl} alt="" className={cn("size-full", contain ? "object-contain" : "object-cover")} />
          ) : (
            <span className="text-xs text-ink-faint">None</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ImageUploader
            bucket={STORAGE_BUCKETS.catalogAssets}
            folder={`${kind}/${entityId}`}
            accept={IMAGE_MIME_TYPES}
            maxBytes={5 * 1024 * 1024}
            label={imageUrl ? "Replace" : "Upload"}
            onUploaded={async (path) => {
              const result = await save(path);
              if (result.ok) router.refresh();
              return result;
            }}
          />
          {imageUrl ? (
            <ActionButton variant="ghost" action={() => save(null)}>
              Remove
            </ActionButton>
          ) : null}
        </div>
      </div>
    </section>
  );
}
