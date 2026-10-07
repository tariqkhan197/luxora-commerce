"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertRole } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { isCatalogAssetPath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { brandSchema, catalogImageSchema, categorySchema, setActiveSchema, uuidSchema } from "@/lib/validation";

const ADMIN_ROLES = ["admin", "super_admin"] as const;

/**
 * Admin category and brand management. RLS limits writes to admins; triggers
 * enforce the 3-level depth limit and block deleting anything in use, and
 * every change is audited by `audit_catalog_taxonomy`.
 */

function revalidateTaxonomy(adminPath: string) {
  revalidatePath(adminPath);
  // Categories and brands appear in navigation, filters and listings site-wide.
  revalidatePath("/", "layout");
}

function slugConflict(error: { code?: string }) {
  if (error.code === "23505") {
    return AppError.validation({ slug: ["That slug is already in use. Choose another."] });
  }
  return null;
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------
export async function saveCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const values = categorySchema.parse(input);
    await assertRole(ADMIN_ROLES);
    if (values.id && values.parentId === values.id) {
      throw AppError.validation({ parentId: ["A category cannot be its own parent."] });
    }
    const supabase = await createClient();
    if (values.parentId && values.isActive) {
      const { data: parent, error: parentError } = await supabase
        .from("categories")
        .select("is_active")
        .eq("id", values.parentId)
        .maybeSingle();
      if (parentError) throw fromPostgrestError(parentError);
      if (!parent) throw AppError.validation({ parentId: ["Choose an existing parent category."] });
      if (!parent.is_active) {
        throw AppError.validation({
          parentId: ["The parent is inactive. Activate it first, or save this one as inactive."],
        });
      }
    }
    const payload = {
      name: values.name,
      slug: values.slug,
      parent_id: values.parentId ?? null,
      description: values.description ?? null,
      position: values.position,
      commission_rate_bps: values.commissionRate ?? null,
    };

    if (!values.id) {
      const { data, error } = await supabase
        .from("categories")
        .insert({ ...payload, is_active: values.isActive })
        .select("id")
        .single();
      if (error) throw slugConflict(error) ?? fromPostgrestError(error);
      revalidateTaxonomy(ROUTES.admin.categories);
      return { id: data.id };
    }

    const { data: current, error: currentError } = await supabase
      .from("categories")
      .update(payload)
      .eq("id", values.id)
      .select("id, is_active")
      .maybeSingle();
    if (currentError) throw slugConflict(currentError) ?? fromPostgrestError(currentError);
    if (!current) throw AppError.notFound("Category not found.");
    // Activation goes through the RPC so deactivation cascades to subcategories.
    if (current.is_active !== values.isActive) {
      const { error } = await supabase.rpc("set_category_active", {
        p_category_id: values.id,
        p_active: values.isActive,
      });
      if (error) throw fromPostgrestError(error);
    }
    revalidateTaxonomy(ROUTES.admin.categories);
    return { id: values.id };
  });
}

export async function setCategoryActive(input: unknown): Promise<ActionResult<{ changed: number }>> {
  return runAction(async () => {
    const { id, active } = setActiveSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_category_active", { p_category_id: id, p_active: active });
    if (error) throw fromPostgrestError(error);
    revalidateTaxonomy(ROUTES.admin.categories);
    return { changed: data };
  });
}

export async function deleteCategory(categoryId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(categoryId);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateTaxonomy(ROUTES.admin.categories);
  });
}

export async function updateCategoryImage(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { id, path } = catalogImageSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    if (path && !isCatalogAssetPath(path, "categories", id)) {
      throw AppError.validation({ path: ["The uploaded file is not in this category's folder."] });
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("categories")
      .update({ image_path: path })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Category not found.");
    revalidateTaxonomy(ROUTES.admin.categories);
  });
}

// -----------------------------------------------------------------------------
// Brands
// -----------------------------------------------------------------------------
export async function saveBrand(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const values = brandSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const payload = {
      name: values.name,
      slug: values.slug,
      description: values.description ?? null,
      website_url: values.websiteUrl ?? null,
      owner_vendor_id: values.ownerVendorId ?? null,
      is_verified: values.isVerified,
      is_active: values.isActive,
    };
    const { data, error } = values.id
      ? await supabase.from("brands").update(payload).eq("id", values.id).select("id").maybeSingle()
      : await supabase.from("brands").insert(payload).select("id").single();
    if (error) throw slugConflict(error) ?? fromPostgrestError(error);
    if (!data) throw AppError.notFound("Brand not found.");
    revalidateTaxonomy(ROUTES.admin.brands);
    return { id: data.id };
  });
}

export async function setBrandActive(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { id, active } = setActiveSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("brands")
      .update({ is_active: active })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Brand not found.");
    revalidateTaxonomy(ROUTES.admin.brands);
  });
}

export async function deleteBrand(brandId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(brandId);
    await assertRole(ADMIN_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) throw fromPostgrestError(error);
    revalidateTaxonomy(ROUTES.admin.brands);
  });
}

export async function updateBrandLogo(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { id, path } = catalogImageSchema.parse(input);
    await assertRole(ADMIN_ROLES);
    if (path && !isCatalogAssetPath(path, "brands", id)) {
      throw AppError.validation({ path: ["The uploaded file is not in this brand's folder."] });
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("brands")
      .update({ logo_path: path })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.notFound("Brand not found.");
    revalidateTaxonomy(ROUTES.admin.brands);
  });
}
