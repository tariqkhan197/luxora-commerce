"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { formatMoney } from "@/lib/money";
import { flashSaleFormSchema, type FlashSaleFormInput, type FlashSaleFormValues } from "@/lib/validation";
import { saveFlashSale } from "../actions";

export interface VariantChoice {
  id: string;
  label: string;
  priceMinor: number;
}

interface FlashSaleFormDialogProps {
  currency: string;
  variants: VariantChoice[];
  initial?: FlashSaleFormInput & { saleId: string };
  /** The sale has started with items: items and prices are locked (D11). */
  started?: boolean;
  /** The sale has started: its dates are locked (it can still be ended early). */
  datesLocked?: boolean;
}

/** Create or edit a flash sale (vendor-funded). The database re-checks every rule. */
export function FlashSaleFormDialog({
  currency,
  variants,
  initial,
  started = false,
  datesLocked = started,
}: FlashSaleFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: FlashSaleFormInput = initial ?? { name: "", description: "", startsAt: "", endsAt: "", items: [] };
  const form = useForm<FlashSaleFormInput, unknown, FlashSaleFormValues>({
    resolver: zodResolver(flashSaleFormSchema),
    defaultValues: defaults,
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const { errors } = form.formState;
  const id = initial?.saleId ?? "new-sale";
  const priceOf = new Map(variants.map((variant) => [variant.id, variant.priceMinor]));
  const watchedItems = useWatch({ control: form.control, name: "items" }) ?? [];

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveFlashSale(values);
      if (!result.ok) {
        setFormError(
          applyActionError(form.setError, result.error, ["name", "description", "startsAt", "endsAt", "items"]),
        );
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
        }
      }}
    >
      <DialogTrigger asChild>
        {initial ? (
          <Button size="sm" variant="outline">
            Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> New flash sale
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit flash sale" : "New flash sale"}</DialogTitle>
          <DialogDescription>
            Your store pays for the reduced price: commission is charged on the sale price. Sale prices must be lower
            than the regular price, and discount codes don&rsquo;t apply to sale items. Once the sale starts its items
            and prices are locked; you can still end it early.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <FormField id={`${id}-name`} label="Name" error={errors.name?.message}>
            <Input maxLength={120} {...form.register("name")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-starts`} label="Starts (UTC)" error={errors.startsAt?.message}>
              <Input type="datetime-local" readOnly={datesLocked} {...form.register("startsAt")} />
            </FormField>
            <FormField id={`${id}-ends`} label="Ends (UTC)" error={errors.endsAt?.message}>
              <Input type="datetime-local" readOnly={datesLocked} {...form.register("endsAt")} />
            </FormField>
          </div>
          <FormField id={`${id}-description`} label="Notes (optional)" error={errors.description?.message}>
            <Textarea rows={2} maxLength={500} {...form.register("description")} />
          </FormField>

          {started ? (
            <div className="grid gap-1 text-sm">
              <p className="font-medium text-ink">Items</p>
              {(initial?.items ?? []).map((item) => (
                <p key={item.variantId} className="text-ink-soft">
                  {variants.find((variant) => variant.id === item.variantId)?.label ?? "Item"} · sale price{" "}
                  {item.salePrice}
                  {item.quantityLimit ? ` · ${item.quantityLimit} units` : ""}
                </p>
              ))}
            </div>
          ) : (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium text-ink">Items</legend>
              {items.fields.length === 0 ? (
                <p className="text-sm text-ink-soft">Add the product options this sale reduces.</p>
              ) : null}
              {items.fields.map((field, index) => {
                const regular = priceOf.get(watchedItems[index]?.variantId ?? "");
                return (
                  <div
                    key={field.id}
                    className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_8rem_7rem_auto]"
                  >
                    <Select aria-label="Product option" {...form.register(`items.${index}.variantId` as const)}>
                      {variants.map((variant) => (
                        <option key={variant.id} value={variant.id}>
                          {variant.label}
                        </option>
                      ))}
                    </Select>
                    <Input
                      aria-label="Sale price"
                      inputMode="decimal"
                      placeholder="Sale price"
                      {...form.register(`items.${index}.salePrice` as const)}
                    />
                    <Input
                      aria-label="Unit limit (optional)"
                      inputMode="numeric"
                      placeholder="Units (all)"
                      {...form.register(`items.${index}.quantityLimit` as const)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => items.remove(index)}
                      aria-label="Remove item"
                    >
                      <Trash2 />
                    </Button>
                    {regular !== undefined ? (
                      <p className="text-xs text-ink-faint sm:col-span-4">
                        Regular price {formatMoney(regular, currency)}
                      </p>
                    ) : null}
                    {errors.items?.[index]?.salePrice?.message ? (
                      <p className="text-xs text-danger sm:col-span-4">{errors.items[index]?.salePrice?.message}</p>
                    ) : null}
                  </div>
                );
              })}
              {errors.items?.message ? <p className="text-xs text-danger">{errors.items.message}</p> : null}
              {variants.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => items.append({ variantId: variants[0].id, salePrice: "", quantityLimit: "" })}
                >
                  <Plus /> Add item
                </Button>
              ) : null}
            </fieldset>
          )}
          {started ? (
            <p className="text-xs text-ink-soft">The sale has started, so its dates, items and prices are locked.</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {initial ? "Save changes" : "Create sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
