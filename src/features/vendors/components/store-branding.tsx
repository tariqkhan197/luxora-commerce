"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/shared/action-button";
import { ImageUploader } from "@/components/shared/image-uploader";
import { IMAGE_MIME_TYPES, LOGO_MIME_TYPES, STORAGE_BUCKETS } from "@/lib/storage";
import { updateStoreBranding } from "../store-actions";

interface StoreBrandingProps {
  vendorId: string;
  logoUrl: string | null;
  coverUrl: string | null;
}

/** Logo and cover management. URLs are resolved server-side and passed in. */
export function StoreBranding({ vendorId, logoUrl, coverUrl }: StoreBrandingProps) {
  const router = useRouter();

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium text-ink">Logo</h3>
          <p className="text-xs text-ink-faint">Square, at least 400×400. PNG, SVG, WebP or JPEG up to 2 MB.</p>
        </div>
        <div className="flex size-32 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-muted">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of a just-uploaded asset; dimensions unknown
            <img src={logoUrl} alt="Store logo" className="size-full object-contain" />
          ) : (
            <span className="text-xs text-ink-faint">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <ImageUploader
            bucket={STORAGE_BUCKETS.vendorLogos}
            folder={vendorId}
            accept={LOGO_MIME_TYPES}
            maxBytes={2 * 1024 * 1024}
            label={logoUrl ? "Replace logo" : "Upload logo"}
            onUploaded={async (path) => {
              const result = await updateStoreBranding({ kind: "logo", path });
              if (result.ok) router.refresh();
              return result;
            }}
          />
          {logoUrl ? (
            <ActionButton variant="ghost" action={() => updateStoreBranding({ kind: "logo", path: null })}>
              Remove
            </ActionButton>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-medium text-ink">Cover image</h3>
          <p className="text-xs text-ink-faint">Wide, at least 1600×600. JPEG, PNG, WebP or AVIF up to 10 MB.</p>
        </div>
        <div className="flex aspect-[8/3] w-full items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-muted">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- preview of a just-uploaded asset; dimensions unknown
            <img src={coverUrl} alt="Store cover" className="size-full object-cover" />
          ) : (
            <span className="text-xs text-ink-faint">No cover image</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <ImageUploader
            bucket={STORAGE_BUCKETS.vendorCovers}
            folder={vendorId}
            accept={IMAGE_MIME_TYPES}
            maxBytes={10 * 1024 * 1024}
            label={coverUrl ? "Replace cover" : "Upload cover"}
            onUploaded={async (path) => {
              const result = await updateStoreBranding({ kind: "cover", path });
              if (result.ok) router.refresh();
              return result;
            }}
          />
          {coverUrl ? (
            <ActionButton variant="ghost" action={() => updateStoreBranding({ kind: "cover", path: null })}>
              Remove
            </ActionButton>
          ) : null}
        </div>
      </section>
    </div>
  );
}
