"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import type { Product } from "@/lib/supabase/database.types";
import { productDetailsSchema, type ProductDetailsInput, type ProductDetailsValues } from "@/lib/validation";
import { createProduct, updateProductDetails } from "../actions";

const FIELDS = [
  "name",
  "categoryId",
  "brandId",
  "shortDescription",
  "description",
  "tags",
  "currency",
  "weightGrams",
  "seoTitle",
  "seoDescription",
] as const;

interface Option {
  id: string;
  name: string;
  depth?: number;
}

interface ProductDetailsFormProps {
  product: Product | null;
  categories: Option[];
  brands: Option[];
  defaultCurrency: string;
}

export function ProductDetailsForm({ product, categories, brands, defaultCurrency }: ProductDetailsFormProps) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const form = useForm<ProductDetailsInput, unknown, ProductDetailsValues>({
    resolver: zodResolver(productDetailsSchema),
    defaultValues: {
      name: product?.name ?? "",
      categoryId: product?.category_id ?? "",
      brandId: product?.brand_id ?? "",
      shortDescription: product?.short_description ?? "",
      description: product?.description ?? "",
      tags: product?.tags.join(", ") ?? "",
      currency: product?.currency ?? defaultCurrency,
      requiresShipping: product?.requires_shipping ?? true,
      weightGrams: product?.weight_grams?.toString() ?? "",
      seoTitle: product?.seo_title ?? "",
      seoDescription: product?.seo_description ?? "",
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setStatus(null);
    startTransition(async () => {
      const result = product ? await updateProductDetails(product.id, values) : await createProduct(values);
      if (result && !result.ok) {
        const message = applyActionError(form.setError, result.error, FIELDS);
        if (message) setStatus({ kind: "error", message });
        return;
      }
      if (product) {
        setStatus({ kind: "success", message: "Product details saved." });
        form.reset(values);
      }
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
      <FormField id="name" label="Product name" error={errors.name?.message}>
        <Input {...form.register("name")} />
      </FormField>
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="categoryId" label="Category" error={errors.categoryId?.message}>
          <Select {...form.register("categoryId")}>
            <option value="">No category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {`${"— ".repeat(category.depth ?? 0)}${category.name}`}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="brandId" label="Brand" error={errors.brandId?.message}>
          <Select {...form.register("brandId")}>
            <option value="">No brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField
        id="shortDescription"
        label="Summary"
        hint="Shown on product cards. Up to 300 characters."
        error={errors.shortDescription?.message}
      >
        <Input {...form.register("shortDescription")} />
      </FormField>
      <FormField id="description" label="Description" error={errors.description?.message}>
        <Textarea rows={8} {...form.register("description")} />
      </FormField>
      <div className="grid gap-5 md:grid-cols-3">
        <FormField id="tags" label="Tags" hint="Comma separated." error={errors.tags?.message}>
          <Input {...form.register("tags")} />
        </FormField>
        <FormField id="currency" label="Currency" hint="ISO code, e.g. USD." error={errors.currency?.message}>
          <Input
            maxLength={3}
            className="uppercase read-only:opacity-60"
            readOnly={Boolean(product)}
            {...form.register("currency")}
          />
        </FormField>
        <FormField id="weightGrams" label="Weight (grams)" error={errors.weightGrams?.message}>
          <Input type="number" inputMode="numeric" min={0} {...form.register("weightGrams")} />
        </FormField>
      </div>
      <CheckboxField
        label="Requires shipping"
        description="Untick for digital goods or services."
        {...form.register("requiresShipping")}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="seoTitle" label="SEO title" error={errors.seoTitle?.message}>
          <Input {...form.register("seoTitle")} />
        </FormField>
        <FormField id="seoDescription" label="SEO description" error={errors.seoDescription?.message}>
          <Input {...form.register("seoDescription")} />
        </FormField>
      </div>
      <div>
        <Button type="submit" loading={pending} disabled={Boolean(product) && !form.formState.isDirty}>
          {product ? "Save details" : "Create product"}
        </Button>
      </div>
    </form>
  );
}
