"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { applyActionError } from "@/lib/forms/apply-action-error";
import type { Tables } from "@/lib/supabase/database.types";
import { addressSchema, type AddressInput, type AddressValues } from "@/lib/validation";
import { saveAddress } from "../actions";

const FIELDS = [
  "type",
  "label",
  "fullName",
  "phone",
  "line1",
  "line2",
  "city",
  "state",
  "postalCode",
  "countryCode",
] as const;

interface AddressFormProps {
  address?: Tables<"addresses"> | null;
  defaultCountry?: string;
  onSaved?: (id: string) => void;
  submitLabel?: string;
}

export function AddressForm({ address, defaultCountry = "US", onSaved, submitLabel }: AddressFormProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AddressInput, unknown, AddressValues>({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      type: address?.type ?? "both",
      label: address?.label ?? "",
      fullName: address?.full_name ?? "",
      phone: address?.phone ?? "",
      line1: address?.line1 ?? "",
      line2: address?.line2 ?? "",
      city: address?.city ?? "",
      state: address?.state ?? "",
      postalCode: address?.postal_code ?? "",
      countryCode: address?.country_code ?? defaultCountry,
      isDefaultShipping: address?.is_default_shipping ?? false,
      isDefaultBilling: address?.is_default_billing ?? false,
    },
  });
  const { errors } = form.formState;
  const id = (name: string) => `${address?.id ?? "new"}-${name}`;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveAddress(address?.id ?? null, values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      onSaved?.(result.data.id);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={id("fullName")} label="Full name" error={errors.fullName?.message}>
          <Input autoComplete="name" {...form.register("fullName")} />
        </FormField>
        <FormField id={id("phone")} label="Phone (optional)" error={errors.phone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register("phone")} />
        </FormField>
      </div>
      <FormField id={id("line1")} label="Street address" error={errors.line1?.message}>
        <Input autoComplete="address-line1" {...form.register("line1")} />
      </FormField>
      <FormField id={id("line2")} label="Apartment, suite, etc. (optional)" error={errors.line2?.message}>
        <Input autoComplete="address-line2" {...form.register("line2")} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id={id("city")} label="City" error={errors.city?.message}>
          <Input autoComplete="address-level2" {...form.register("city")} />
        </FormField>
        <FormField id={id("state")} label="State / region (optional)" error={errors.state?.message}>
          <Input autoComplete="address-level1" {...form.register("state")} />
        </FormField>
        <FormField id={id("postalCode")} label="Postal code" error={errors.postalCode?.message}>
          <Input autoComplete="postal-code" {...form.register("postalCode")} />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id={id("countryCode")} label="Country" error={errors.countryCode?.message} className="sm:col-span-2">
          <Select autoComplete="country" {...form.register("countryCode")}>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id={id("type")} label="Use for" error={errors.type?.message}>
          <Select {...form.register("type")}>
            <option value="both">Shipping & billing</option>
            <option value="shipping">Shipping only</option>
            <option value="billing">Billing only</option>
          </Select>
        </FormField>
      </div>
      <FormField id={id("label")} label="Label (optional)" hint="e.g. Home, Studio" error={errors.label?.message}>
        <Input {...form.register("label")} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxField label="Default shipping address" {...form.register("isDefaultShipping")} />
        <CheckboxField label="Default billing address" {...form.register("isDefaultBilling")} />
      </div>
      <div>
        <Button type="submit" loading={pending}>
          {submitLabel ?? (address ? "Save address" : "Add address")}
        </Button>
      </div>
    </form>
  );
}
