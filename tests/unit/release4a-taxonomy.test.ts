import { describe, expect, it } from "vitest";
import {
  allowedParents,
  buildCategoryTree,
  flattenTree,
  MAX_CATEGORY_DEPTH,
  subtreeHeight,
} from "@/features/admin/taxonomy/tree";
import { isCatalogAssetPath } from "@/lib/storage";
import { brandSchema, categorySchema, vendorApplicationSchema } from "@/lib/validation";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("categorySchema", () => {
  const base = { name: "Outerwear", slug: "outerwear", position: "2", isActive: true };

  it("converts the commission percentage to basis points and treats blank as inherit", () => {
    expect(categorySchema.parse({ ...base, commissionRate: "12.5" }).commissionRate).toBe(1250);
    expect(categorySchema.parse({ ...base, commissionRate: "0" }).commissionRate).toBe(0);
    expect(categorySchema.parse({ ...base, commissionRate: "" }).commissionRate).toBeUndefined();
    expect(categorySchema.safeParse({ ...base, commissionRate: "101" }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, commissionRate: "12.555" }).success).toBe(false);
  });

  it("normalises optional fields and positions", () => {
    const parsed = categorySchema.parse({ ...base, parentId: "", description: "  ", id: "" });
    expect(parsed).toMatchObject({ position: 2, parentId: undefined, description: undefined, id: undefined });
    expect(categorySchema.safeParse({ ...base, slug: "Bad Slug" }).success).toBe(false);
    expect(categorySchema.safeParse({ ...base, position: "-1" }).success).toBe(false);
  });
});

describe("brandSchema", () => {
  it("accepts an unowned brand and validates the website", () => {
    const parsed = brandSchema.parse({ name: "Nord", slug: "nord", ownerVendorId: "", websiteUrl: "" });
    expect(parsed).toMatchObject({
      ownerVendorId: undefined,
      websiteUrl: undefined,
      isActive: true,
      isVerified: false,
    });
    expect(brandSchema.safeParse({ name: "Nord", slug: "nord", websiteUrl: "ftp://x" }).success).toBe(false);
    expect(brandSchema.safeParse({ name: "Nord", slug: "nord", ownerVendorId: "nope" }).success).toBe(false);
  });
});

describe("category tree", () => {
  // women > clothing > coats ; men (leaf) ; home > decor
  const categories = [
    { id: ID(1), parentId: null, name: "Women" },
    { id: ID(2), parentId: ID(1), name: "Clothing" },
    { id: ID(3), parentId: ID(2), name: "Coats" },
    { id: ID(4), parentId: null, name: "Men" },
    { id: ID(5), parentId: null, name: "Home" },
    { id: ID(6), parentId: ID(5), name: "Decor" },
  ];

  it("builds depth-first and measures subtree height", () => {
    const flat = flattenTree(buildCategoryTree(categories));
    expect(flat.map((node) => [node.category.name, node.depth])).toEqual([
      ["Women", 0],
      ["Clothing", 1],
      ["Coats", 2],
      ["Men", 0],
      ["Home", 0],
      ["Decor", 1],
    ]);
    expect(subtreeHeight(buildCategoryTree(categories)[0])).toBe(MAX_CATEGORY_DEPTH);
  });

  it("offers only parents that keep the tree within three levels", () => {
    // A new category can go under depth-0 or depth-1 nodes, never under depth 2.
    expect(allowedParents(categories, null).map((p) => p.name)).toEqual(["Women", "Clothing", "Men", "Home", "Decor"]);
    // Home has a child, so it can only move under a top-level category.
    expect(allowedParents(categories, ID(5)).map((p) => p.name)).toEqual(["Women", "Men"]);
    // Women is three levels deep: it cannot move anywhere but the top level.
    expect(allowedParents(categories, ID(1))).toEqual([]);
  });

  it("never offers the category itself or its descendants (no cycles)", () => {
    const names = allowedParents(categories, ID(2)).map((p) => p.name);
    expect(names).not.toContain("Clothing");
    expect(names).not.toContain("Coats");
  });

  it("survives a cyclic or orphaned input without looping", () => {
    const broken = [
      { id: ID(7), parentId: ID(8), name: "A" },
      { id: ID(8), parentId: ID(7), name: "B" },
      { id: ID(9), parentId: ID(99), name: "Orphan" },
    ];
    expect(flattenTree(buildCategoryTree(broken)).map((node) => node.category.name)).toEqual(["Orphan"]);
  });
});

describe("catalog asset paths", () => {
  const id = ID(42);
  it("accepts <kind>/<id>/<file> only", () => {
    expect(isCatalogAssetPath(`categories/${id}/a.webp`, "categories", id)).toBe(true);
    expect(isCatalogAssetPath(`brands/${id}/logo.png`, "brands", id)).toBe(true);
    expect(isCatalogAssetPath(`brands/${id}/logo.png`, "categories", id)).toBe(false);
    expect(isCatalogAssetPath(`categories/${ID(43)}/a.webp`, "categories", id)).toBe(false);
    expect(isCatalogAssetPath(`categories/${id}/../x.png`, "categories", id)).toBe(false);
    expect(isCatalogAssetPath(`categories/${id}/nested/a.png`, "categories", id)).toBe(false);
  });
});

describe("vendor application consent", () => {
  const application = {
    businessName: "Atelier Nord",
    businessEmail: "hello@nord.example",
    description: "Small-batch outerwear made in our own studio.",
  };

  it("requires the Vendor Terms to be accepted", () => {
    expect(vendorApplicationSchema.safeParse({ ...application, acceptTerms: false }).success).toBe(false);
    expect(vendorApplicationSchema.safeParse(application).success).toBe(false);
    expect(vendorApplicationSchema.safeParse({ ...application, acceptTerms: true }).success).toBe(true);
  });
});
