"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { formatMoney } from "@/lib/money";
import { asOptionRecord, type ProductStatus, type ProductVariant } from "@/lib/supabase/database.types";
import { productVariantSchema, type ProductVariantInput, type ProductVariantValues } from "@/lib/validation";
import { deleteVariant, upsertVariant } from "../actions";

const FIELDS = ["title", "sku", "barcode", "price", "compareAtPrice", "cost", "options"] as const;

function toDecimal(minor: number | null, currency: string): string {
  if (minor === null) return "";
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return (minor / 10 ** digits).toFixed(digits);
}

interface VariantDialogProps {
  productId: string;
  currency: string;
  variant: ProductVariant | null;
  isFirst: boolean;
}

function VariantDialog({ productId, currency, variant, isFirst }: VariantDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const existingOptions = Object.entries(asOptionRecord(variant?.options)).map(([name, value]) => ({ name, value }));

  const form = useForm<ProductVariantInput, unknown, ProductVariantValues>({
    resolver: zodResolver(productVariantSchema),
    defaultValues: {
      title: variant?.title ?? (isFirst ? "Default" : ""),
      sku: variant?.sku ?? "",
      barcode: variant?.barcode ?? "",
      price: variant ? toDecimal(variant.price_minor, currency) : "",
      compareAtPrice: variant ? toDecimal(variant.compare_at_price_minor, currency) : "",
      cost: variant ? toDecimal(variant.cost_minor, currency) : "",
      options: existingOptions,
      isDefault: variant?.is_default ?? isFirst,
      isActive: variant?.is_active ?? true,
    },
  });
  const options = useFieldArray({ control: form.control, name: "options" });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await upsertVariant(productId, variant?.id ?? null, values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant ? (
          <Button size="sm" variant="ghost">
            Edit
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Plus /> Add variant
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{variant ? `Edit ${variant.title}` : "New variant"}</DialogTitle>
          <DialogDescription>
            Prices are in {currency}. Options describe what makes this variant distinct (size, colour…).
          </DialogDescription>
        </DialogHeader>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="variant-title" label="Title" error={errors.title?.message}>
              <Input {...form.register("title")} />
            </FormField>
            <FormField id="variant-sku" label="SKU" error={errors.sku?.message}>
              <Input {...form.register("sku")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="variant-price" label="Price" error={errors.price?.message}>
              <Input inputMode="decimal" placeholder="149.00" {...form.register("price")} />
            </FormField>
            <FormField id="variant-compare" label="Compare-at" error={errors.compareAtPrice?.message}>
              <Input inputMode="decimal" {...form.register("compareAtPrice")} />
            </FormField>
            <FormField id="variant-cost" label="Cost (private)" error={errors.cost?.message}>
              <Input inputMode="decimal" {...form.register("cost")} />
            </FormField>
          </div>
          <FormField id="variant-barcode" label="Barcode (optional)" error={errors.barcode?.message}>
            <Input {...form.register("barcode")} />
          </FormField>

          <fieldset className="grid gap-3">
            <legend className="text-xs font-medium tracking-wide text-ink-soft">Options</legend>
            {options.fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input placeholder="Size" aria-label="Option name" {...form.register(`options.${index}.name`)} />
                <Input placeholder="M" aria-label="Option value" {...form.register(`options.${index}.value`)} />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove option"
                  onClick={() => options.remove(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {errors.options?.message || errors.options?.root?.message ? (
              <p className="text-xs text-danger">{errors.options.message ?? errors.options.root?.message}</p>
            ) : null}
            {options.fields.length < 5 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => options.append({ name: "", value: "" })}
              >
                <Plus /> Add option
              </Button>
            ) : null}
          </fieldset>

          <div className="grid gap-3">
            <CheckboxField
              label="Default variant"
              description="Pre-selected on the product page."
              {...form.register("isDefault")}
            />
            <CheckboxField
              label="Active"
              description="Inactive variants are hidden from customers."
              {...form.register("isActive")}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {variant ? "Save variant" : "Add variant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface VariantEditorProps {
  productId: string;
  productStatus: ProductStatus;
  currency: string;
  variants: ProductVariant[];
  stockByVariant: Record<string, { stock: number; reserved: number; available: number }>;
}

export function VariantEditor({ productId, productStatus, currency, variants, stockByVariant }: VariantEditorProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">
          {variants.length === 0
            ? "Add at least one variant with a price to sell this product."
            : `${variants.length} variant${variants.length === 1 ? "" : "s"}`}
        </p>
        <VariantDialog productId={productId} currency={currency} variant={null} isFirst={variants.length === 0} />
      </div>
      {variants.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => {
              const stock = stockByVariant[variant.id];
              const options = Object.entries(asOptionRecord(variant.options));
              return (
                <TableRow key={variant.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{variant.title}</span>
                      {variant.is_default ? <Badge variant="accent">Default</Badge> : null}
                      {!variant.is_active ? <Badge variant="neutral">Inactive</Badge> : null}
                    </div>
                    {options.length ? (
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {options.map(([name, value]) => `${name}: ${value}`).join(" · ")}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{variant.sku}</TableCell>
                  <TableCell>
                    {formatMoney(variant.price_minor, currency)}
                    {variant.compare_at_price_minor ? (
                      <span className="ml-2 text-xs text-ink-faint line-through">
                        {formatMoney(variant.compare_at_price_minor, currency)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {stock ? (
                      <span className={stock.available <= 0 ? "text-danger" : undefined}>
                        {stock.available} available
                        {stock.reserved ? (
                          <span className="text-xs text-ink-faint"> · {stock.reserved} reserved</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <VariantDialog productId={productId} currency={currency} variant={variant} isFirst={false} />
                      {productStatus !== "active" ? (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger-soft"
                          confirmMessage={`Remove variant "${variant.title}"? Its inventory record is removed too.`}
                          action={() => deleteVariant(productId, variant.id)}
                        >
                          Remove
                        </ActionButton>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
