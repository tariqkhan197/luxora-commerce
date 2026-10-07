"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
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
import { categorySchema, type CategoryInput, type CategoryValues } from "@/lib/validation";
import { saveCategory, updateCategoryImage } from "../actions";
import { allowedParents, MAX_CATEGORY_DEPTH, type TreeCategory } from "../tree";
import { CatalogImageField } from "./catalog-image-field";

const FIELDS = ["name", "slug", "parentId", "description", "position", "commissionRate"] as const;

export interface CategoryFormData extends TreeCategory {
  slug: string;
  description: string | null;
  position: number;
  isActive: boolean;
  commissionRateBps: number | null;
}

interface CategoryDialogProps {
  trigger: ReactNode;
  /** All categories, used to offer valid parents. */
  categories: TreeCategory[];
  category?: CategoryFormData;
  /** Preselected parent when adding a subcategory. */
  defaultParentId?: string;
  imageUrl?: string | null;
}

/** 1250 bps → "12.5" (exact for whole basis points). */
function bpsToPercentInput(bps: number | null): string {
  return bps === null ? "" : String(bps / 100);
}

export function CategoryDialog({ trigger, categories, category, defaultParentId, imageUrl }: CategoryDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const parents = useMemo(() => allowedParents(categories, category?.id ?? null), [categories, category?.id]);

  const defaults: CategoryInput = {
    id: category?.id ?? "",
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    parentId: category?.parentId ?? defaultParentId ?? "",
    description: category?.description ?? "",
    position: String(category?.position ?? 0),
    isActive: category?.isActive ?? true,
    commissionRate: bpsToPercentInput(category?.commissionRateBps ?? null),
  };
  const form = useForm<CategoryInput, unknown, CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const id = (name: string) => `${category?.id ?? "new"}-category-${name}`;
  const nameField = form.register("name");

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveCategory(values);
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
          setSlugTouched(Boolean(category));
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : "New category"}</DialogTitle>
          <DialogDescription>
            Categories can be nested up to {MAX_CATEGORY_DEPTH} levels deep. Deactivating a category hides it and all of
            its subcategories from the storefront.
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
          <FormField
            id={id("parentId")}
            label="Parent"
            hint="Only parents that keep the tree within 3 levels are listed."
            error={errors.parentId?.message}
          >
            <Select {...form.register("parentId")}>
              <option value="">None (top-level department)</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {`${"— ".repeat(parent.depth)}${parent.name}`}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id={id("description")} label="Description (optional)" error={errors.description?.message}>
            <Textarea rows={3} {...form.register("description")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={id("commissionRate")}
              label="Commission rate % (optional)"
              hint="Blank inherits from the parent category or the platform default. A vendor's own rate takes precedence."
              error={errors.commissionRate?.message}
            >
              <Input inputMode="decimal" placeholder="e.g. 12.5" {...form.register("commissionRate")} />
            </FormField>
            <FormField
              id={id("position")}
              label="Sort position"
              hint="Lower numbers appear first."
              error={errors.position?.message}
            >
              <Input inputMode="numeric" {...form.register("position")} />
            </FormField>
          </div>
          <CheckboxField
            label="Active"
            description="Inactive categories are hidden from shoppers and cannot be chosen for new products."
            {...form.register("isActive")}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {category ? "Save category" : "Create category"}
            </Button>
          </DialogFooter>
        </form>
        {category ? (
          <CatalogImageField
            kind="categories"
            entityId={category.id}
            imageUrl={imageUrl ?? null}
            label="Image"
            hint="Shown on the home page and category pages. JPEG, PNG, WebP or AVIF up to 5 MB."
            save={(path) => updateCategoryImage({ id: category.id, path })}
          />
        ) : (
          <p className="text-xs text-ink-faint">You can add an image after creating the category.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
