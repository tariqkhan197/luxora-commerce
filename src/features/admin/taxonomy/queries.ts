import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/** Admin-side taxonomy reads. RLS lets admins see inactive rows too. */

export interface AdminCategory {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imagePath: string | null;
  position: number;
  isActive: boolean;
  commissionRateBps: number | null;
  productCount: number;
}

export async function getAdminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select(
      "id, parent_id, name, slug, description, image_path, position, is_active, commission_rate_bps, products!products_category_id_fkey(count)",
    )
    .order("position")
    .order("name");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imagePath: row.image_path,
    position: row.position,
    isActive: row.is_active,
    commissionRateBps: row.commission_rate_bps,
    productCount: row.products[0]?.count ?? 0,
  }));
}

export interface AdminBrand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  websiteUrl: string | null;
  logoPath: string | null;
  ownerVendorId: string | null;
  ownerVendorName: string | null;
  isVerified: boolean;
  isActive: boolean;
  productCount: number;
}

export async function getAdminBrands(): Promise<AdminBrand[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brands")
    .select(
      "id, name, slug, description, website_url, logo_path, owner_vendor_id, is_verified, is_active, vendors!brands_owner_vendor_id_fkey(display_name), products!products_brand_id_fkey(count)",
    )
    .order("name");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    websiteUrl: row.website_url,
    logoPath: row.logo_path,
    ownerVendorId: row.owner_vendor_id,
    ownerVendorName: row.vendors?.display_name ?? null,
    isVerified: row.is_verified,
    isActive: row.is_active,
    productCount: row.products[0]?.count ?? 0,
  }));
}

/**
 * Vendors an admin can assign as a brand owner. Every status is listed (labelled
 * when not approved) so editing a brand never silently drops its current owner.
 */
export async function getVendorOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("vendors").select("id, display_name, status").order("display_name");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map((vendor) => ({
    id: vendor.id,
    name: vendor.status === "approved" ? vendor.display_name : `${vendor.display_name} (${vendor.status})`,
  }));
}
