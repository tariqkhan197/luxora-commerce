import "server-only";

import { cache } from "react";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Category, ProductListing } from "@/lib/supabase/database.types";
import { uuidSchema, type CatalogQuery } from "@/lib/validation";
import { toPrefixTsQuery } from "./helpers";

export { categorySubtreeIds, toPrefixTsQuery } from "./helpers";

/**
 * Read-side catalog queries for the public storefront. Everything reads the
 * `product_listings` view, which only ever contains active products of
 * approved vendors, so no additional visibility filtering is needed here.
 */

export const PAGE_SIZE = 24;

export interface ProductPage {
  items: ProductListing[];
  total: number;
  page: number;
  pageCount: number;
}

interface ListProductsOptions {
  categoryIds?: string[];
  brandId?: string;
  vendorId?: string;
  productIds?: string[];
}

export async function listProducts(query: CatalogQuery, options: ListProductsOptions = {}): Promise<ProductPage> {
  const supabase = await createClient();
  let request = supabase.from("product_listings").select("*", { count: "exact" });

  if (options.categoryIds && options.categoryIds.length > 0) request = request.in("category_id", options.categoryIds);
  if (options.brandId) request = request.eq("brand_id", options.brandId);
  if (options.vendorId) request = request.eq("vendor_id", options.vendorId);
  if (options.productIds) {
    if (options.productIds.length === 0) return { items: [], total: 0, page: 1, pageCount: 0 };
    request = request.in("id", options.productIds);
  }
  if (query.inStock) request = request.eq("in_stock", true);

  const tsquery = query.q ? toPrefixTsQuery(query.q) : null;
  if (tsquery) request = request.textSearch("search_vector", tsquery, { config: "simple" });

  switch (query.sort) {
    case "price_asc":
      request = request.order("min_price_minor", { ascending: true, nullsFirst: false });
      break;
    case "price_desc":
      request = request.order("min_price_minor", { ascending: false, nullsFirst: false });
      break;
    case "name":
      request = request.order("name", { ascending: true });
      break;
    default:
      request = request.order("published_at", { ascending: false, nullsFirst: false });
  }
  request = request.order("id", { ascending: true });

  const from = (query.page - 1) * PAGE_SIZE;
  const { data, error, count } = await request.range(from, from + PAGE_SIZE - 1);
  if (error) throw fromPostgrestError(error);

  const total = count ?? 0;
  return { items: data ?? [], total, page: query.page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** All active categories (small table) — cached per request. */
export const getCategories = cache(async (): Promise<Category[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("position")
    .order("name");
  if (error) throw fromPostgrestError(error);
  return data ?? [];
});

/** Active brands for the public brand index, alphabetically. */
export async function listActiveBrands() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("id, slug, name, logo_path, is_verified")
    .eq("is_active", true)
    .order("name");
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

/**
 * Brands a vendor may assign to products: its own brand(s) and brands no
 * vendor owns (the same rule `enforce_product_brand_usage` applies). The
 * product's current brand is kept in the list so editing never drops it.
 */
export async function getBrandsForVendor(vendorId: string, currentBrandId?: string | null) {
  const vendor = uuidSchema.parse(vendorId);
  const current = currentBrandId ? uuidSchema.parse(currentBrandId) : null;
  const allowed = `and(is_active.eq.true,or(owner_vendor_id.is.null,owner_vendor_id.eq.${vendor}))`;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select("id, slug, name")
    .or(current ? `${allowed},id.eq.${current}` : allowed)
    .order("name");
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}

export async function getProductBySlug(slug: string) {
  const supabase = await createClient();
  const { data: listing, error } = await supabase.from("product_listings").select("*").eq("slug", slug).maybeSingle();
  if (error) throw fromPostgrestError(error);
  if (!listing?.id) return null;
  const productId = listing.id;

  const [
    { data: product, error: productError },
    { data: variants, error: variantError },
    { data: images, error: imageError },
  ] = await Promise.all([
    supabase
      .from("products")
      .select("description, attributes, requires_shipping, weight_grams")
      .eq("id", productId)
      .single(),
    supabase.from("product_variant_availability").select("*").eq("product_id", productId).order("position"),
    supabase
      .from("product_images")
      .select("id, storage_path, alt_text, variant_id, position, is_primary")
      .eq("product_id", productId)
      .order("is_primary", { ascending: false })
      .order("position"),
  ]);
  if (productError) throw fromPostgrestError(productError);
  if (variantError) throw fromPostgrestError(variantError);
  if (imageError) throw fromPostgrestError(imageError);

  return { productId, listing, product, variants: variants ?? [], images: images ?? [] };
}

/** Lightweight search across stores and brands for the search page. */
export async function searchStoresAndBrands(term: string) {
  const supabase = await createClient();
  const pattern = `%${term.replace(/[%_]/g, "\\$&")}%`;
  const [{ data: stores, error: storeError }, { data: brands, error: brandError }] = await Promise.all([
    supabase.from("stores").select("slug, name, tagline, logo_path").ilike("name", pattern).limit(6),
    supabase.from("brands").select("slug, name, logo_path").ilike("name", pattern).limit(6),
  ]);
  if (storeError) throw fromPostgrestError(storeError);
  if (brandError) throw fromPostgrestError(brandError);
  return { stores: stores ?? [], brands: brands ?? [] };
}
