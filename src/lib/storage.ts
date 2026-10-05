/**
 * Supabase Storage conventions (see supabase/migrations/20261005000010_storage.sql).
 * Paths are owner-scoped: policies compare the first folder with the vendor or
 * profile id, so the helpers below build and validate exactly that shape.
 */

export const STORAGE_BUCKETS = {
  productImages: "product-images",
  vendorLogos: "vendor-logos",
  vendorCovers: "vendor-covers",
  vendorDocuments: "vendor-documents",
  avatars: "avatars",
  reviewImages: "review-images",
  banners: "banners",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const LOGO_MIME_TYPES = [...IMAGE_MIME_TYPES, "image/svg+xml"] as const;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

export function extensionForMime(mime: string): string | null {
  return EXTENSION_BY_MIME[mime] ?? null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a storage object path belongs to `ownerId` and contains only
 * safe segments. Used server-side before persisting a path a client uploaded.
 */
export function isOwnedStoragePath(path: string, ownerId: string, options: { depth?: number } = {}): boolean {
  if (!UUID.test(ownerId)) return false;
  const segments = path.split("/");
  if (segments.length < 2 || segments.length > (options.depth ?? 3) + 1) return false;
  if (segments[0] !== ownerId) return false;
  return segments.slice(1).every((segment) => SAFE_SEGMENT.test(segment) && segment !== "." && segment !== "..");
}

/** Builds a public URL for an object in a public bucket. */
export function storagePublicUrl(
  supabaseUrl: string,
  bucket: StorageBucket,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${encoded}`;
}

export function randomFileName(mime: string): string {
  const ext = extensionForMime(mime) ?? "bin";
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
  return `${id}.${ext}`;
}
