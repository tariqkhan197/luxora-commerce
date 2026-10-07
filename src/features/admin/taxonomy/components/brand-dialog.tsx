"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { slugify } from "@/lib/slug";
import { brandSchema, type BrandInput, type BrandValues } from "@/lib/validation";
import { saveBrand, updateBrandLogo } from "../actions";
import type { AdminBrand } from "../queries";
import { CatalogImageField } from "./catalog-image-field";

const FIELDS = ["name", "slug", "description", "websiteUrl", "ownerVendorId"] as const;

interface BrandDialogProps {
  trigger: ReactNode;
  vendors: { id: string; name: string }[];
  brand?: AdminBrand;
  logoUrl?: string | null;
}

export function BrandDialog({ trigger, vendors, brand, logoUrl }: BrandDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(brand));

  const defaults: BrandInput = {
    id: brand?.id ?? "",
    name: brand?.name ?? "",
    slug: brand?.slug ?? "",
    description: brand?.description ?? "",
    websiteUrl: brand?.websiteUrl ?? "",
    ownerVendorId: brand?.ownerVendorId ?? "",
    isVerified: brand?.isVerified ?? false,
    isActive: brand?.isActive ?? true,
  };
  const form = useForm<BrandInput, unknown, BrandValues>({
    resolver: zodResolver(brandSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const id = (name: string) => `${brand?.id ?? "new"}-brand-${name}`;
  const nameField = form.register("name");

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveBrand(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(defaults);
          setFormError(null);
          setSlugTouched(Boolean(brand));
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{brand ? `Edit ${brand.name}` : "New brand"}</DialogTitle>
          <DialogDescription>
            A brand owned by a vendor can only be used by that vendor. Brands without an owner are available to every
            vendor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={id("name")} label="Name" error={errors.name?.message}>
              <Input
                {...nameField}
                onChange={(event) => {
                  void nameField.onChange(event);
                  if (!slugTouched) form.setValue("slug", slugify(event.target.value));
                }}
              />
            </FormField>
            <FormField id={id("slug")} label="URL slug" error={errors.slug?.message}>
              <Input {...form.register("slug", { onChange: () => setSlugTouched(true) })} />
            </FormField>
          </div>
          <FormField id={id("ownerVendorId")} label="Owner" error={errors.ownerVendorId?.message}>
            <Select {...form.register("ownerVendorId")}>
              <option value="">No owner (available to all vendors)</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id={id("websiteUrl")} label="Website (optional)" error={errors.websiteUrl?.message}>
            <Input type="url" placeholder="https://" {...form.register("websiteUrl")} />
          </FormField>
          <FormField id={id("description")} label="Description (optional)" error={errors.description?.message}>
            <Textarea rows={3} {...form.register("description")} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckboxField
              label="Verified"
              description="Shows a verified mark on the brand page."
              {...form.register("isVerified")}
            />
            <CheckboxField
              label="Active"
              description="Inactive brands are hidden and cannot be chosen for products."
              {...form.register("isActive")}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {brand ? "Save brand" : "Create brand"}
            </Button>
          </DialogFooter>
        </form>
        {brand ? (
          <CatalogImageField
            kind="brands"
            entityId={brand.id}
            imageUrl={logoUrl ?? null}
            label="Logo"
            hint="Square works best. JPEG, PNG, WebP or AVIF up to 5 MB."
            contain
            save={(path) => updateBrandLogo({ id: brand.id, path })}
          />
        ) : (
          <p className="text-xs text-ink-faint">You can add a logo after creating the brand.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
