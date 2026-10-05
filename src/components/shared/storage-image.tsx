import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { getClientEnv } from "@/lib/env";
import { storagePublicUrl, type StorageBucket } from "@/lib/storage";
import { cn } from "@/lib/utils";

interface StorageImageProps {
  bucket: StorageBucket;
  path: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}

/**
 * Renders an object from a public Supabase bucket with next/image, falling
 * back to a quiet placeholder when no image has been uploaded yet.
 */
export function StorageImage({
  bucket,
  path,
  alt,
  className,
  sizes = "(min-width: 1024px) 25vw, 50vw",
  priority,
}: StorageImageProps) {
  const url = storagePublicUrl(getClientEnv().NEXT_PUBLIC_SUPABASE_URL, bucket, path);
  if (!url) {
    return (
      <div className={cn("flex items-center justify-center bg-surface-muted text-ink-faint", className)} aria-hidden>
        <ImageIcon className="size-6" />
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-surface-muted", className)}>
      <Image src={url} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
    </div>
  );
}
