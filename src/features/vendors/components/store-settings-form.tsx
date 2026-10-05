"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { slugify } from "@/lib/slug";
import type { Store } from "@/lib/supabase/database.types";
import { storeSettingsSchema, type StoreSettingsInput, type StoreSettingsValues } from "@/lib/validation";
import { updateStoreSettings } from "../store-actions";

const FIELDS = [
  "name",
  "slug",
  "tagline",
  "description",
  "returnPolicy",
  "shippingPolicy",
  "seoTitle",
  "seoDescription",
] as const;

export function StoreSettingsForm({ store, fallbackName }: { store: Store | null; fallbackName: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const form = useForm<StoreSettingsInput, unknown, StoreSettingsValues>({
    resolver: zodResolver(storeSettingsSchema),
    defaultValues: {
      name: store?.name ?? fallbackName,
      slug: store?.slug ?? slugify(fallbackName),
      tagline: store?.tagline ?? "",
      description: store?.description ?? "",
      returnPolicy: store?.return_policy ?? "",
      shippingPolicy: store?.shipping_policy ?? "",
      seoTitle: store?.seo_title ?? "",
      seoDescription: store?.seo_description ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setStatus(null);
    startTransition(async () => {
      const result = await updateStoreSettings(values);
      if (!result.ok) {
        const message = applyActionError(form.setError, result.error, FIELDS);
        if (message) setStatus({ kind: "error", message });
        return;
      }
      setStatus({ kind: "success", message: "Store details saved." });
      form.reset(values);
    });
  });

  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {status ? (
        <Alert variant={status.kind === "error" ? "destructive" : "success"}>
          {status.kind === "error" ? <AlertCircle /> : <CheckCircle2 />}
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="name" label="Store name" error={errors.name?.message}>
          <Input {...form.register("name")} />
        </FormField>
        <FormField id="slug" label="Store URL" hint="luxora.com/store/<slug>" error={errors.slug?.message}>
          <Input {...form.register("slug")} />
        </FormField>
      </div>
      <FormField id="tagline" label="Tagline" hint="One line under your store name." error={errors.tagline?.message}>
        <Input {...form.register("tagline")} />
      </FormField>
      <FormField id="description" label="About the store" error={errors.description?.message}>
        <Textarea rows={5} {...form.register("description")} />
      </FormField>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="shippingPolicy" label="Shipping policy" error={errors.shippingPolicy?.message}>
          <Textarea rows={4} {...form.register("shippingPolicy")} />
        </FormField>
        <FormField id="returnPolicy" label="Return policy" error={errors.returnPolicy?.message}>
          <Textarea rows={4} {...form.register("returnPolicy")} />
        </FormField>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="seoTitle" label="SEO title" hint="Up to 70 characters." error={errors.seoTitle?.message}>
          <Input {...form.register("seoTitle")} />
        </FormField>
        <FormField
          id="seoDescription"
          label="SEO description"
          hint="Up to 200 characters."
          error={errors.seoDescription?.message}
        >
          <Input {...form.register("seoDescription")} />
        </FormField>
      </div>
      <div>
        <Button type="submit" loading={pending} disabled={!form.formState.isDirty && Boolean(store)}>
          {store ? "Save changes" : "Create store"}
        </Button>
      </div>
    </form>
  );
}
