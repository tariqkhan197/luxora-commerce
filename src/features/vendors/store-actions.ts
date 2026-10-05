"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertVendorContext } from "@/lib/auth/dal";
import { AppError, fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { isOwnedStoragePath } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import { storeBrandingSchema, storePublishSchema, storeSettingsSchema } from "@/lib/validation";

const MANAGERS = ["owner", "manager"] as const;

function revalidateStore(slug?: string | null) {
  revalidatePath(ROUTES.vendor.storefront);
  revalidatePath(ROUTES.vendor.dashboard);
  if (slug) revalidatePath(ROUTES.store(slug));
}

export async function updateStoreSettings(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const values = storeSettingsSchema.parse(input);
    const { vendor } = await assertVendorContext(MANAGERS);
    const supabase = await createClient();

    const { data: existing, error: existingError } = await supabase
      .from("stores")
      .select("id, slug")
      .eq("vendor_id", vendor.id)
      .maybeSingle();
    if (existingError) throw fromPostgrestError(existingError);

    const payload = {
      name: values.name,
      slug: values.slug,
      tagline: values.tagline ?? null,
      description: values.description ?? null,
      return_policy: values.returnPolicy ?? null,
      shipping_policy: values.shippingPolicy ?? null,
      seo_title: values.seoTitle ?? null,
      seo_description: values.seoDescription ?? null,
    };

    const { error } = existing
      ? await supabase.from("stores").update(payload).eq("id", existing.id)
      : await supabase.from("stores").insert({ ...payload, vendor_id: vendor.id });
    if (error) {
      if (error.code === "23505") throw AppError.conflict("That store URL is already taken. Choose another slug.");
      throw fromPostgrestError(error);
    }
    revalidateStore(existing?.slug);
    revalidateStore(values.slug);
  });
}

export async function updateStoreBranding(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { kind, path } = storeBrandingSchema.parse(input);
    const { vendor } = await assertVendorContext(MANAGERS);
    if (path && !isOwnedStoragePath(path, vendor.id, { depth: 1 })) {
      throw AppError.validation({ path: ["The uploaded file does not belong to your vendor folder."] });
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stores")
      .update(kind === "logo" ? { logo_path: path } : { cover_path: path })
      .eq("vendor_id", vendor.id)
      .select("slug")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.validation({ _form: ["Save your store details before adding images."] });
    revalidateStore(data.slug);
  });
}

export async function setStorePublished(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { publish } = storePublishSchema.parse(input);
    const { vendor } = await assertVendorContext(MANAGERS);
    if (publish && vendor.status !== "approved") {
      throw AppError.forbidden("Your vendor account must be approved before the store can be published.");
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("stores")
      .update(publish ? { status: "published", published_at: new Date().toISOString() } : { status: "unpublished" })
      .eq("vendor_id", vendor.id)
      .select("slug")
      .maybeSingle();
    if (error) throw fromPostgrestError(error);
    if (!data) throw AppError.validation({ _form: ["Save your store details before publishing."] });
    revalidateStore(data.slug);
  });
}
