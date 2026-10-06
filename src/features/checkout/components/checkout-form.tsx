"use client";

import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { AddressDialog } from "@/features/addresses/components/address-dialog";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { cn } from "@/lib/utils";
import { placeOrderSchema, type PlaceOrderInput } from "@/lib/validation";
import { placeOrder } from "../actions";

export interface CheckoutAddressOption {
  id: string;
  type: "both" | "shipping" | "billing";
  label: string | null;
  lines: string[];
}

interface CheckoutFormProps {
  addresses: CheckoutAddressOption[];
  defaultShippingId: string | null;
  defaultBillingId: string | null;
  checkoutToken: string;
  expectedTotalMinor: number;
  totalLabel: string;
  defaultCountry: string;
}

function AddressRadio({
  name,
  option,
  checked,
  onSelect,
}: {
  name: string;
  option: CheckoutAddressOption;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
        checked ? "border-ink bg-surface" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <input type="radio" name={name} className="mt-1 accent-[var(--ink)]" checked={checked} onChange={onSelect} />
      <span className="text-sm leading-relaxed">
        {option.label ? <span className="block font-medium text-ink">{option.label}</span> : null}
        {option.lines.map((line, index) => (
          <span key={index} className="block text-ink-soft">
            {line}
          </span>
        ))}
      </span>
    </label>
  );
}

export function CheckoutForm({
  addresses,
  defaultShippingId,
  defaultBillingId,
  checkoutToken,
  expectedTotalMinor,
  totalLabel,
  defaultCountry,
}: CheckoutFormProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const shippingOptions = addresses.filter((a) => a.type !== "billing");
  const billingOptions = addresses.filter((a) => a.type !== "shipping");

  const form = useForm<PlaceOrderInput>({
    resolver: zodResolver(placeOrderSchema),
    defaultValues: {
      shippingAddressId: defaultShippingId ?? shippingOptions[0]?.id ?? "",
      billingSameAsShipping: true,
      billingAddressId: defaultBillingId ?? billingOptions[0]?.id ?? "",
      checkoutToken,
      expectedTotalMinor,
      note: "",
    },
  });
  const shippingId = useWatch({ control: form.control, name: "shippingAddressId" });
  const billingId = useWatch({ control: form.control, name: "billingAddressId" });
  const sameAsShipping = useWatch({ control: form.control, name: "billingSameAsShipping" });
  const shippingSelection = addresses.find((a) => a.id === shippingId);
  // A shipping-only address cannot double as the billing address.
  const canReuseForBilling = shippingSelection?.type === "both";
  const effectiveSame = Boolean(sameAsShipping) && canReuseForBilling;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await placeOrder({ ...values, billingSameAsShipping: effectiveSame });
      if (result && !result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["shippingAddressId", "billingAddressId", "note"]));
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="display-3">Shipping address</h2>
          <AddressDialog
            defaultCountry={defaultCountry}
            onSaved={(id) => form.setValue("shippingAddressId", id)}
            trigger={
              <Button type="button" size="sm" variant="outline">
                <Plus /> New address
              </Button>
            }
          />
        </div>
        {shippingOptions.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Shipping address">
            {shippingOptions.map((option) => (
              <AddressRadio
                key={option.id}
                name="shipping"
                option={option}
                checked={option.id === shippingId}
                onSelect={() => form.setValue("shippingAddressId", option.id, { shouldValidate: true })}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Add a shipping address to continue.</p>
        )}
        {form.formState.errors.shippingAddressId ? (
          <p className="text-xs text-danger">Choose a shipping address.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="display-3">Billing address</h2>
        {canReuseForBilling ? (
          <CheckboxField label="Same as shipping address" {...form.register("billingSameAsShipping")} />
        ) : null}
        {!effectiveSame ? (
          billingOptions.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Billing address">
              {billingOptions.map((option) => (
                <AddressRadio
                  key={option.id}
                  name="billing"
                  option={option}
                  checked={option.id === billingId}
                  onSelect={() => form.setValue("billingAddressId", option.id, { shouldValidate: true })}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Add an address that can be used for billing.</p>
          )
        ) : null}
        {form.formState.errors.billingAddressId ? (
          <p className="text-xs text-danger">{form.formState.errors.billingAddressId.message}</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <FormField id="note" label="Note for the vendors (optional)" error={form.formState.errors.note?.message}>
          <Textarea rows={3} maxLength={1000} {...form.register("note")} />
        </FormField>
      </section>

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={shippingOptions.length === 0}
          className="w-full sm:w-auto sm:self-end"
        >
          Place order · {totalLabel}
        </Button>
        <p className="text-xs leading-relaxed text-ink-faint sm:text-right">
          Placing the order reserves your items. No payment is taken at this step.
        </p>
      </div>
    </form>
  );
}
