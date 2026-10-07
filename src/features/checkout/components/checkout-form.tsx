"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/config/routes";
import { AddressDialog } from "@/features/addresses/components/address-dialog";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { placeOrderSchema, type PlaceOrderInput } from "@/lib/validation";
import { placeOrder } from "../actions";
import { shippingBlockLabel, type CheckoutQuote } from "../quote";
import { OrderSummary } from "./order-summary";

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
  /** Bag totals without shipping (used until an address is chosen). */
  baseQuote: CheckoutQuote;
  /** Full quote, including database-computed shipping, per shipping address id. */
  quotesByAddress: Record<string, CheckoutQuote>;
  /** Server-rendered list of the bag's items, shown inside the summary. */
  items: ReactNode;
  defaultCountry: string;
  /** Online payment (Stripe hosted checkout, test mode) is enabled. */
  paymentsEnabled: boolean;
}

function AddressRadio({
  name,
  option,
  checked,
  onSelect,
  note,
  warning,
}: {
  name: string;
  option: CheckoutAddressOption;
  checked: boolean;
  onSelect: () => void;
  note?: string | null;
  warning?: string | null;
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
        {note ? <span className="mt-1 block text-xs text-ink-faint">{note}</span> : null}
        {warning ? <span className="mt-1 block text-xs text-danger">{warning}</span> : null}
      </span>
    </label>
  );
}

/** One-line shipping summary for an address card. */
function shippingNote(quote: CheckoutQuote | undefined): { note: string | null; warning: string | null } {
  if (!quote) return { note: null, warning: "Shipping cannot be calculated for this address." };
  const blocked = quote.unshippableGroups[0];
  if (blocked) return { note: null, warning: shippingBlockLabel(blocked.shippingReason, blocked.vendorName) };
  return {
    note:
      quote.shipping.amountMinor === 0
        ? "Free shipping"
        : `Shipping ${formatMoney(quote.shipping.amountMinor, quote.currency)}`,
    warning: null,
  };
}

export function CheckoutForm({
  addresses,
  defaultShippingId,
  defaultBillingId,
  checkoutToken,
  baseQuote,
  quotesByAddress,
  items,
  defaultCountry,
  paymentsEnabled,
}: CheckoutFormProps) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const shippingOptions = addresses.filter((a) => a.type !== "billing");
  const billingOptions = addresses.filter((a) => a.type !== "shipping");
  const shippable = (id: string | null | undefined) => Boolean(id && quotesByAddress[id]?.canCheckout);
  const initialShippingId =
    (shippable(defaultShippingId) ? defaultShippingId : null) ??
    shippingOptions.find((option) => shippable(option.id))?.id ??
    defaultShippingId ??
    shippingOptions[0]?.id ??
    "";

  const form = useForm<PlaceOrderInput>({
    resolver: zodResolver(placeOrderSchema),
    defaultValues: {
      shippingAddressId: initialShippingId,
      billingSameAsShipping: true,
      billingAddressId: defaultBillingId ?? billingOptions[0]?.id ?? "",
      checkoutToken,
      expectedTotalMinor: baseQuote.total.amountMinor,
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
  const selectedQuote = shippingId ? quotesByAddress[shippingId] : undefined;
  const summaryQuote = selectedQuote ?? baseQuote;
  const canPlace = Boolean(selectedQuote?.canCheckout);

  const onSubmit = form.handleSubmit((values) => {
    if (!selectedQuote?.canCheckout) return;
    setFormError(null);
    startTransition(async () => {
      // The total shown for the chosen address; place_order rejects any drift.
      const result = await placeOrder({
        ...values,
        expectedTotalMinor: selectedQuote.total.amountMinor,
        billingSameAsShipping: effectiveSame,
      });
      if (result && !result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["shippingAddressId", "billingAddressId", "note"]));
      }
    });
  });

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
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
                  {...shippingNote(quotesByAddress[option.id])}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Add a shipping address to continue.</p>
          )}
          {form.formState.errors.shippingAddressId ? (
            <p className="text-xs text-danger">Choose a shipping address.</p>
          ) : null}
          {selectedQuote && selectedQuote.unshippableGroups.length > 0 ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>
                <p>
                  {selectedQuote.unshippableGroups
                    .map((group) => shippingBlockLabel(group.shippingReason, group.vendorName))
                    .filter((label, index, all) => label && all.indexOf(label) === index)
                    .join(" ")}
                </p>
                <p>
                  Choose another address or{" "}
                  <Link href={ROUTES.cart} className="underline underline-offset-4">
                    remove those items from your bag
                  </Link>
                  .
                </p>
              </AlertDescription>
            </Alert>
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
            disabled={!canPlace}
            className="w-full sm:w-auto sm:self-end"
          >
            {paymentsEnabled ? "Continue to payment" : "Place order"} ·{" "}
            {formatMoney(summaryQuote.total.amountMinor, summaryQuote.currency)}
          </Button>
          <p className="text-xs leading-relaxed text-ink-faint sm:text-right">
            {paymentsEnabled
              ? "Your items are reserved while you pay on Stripe's secure checkout page (test mode: no real money is taken)."
              : "Placing the order reserves your items. No payment is taken at this step."}
          </p>
        </div>
      </form>
      <aside className="flex flex-col gap-6 lg:sticky lg:top-28">
        <OrderSummary quote={summaryQuote}>{items}</OrderSummary>
      </aside>
    </div>
  );
}
