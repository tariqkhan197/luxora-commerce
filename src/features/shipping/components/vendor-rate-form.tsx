"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { applyActionError } from "@/lib/forms/apply-action-error";
import {
  vendorShippingRateSchema,
  type VendorShippingRateInput,
  type VendorShippingRateValues,
} from "@/lib/validation";
import { saveVendorShippingRate } from "../actions";

const FIELDS = ["firstItem", "additionalItem", "freeOver", "minDays", "maxDays"] as const;

interface VendorRateFormProps {
  zoneId: string;
  /** Existing values as decimal strings ("" when unset). */
  initial: {
    enabled: boolean;
    firstItem: string;
    additionalItem: string;
    freeOver: string;
    minDays: string;
    maxDays: string;
  };
  currency: string;
  readOnly?: boolean;
}

/** One zone's shipping price: first item + each additional item, optional free-shipping threshold. */
export function VendorRateForm({ zoneId, initial, currency, readOnly }: VendorRateFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<VendorShippingRateInput, unknown, VendorShippingRateValues>({
    resolver: zodResolver(vendorShippingRateSchema),
    defaultValues: { zoneId, ...initial },
  });
  const { errors } = form.formState;
  const enabled = useWatch({ control: form.control, name: "enabled" });
  const id = (name: string) => `${zoneId}-rate-${name}`;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveVendorShippingRate(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      setSaved(true);
      form.reset(form.getValues());
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <fieldset disabled={readOnly} className="grid gap-4">
        <CheckboxField
          label="I ship to this zone"
          description="When unticked, shoppers in this zone cannot check out with your products."
          {...form.register("enabled")}
        />
        <div className={enabled ? "grid gap-4" : "grid gap-4 opacity-60"}>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id={id("firstItem")} label={`First item (${currency})`} error={errors.firstItem?.message}>
              <Input inputMode="decimal" placeholder="0.00" {...form.register("firstItem")} />
            </FormField>
            <FormField
              id={id("additionalItem")}
              label={`Each additional item (${currency})`}
              error={errors.additionalItem?.message}
            >
              <Input inputMode="decimal" placeholder="0.00" {...form.register("additionalItem")} />
            </FormField>
            <FormField
              id={id("freeOver")}
              label={`Free over (${currency}, optional)`}
              hint="Order subtotal with you."
              error={errors.freeOver?.message}
            >
              <Input inputMode="decimal" placeholder="No free shipping" {...form.register("freeOver")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id={id("minDays")} label="Delivery from (days)" error={errors.minDays?.message}>
              <Input inputMode="numeric" placeholder="e.g. 3" {...form.register("minDays")} />
            </FormField>
            <FormField id={id("maxDays")} label="Delivery to (days)" error={errors.maxDays?.message}>
              <Input inputMode="numeric" placeholder="e.g. 7" {...form.register("maxDays")} />
            </FormField>
          </div>
        </div>
      </fieldset>
      {readOnly ? null : (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={pending} disabled={!form.formState.isDirty}>
            Save
          </Button>
          {saved && !form.formState.isDirty ? (
            <p role="status" className="text-xs text-success">
              Saved
            </p>
          ) : null}
        </div>
      )}
    </form>
  );
}
