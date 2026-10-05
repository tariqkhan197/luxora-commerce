/**
 * URL slug helpers shared by the vendor and admin workflows.
 * The database enforces the final format via the `slug_text` domain.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string, maxLength = 80): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  const trimmed = base.slice(0, maxLength).replace(/-+$/g, "");
  return trimmed;
}

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value.length >= 2 && value.length <= 120;
}

/** Appends a short random suffix so a slug can be retried after a uniqueness conflict. */
export function withRandomSuffix(slug: string, length = 4): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let suffix = "";
  for (let i = 0; i < length; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${slug.slice(0, 120 - length - 1)}-${suffix}`;
}
