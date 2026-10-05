import { z } from "zod";
import { basisPointsSchema, currencyCodeSchema, optionalText, slugSchema, uuidSchema } from "./common";

// -----------------------------------------------------------------------------
// Store (vendor storefront)
// -----------------------------------------------------------------------------
export const storeSettingsSchema = z.object({
  name: z.string().trim().min(2, { error: "Store name must be at least 2 characters." }).max(120),
  slug: slugSchema,
  tagline: optionalText(z.string().trim().max(160, { error: "Tagline must be 160 characters or fewer." })),
  description: optionalText(z.string().trim().max(5000)),
  returnPolicy: optionalText(z.string().trim().max(5000)),
  shippingPolicy: optionalText(z.string().trim().max(5000)),
  seoTitle: optionalText(z.string().trim().max(70, { error: "SEO title must be 70 characters or fewer." })),
  seoDescription: optionalText(
    z.string().trim().max(200, { error: "SEO description must be 200 characters or fewer." }),
  ),
});
export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;
export type StoreSettingsValues = z.output<typeof storeSettingsSchema>;

/** A storage path that must belong to the given owner folder (checked in the action). */
export const storagePathSchema = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, { error: "Invalid file path." });

export const storeBrandingSchema = z.object({
  kind: z.enum(["logo", "cover"]),
  path: storagePathSchema.nullable(),
});

export const storePublishSchema = z.object({ publish: z.boolean() });

// -----------------------------------------------------------------------------
// Products
// -----------------------------------------------------------------------------
const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20, { error: "Use at most 20 tags." }).default([]);

/** "wool, winter, coat" → ["wool","winter","coat"] */
export const tagsInputSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  return Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}, tagsSchema);

export const productDetailsSchema = z.object({
  name: z.string().trim().min(2, { error: "Name must be at least 2 characters." }).max(200),
  categoryId: optionalText(uuidSchema),
  brandId: optionalText(uuidSchema),
  shortDescription: optionalText(z.string().trim().max(300, { error: "Keep the summary under 300 characters." })),
  description: optionalText(z.string().trim().max(20_000)),
  tags: tagsInputSchema,
  currency: currencyCodeSchema,
  requiresShipping: z.boolean().default(true),
  weightGrams: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z.number().int({ error: "Weight must be whole grams." }).min(0).max(1_000_000).optional(),
  ),
  seoTitle: optionalText(z.string().trim().max(70)),
  seoDescription: optionalText(z.string().trim().max(200)),
});
export type ProductDetailsInput = z.input<typeof productDetailsSchema>;
export type ProductDetailsValues = z.output<typeof productDetailsSchema>;

/** Money is entered as a decimal string in the UI and converted server-side. */
const moneyInputSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, { error: "Enter an amount like 149.00." });

const optionalMoneyInputSchema = optionalText(moneyInputSchema);

/** Variant options as a list of name/value pairs (e.g. Size: M, Colour: Black). */
export const variantOptionsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, { error: "Option name is required." }).max(40),
      value: z.string().trim().min(1, { error: "Option value is required." }).max(60),
    }),
  )
  .max(5, { error: "Use at most 5 options." })
  .default([])
  .refine((options) => new Set(options.map((o) => o.name.toLowerCase())).size === options.length, {
    error: "Option names must be unique.",
  });

export const productVariantSchema = z.object({
  title: z.string().trim().min(1, { error: "Title is required." }).max(120),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/, {
      error: "SKU: letters, numbers, dots, hyphens or underscores (2–64 chars).",
    }),
  barcode: optionalText(z.string().trim().max(64)),
  price: moneyInputSchema,
  compareAtPrice: optionalMoneyInputSchema,
  cost: optionalMoneyInputSchema,
  options: variantOptionsSchema,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type ProductVariantInput = z.input<typeof productVariantSchema>;
export type ProductVariantValues = z.output<typeof productVariantSchema>;

export const productImageSchema = z.object({
  productId: uuidSchema,
  path: storagePathSchema,
  altText: optionalText(z.string().trim().max(200)),
});

export const inventoryAdjustmentSchema = z.object({
  variantId: uuidSchema,
  quantityDelta: z.preprocess(
    (value) => (typeof value === "string" ? Number(value) : value),
    z
      .number({ error: "Enter a whole number." })
      .int({ error: "Enter a whole number." })
      .refine((value) => value !== 0, { error: "The change cannot be zero." })
      .refine((value) => Math.abs(value) <= 1_000_000, { error: "That change is too large." }),
  ),
  type: z.enum(["restock", "purchase", "manual_adjustment", "damaged", "return", "cancellation"]),
  reason: optionalText(z.string().trim().max(300)),
});
export type InventoryAdjustmentInput = z.input<typeof inventoryAdjustmentSchema>;

export const inventorySettingsSchema = z.object({
  variantId: uuidSchema,
  lowStockThreshold: z.preprocess(
    (value) => (typeof value === "string" ? Number(value) : value),
    z.number({ error: "Enter a whole number." }).int().min(0).max(100_000),
  ),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
});

// -----------------------------------------------------------------------------
// Admin review
// -----------------------------------------------------------------------------
export const approveApplicationSchema = z.object({
  applicationId: uuidSchema,
  slug: slugSchema,
  commissionRateBps: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    basisPointsSchema.optional(),
  ),
});

export const rejectApplicationSchema = z.object({
  applicationId: uuidSchema,
  reason: z.string().trim().min(3, { error: "Give the applicant a reason (at least 3 characters)." }).max(1000),
});

export const vendorStatusChangeSchema = z
  .object({
    vendorId: uuidSchema,
    status: z.enum(["approved", "suspended", "closed"]),
    reason: optionalText(z.string().trim().max(1000)),
  })
  .refine((data) => data.status !== "suspended" || Boolean(data.reason), {
    error: "A reason is required to suspend a vendor.",
    path: ["reason"],
  });

export const moderateProductSchema = z
  .object({
    productId: uuidSchema,
    approve: z.boolean(),
    reason: optionalText(z.string().trim().max(1000)),
  })
  .refine((data) => data.approve || Boolean(data.reason), {
    error: "A reason is required to reject a product.",
    path: ["reason"],
  });

// -----------------------------------------------------------------------------
// Public catalog queries
// -----------------------------------------------------------------------------
export const CATALOG_SORTS = ["newest", "price_asc", "price_desc", "name"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const catalogQuerySchema = z.object({
  q: optionalText(z.string().trim().max(120)),
  category: optionalText(slugSchema),
  brand: optionalText(slugSchema),
  store: optionalText(slugSchema),
  sort: z.enum(CATALOG_SORTS).catch("newest"),
  page: z.coerce.number().int().min(1).catch(1),
  inStock: z.preprocess((value) => value === "1" || value === "true" || value === true, z.boolean()).catch(false),
});
export type CatalogQuery = z.output<typeof catalogQuerySchema>;
