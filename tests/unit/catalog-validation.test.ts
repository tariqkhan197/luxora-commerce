import { describe, expect, it } from "vitest";
import {
  approveApplicationSchema,
  catalogQuerySchema,
  inventoryAdjustmentSchema,
  moderateProductSchema,
  productDetailsSchema,
  productVariantSchema,
  storeSettingsSchema,
  tagsInputSchema,
} from "@/lib/validation";

describe("product schemas", () => {
  it("parses comma-separated tags into a unique lowercase list", () => {
    expect(tagsInputSchema.parse("Wool, winter ,wool,  Coat")).toEqual(["wool", "winter", "coat"]);
    expect(tagsInputSchema.parse("")).toEqual([]);
  });

  it("validates product details with optional fields blank", () => {
    const result = productDetailsSchema.safeParse({
      name: "Wool Coat",
      categoryId: "",
      brandId: "",
      shortDescription: "",
      description: "",
      tags: "wool",
      currency: "USD",
      requiresShipping: true,
      weightGrams: "",
      seoTitle: "",
      seoDescription: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.categoryId).toBeUndefined();
      expect(result.data.weightGrams).toBeUndefined();
      expect(result.data.tags).toEqual(["wool"]);
    }
  });

  it("validates variants, prices and options", () => {
    const ok = productVariantSchema.safeParse({
      title: "Medium / Black",
      sku: "COAT-M-BLK",
      price: "149.00",
      compareAtPrice: "",
      cost: "80",
      options: [
        { name: "Size", value: "M" },
        { name: "Colour", value: "Black" },
      ],
      isDefault: true,
      isActive: true,
    });
    expect(ok.success).toBe(true);

    const badSku = productVariantSchema.safeParse({ title: "x", sku: "bad sku!", price: "10", options: [] });
    expect(badSku.success).toBe(false);

    const badPrice = productVariantSchema.safeParse({ title: "x", sku: "OK-1", price: "10.999", options: [] });
    expect(badPrice.success).toBe(false);

    const dupOptions = productVariantSchema.safeParse({
      title: "x",
      sku: "OK-1",
      price: "10",
      options: [
        { name: "Size", value: "M" },
        { name: "size", value: "L" },
      ],
    });
    expect(dupOptions.success).toBe(false);
  });

  it("validates inventory adjustments", () => {
    expect(
      inventoryAdjustmentSchema.safeParse({
        variantId: "11111111-1111-4111-8111-111111111111",
        quantityDelta: "5",
        type: "restock",
      }).success,
    ).toBe(true);
    expect(
      inventoryAdjustmentSchema.safeParse({
        variantId: "11111111-1111-4111-8111-111111111111",
        quantityDelta: "0",
        type: "restock",
      }).success,
    ).toBe(false);
    expect(
      inventoryAdjustmentSchema.safeParse({
        variantId: "11111111-1111-4111-8111-111111111111",
        quantityDelta: "1.5",
        type: "restock",
      }).success,
    ).toBe(false);
    expect(inventoryAdjustmentSchema.safeParse({ variantId: "x", quantityDelta: "1", type: "sale" }).success).toBe(
      false,
    );
  });
});

describe("store and admin schemas", () => {
  it("validates store settings", () => {
    expect(
      storeSettingsSchema.safeParse({ name: "Atelier Nord", slug: "atelier-nord", tagline: "", seoTitle: "" }).success,
    ).toBe(true);
    expect(storeSettingsSchema.safeParse({ name: "A", slug: "Bad Slug" }).success).toBe(false);
  });

  it("validates application approval and product moderation", () => {
    const approve = approveApplicationSchema.safeParse({
      applicationId: "11111111-1111-4111-8111-111111111111",
      slug: "atelier-nord",
      commissionRateBps: "",
    });
    expect(approve.success).toBe(true);
    if (approve.success) expect(approve.data.commissionRateBps).toBeUndefined();
    expect(
      approveApplicationSchema.safeParse({
        applicationId: "11111111-1111-4111-8111-111111111111",
        slug: "ok",
        commissionRateBps: "20000",
      }).success,
    ).toBe(false);

    expect(
      moderateProductSchema.safeParse({ productId: "11111111-1111-4111-8111-111111111111", approve: false, reason: "" })
        .success,
    ).toBe(false);
    expect(
      moderateProductSchema.safeParse({
        productId: "11111111-1111-4111-8111-111111111111",
        approve: false,
        reason: "Images missing",
      }).success,
    ).toBe(true);
  });

  it("normalises catalog query parameters with safe defaults", () => {
    const parsed = catalogQuerySchema.parse({
      q: " wool ",
      sort: "bogus",
      page: "abc",
      inStock: "1",
      category: "women",
    });
    expect(parsed).toEqual({
      q: "wool",
      category: "women",
      brand: undefined,
      store: undefined,
      sort: "newest",
      page: 1,
      inStock: true,
    });
    expect(catalogQuerySchema.parse({}).sort).toBe("newest");
  });
});
