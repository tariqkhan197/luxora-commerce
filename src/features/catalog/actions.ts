"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ROUTES } from "@/config/routes";
import { assertVendorContext } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { parseToMinor } from "@/lib/money";
import { slugify, withRandomSuffix } from "@/lib/slug";
import { isOwnedStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import {
  inventoryAdjustmentSchema,
  inventorySettingsSchema,
  productDetailsSchema,
  productImageSchema,
  productVariantSchema,
  uuidSchema,
} from "@/lib/validation";

/**
 * Vendor catalog Server Actions. Authorization is enforced twice: here via
 * `assertVendorContext()` (clear errors, early exit) and in the database via
 * RLS and the locked-column triggers (authoritative).
 */

function revalidateProduct(productId: string, slug?: string | null) {
  revalidatePath(ROUTES.vendor.products);
  revalidatePath(ROUTES.vendor.product(productId));
  revalidatePath(ROUTES.vendor.inventory);
  revalidatePath(ROUTES.vendor.dashboard);
  if (slug) revalidatePath(ROUTES.product(slug));
}

/** Loads a product and verifies it belongs to the caller's vendor. */
async function ownedProduct(productId: string) {
  const { vendor } = await assertVendorContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, status, vendor_id")
    .eq("id", productId)
    .maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!data || data.vendor_id !== vendor.id) throw AppError.notFound("Product not found.");
  return { vendor, supabase, product: data };
}

/** Editable product columns. Currency is excluded: it is fixed at creation because variant prices are in its minor units. */
function detailsToRow(values: ReturnType<typeof productDetailsSchema.parse>) {
  return {
    name: values.name,
    category_id: values.categoryId ?? null,
    brand_id: values.brandId ?? null,
    short_description: values.shortDescription ?? null,
    description: values.description ?? null,
    tags: values.tags,
    requires_shipping: values.requiresShipping,
    weight_grams: values.weightGrams ?? null,
    seo_title: values.seoTitle ?? null,
    seo_description: values.seoDescription ?? null,
  };
}

export async function createProduct(input: unknown): Promise<ActionResult<{ id: string }>> {
  let createdId: string | null = null;
  const result = await runAction(async () => {
    const values = productDetailsSchema.parse(input);
    const { vendor } = await assertVendorContext();
    if (vendor.status !== "approved")
      throw AppError.forbidden("Your vendor account must be approved before creating products.");
    const supabase = await createClient();

    const base = slugify(values.name) || "product";
    let slug = base;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error } = await supabase
        .from("products")
        .insert({ ...detailsToRow(values), currency: values.currency, vendor_id: vendor.id, slug })
        .select("id")
        .single();
      if (!error) {
        createdId = data.id;
        revalidatePath(ROUTES.vendor.products);
        return { id: data.id };
      }
      if (error.code !== "23505") throw fromPostgrestError(error);
      slug = withRandomSuffix(base);
    }
    throw AppError.conflict("Could not find a unique URL for this product. Try a different name.");
  });
  if (result.ok && createdId) redirect(ROUTES.vendor.product(createdId));
  return result;
}

export async function updateProductDetails(productId: unknown, input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const values = productDetailsSchema.parse(input);
    const { supabase, product } = await ownedProduct(id);
    const { error } = await supabase.from("products").update(detailsToRow(values)).eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function submitProductForReview(productId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    if (!["draft", "rejected"].includes(product.status)) {
      throw AppError.validation({ _form: ["Only draft or rejected products can be submitted for review."] });
    }
    const { count, error: variantError } = await supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id)
      .eq("is_active", true);
    if (variantError) throw fromPostgrestError(variantError);
    if (!count)
      throw AppError.validation({ _form: ["Add at least one active variant with a price before submitting."] });
    const { count: imageCount, error: imageError } = await supabase
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id);
    if (imageError) throw fromPostgrestError(imageError);
    if (!imageCount) throw AppError.validation({ _form: ["Add at least one image before submitting."] });

    const { error } = await supabase.from("products").update({ status: "pending_review" }).eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
    revalidatePath(ROUTES.admin.products);
  });
}

export async function withdrawProductFromReview(productId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    if (product.status !== "pending_review")
      throw AppError.validation({ _form: ["This product is not awaiting review."] });
    const { error } = await supabase.from("products").update({ status: "draft" }).eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function unpublishProduct(productId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    const { error } = await supabase.rpc("unpublish_product", { p_product_id: id });
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function archiveProduct(productId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    if (product.status === "active")
      throw AppError.validation({ _form: ["Unpublish the product before archiving it."] });
    const { error } = await supabase.from("products").update({ status: "archived" }).eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function restoreProduct(productId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    if (product.status !== "archived")
      throw AppError.validation({ _form: ["Only archived products can be restored."] });
    const { error } = await supabase.from("products").update({ status: "draft" }).eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function deleteDraftProduct(productId: unknown): Promise<ActionResult<void>> {
  const result = await runAction(async () => {
    const id = uuidSchema.parse(productId);
    const { supabase, product } = await ownedProduct(id);
    if (product.status !== "draft")
      throw AppError.validation({ _form: ["Only drafts can be deleted. Archive published products instead."] });
    const { error, count } = await supabase.from("products").delete({ count: "exact" }).eq("id", id);
    if (error) throw historyBlocksDelete(error.code, "product") ?? fromPostgrestError(error);
    if (!count) throw AppError.forbidden("Only owners and managers can delete products.");
    revalidatePath(ROUTES.vendor.products);
  });
  if (result.ok) redirect(ROUTES.vendor.products);
  return result;
}

/** Append-only inventory history (SQLSTATE 23001) blocks deleting anything that has stock movements. */
function historyBlocksDelete(code: string | undefined, subject: string): AppError | null {
  return code === "23001"
    ? AppError.validation({
        _form: [`This ${subject} has inventory history and cannot be deleted. Archive or deactivate it instead.`],
      })
    : null;
}

// -----------------------------------------------------------------------------
// Variants
// -----------------------------------------------------------------------------
function optionsToJson(options: { name: string; value: string }[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.name, o.value]));
}

export async function upsertVariant(
  productId: unknown,
  variantId: unknown,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const existingId = variantId ? uuidSchema.parse(variantId) : null;
    const values = productVariantSchema.parse(input);
    const { vendor, supabase, product } = await ownedProduct(id);

    const { data: productRow, error: currencyError } = await supabase
      .from("products")
      .select("currency")
      .eq("id", id)
      .single();
    if (currencyError) throw fromPostgrestError(currencyError);

    const priceMinor = parseToMinor(values.price, productRow.currency);
    const compareAtMinor = values.compareAtPrice ? parseToMinor(values.compareAtPrice, productRow.currency) : null;
    const costMinor = values.cost ? parseToMinor(values.cost, productRow.currency) : null;
    if (compareAtMinor !== null && compareAtMinor < priceMinor) {
      throw AppError.validation({ compareAtPrice: ["Compare-at price must be at least the selling price."] });
    }

    const row = {
      title: values.title,
      sku: values.sku,
      barcode: values.barcode ?? null,
      price_minor: priceMinor,
      compare_at_price_minor: compareAtMinor,
      cost_minor: costMinor,
      options: optionsToJson(values.options),
      is_default: values.isDefault,
      is_active: values.isActive,
    };

    // Only one default per product (partial unique index): clear the previous default first.
    if (values.isDefault) {
      const clear = supabase
        .from("product_variants")
        .update({ is_default: false })
        .eq("product_id", id)
        .eq("is_default", true);
      const { error } = existingId ? await clear.neq("id", existingId) : await clear;
      if (error) throw fromPostgrestError(error);
    }

    const query = existingId
      ? supabase.from("product_variants").update(row).eq("id", existingId).eq("product_id", id).select("id").single()
      : supabase
          .from("product_variants")
          .insert({ ...row, product_id: id })
          .select("id")
          .single();
    const { data, error } = await query;
    if (error) {
      if (error.code === "23505") throw AppError.validation({ sku: ["This SKU is already used by another variant."] });
      throw fromPostgrestError(error);
    }

    // Every variant gets an inventory record (zero stock) so it can be adjusted.
    if (!existingId) {
      // vendor_id is re-derived by the inventory_sync_vendor trigger from the variant's product.
      const { error: inventoryError } = await supabase
        .from("inventory")
        .insert({ variant_id: data.id, vendor_id: vendor.id });
      if (inventoryError && inventoryError.code !== "23505") throw fromPostgrestError(inventoryError);
    }

    revalidateProduct(id, product.slug);
    return { id: data.id };
  });
}

export async function deleteVariant(productId: unknown, variantId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const vId = uuidSchema.parse(variantId);
    const { supabase, product } = await ownedProduct(id);
    if (product.status === "active") {
      throw AppError.validation({
        _form: ["Unpublish the product before removing variants, or deactivate the variant instead."],
      });
    }
    const { error } = await supabase.from("product_variants").delete().eq("id", vId).eq("product_id", id);
    if (error) throw historyBlocksDelete(error.code, "variant") ?? fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

// -----------------------------------------------------------------------------
// Images
// -----------------------------------------------------------------------------
export async function addProductImage(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const values = productImageSchema.parse(input);
    const { vendor, supabase, product } = await ownedProduct(values.productId);
    if (!isOwnedStoragePath(values.path, vendor.id) || values.path.split("/")[1] !== product.id) {
      throw AppError.validation({ path: ["The uploaded file does not belong to this product."] });
    }
    const { count, error: countError } = await supabase
      .from("product_images")
      .select("id", { count: "exact", head: true })
      .eq("product_id", product.id);
    if (countError) throw fromPostgrestError(countError);
    if ((count ?? 0) >= 12) throw AppError.validation({ _form: ["A product can have at most 12 images."] });

    const { data, error } = await supabase
      .from("product_images")
      .insert({
        product_id: product.id,
        storage_path: values.path,
        alt_text: values.altText ?? null,
        position: count ?? 0,
        is_primary: (count ?? 0) === 0,
      })
      .select("id")
      .single();
    if (error) throw fromPostgrestError(error);
    revalidateProduct(product.id, product.slug);
    return { id: data.id };
  });
}

export async function setPrimaryImage(productId: unknown, imageId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const image = uuidSchema.parse(imageId);
    const { supabase, product } = await ownedProduct(id);
    const { error: clearError } = await supabase
      .from("product_images")
      .update({ is_primary: false })
      .eq("product_id", id)
      .eq("is_primary", true);
    if (clearError) throw fromPostgrestError(clearError);
    const { error } = await supabase
      .from("product_images")
      .update({ is_primary: true })
      .eq("id", image)
      .eq("product_id", id);
    if (error) throw fromPostgrestError(error);
    revalidateProduct(id, product.slug);
  });
}

export async function removeProductImage(productId: unknown, imageId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(productId);
    const image = uuidSchema.parse(imageId);
    const { supabase, product } = await ownedProduct(id);
    const { data: row, error: rowError } = await supabase
      .from("product_images")
      .select("storage_path, is_primary")
      .eq("id", image)
      .eq("product_id", id)
      .maybeSingle();
    if (rowError) throw fromPostgrestError(rowError);
    if (!row) throw AppError.notFound("Image not found.");

    const { error } = await supabase.from("product_images").delete().eq("id", image);
    if (error) throw fromPostgrestError(error);
    // Best-effort object removal; the row is the source of truth.
    await supabase.storage.from("product-images").remove([row.storage_path]);

    if (row.is_primary) {
      const { data: next } = await supabase
        .from("product_images")
        .select("id")
        .eq("product_id", id)
        .order("position")
        .limit(1)
        .maybeSingle();
      if (next) await supabase.from("product_images").update({ is_primary: true }).eq("id", next.id);
    }
    revalidateProduct(id, product.slug);
  });
}

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------
export async function adjustInventory(input: unknown): Promise<ActionResult<{ stockQuantity: number }>> {
  return runAction(async () => {
    const values = inventoryAdjustmentSchema.parse(input);
    await assertVendorContext();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("adjust_inventory", {
      p_variant_id: values.variantId,
      p_quantity_delta: values.quantityDelta,
      p_type: values.type,
      p_reason: values.reason ?? undefined,
    });
    if (error) throw fromPostgrestError(error);
    revalidatePath(ROUTES.vendor.inventory);
    revalidatePath(ROUTES.vendor.dashboard);
    revalidatePath(ROUTES.vendor.products);
    return { stockQuantity: data.stock_quantity };
  });
}

export async function updateInventorySettings(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = inventorySettingsSchema.parse(input);
    await assertVendorContext();
    const supabase = await createClient();
    const { error, count } = await supabase
      .from("inventory")
      .update(
        {
          low_stock_threshold: values.lowStockThreshold,
          track_inventory: values.trackInventory,
          allow_backorder: values.allowBackorder,
        },
        { count: "exact" },
      )
      .eq("variant_id", values.variantId);
    if (error) throw fromPostgrestError(error);
    if (!count) throw AppError.notFound("Inventory record not found.");
    revalidatePath(ROUTES.vendor.inventory);
  });
}
