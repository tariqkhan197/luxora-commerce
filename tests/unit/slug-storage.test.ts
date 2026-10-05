import { describe, expect, it } from "vitest";
import { isValidSlug, slugify, withRandomSuffix } from "@/lib/slug";
import { extensionForMime, isOwnedStoragePath, storagePublicUrl } from "@/lib/storage";

describe("slugify", () => {
  it("produces database-valid slugs", () => {
    expect(slugify("Atelier Nord — Wool Coat (2026)")).toBe("atelier-nord-wool-coat-2026");
    expect(slugify("  Crème & Noir  ")).toBe("creme-and-noir");
    expect(slugify("Ünïcödé Brand")).toBe("unicode-brand");
    expect(isValidSlug(slugify("Hello World"))).toBe(true);
  });

  it("truncates without a trailing hyphen", () => {
    const slug = slugify("a".repeat(50) + " " + "b".repeat(50), 60);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("adds a suffix that keeps the slug valid", () => {
    const slug = withRandomSuffix("wool-coat");
    expect(slug).toMatch(/^wool-coat-[a-z0-9]{4}$/);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("storage paths", () => {
  const vendorId = "11111111-1111-4111-8111-111111111111";

  it("accepts only paths under the owner's folder", () => {
    expect(isOwnedStoragePath(`${vendorId}/logo.png`, vendorId)).toBe(true);
    expect(isOwnedStoragePath(`${vendorId}/product/abc.jpg`, vendorId)).toBe(true);
    expect(isOwnedStoragePath(`22222222-2222-4222-8222-222222222222/logo.png`, vendorId)).toBe(false);
    expect(isOwnedStoragePath(`${vendorId}/../other/logo.png`, vendorId)).toBe(false);
    expect(isOwnedStoragePath(`${vendorId}`, vendorId)).toBe(false);
    expect(isOwnedStoragePath(`${vendorId}/a/b/c/d.png`, vendorId)).toBe(false);
    expect(isOwnedStoragePath(`${vendorId}/logo.png`, "not-a-uuid")).toBe(false);
  });

  it("builds public URLs with encoded segments", () => {
    expect(storagePublicUrl("https://abc.supabase.co/", "vendor-logos", `${vendorId}/my logo.png`)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/vendor-logos/${vendorId}/my%20logo.png`,
    );
    expect(storagePublicUrl("https://abc.supabase.co", "vendor-logos", null)).toBeNull();
  });

  it("maps mime types to extensions", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("application/pdf")).toBeNull();
  });
});
