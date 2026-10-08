"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Plus } from "lucide-react";
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
import { COUPON_TYPE_LABELS, couponFormSchema, type CouponFormInput, type CouponFormValues } from "@/lib/validation";
import { savePlatformCoupon, saveVendorCoupon } from "../actions";

interface CouponFormDialogProps {
  /** "vendor": funded by the vendor, no free shipping. "platform": funded by Luxora. */
  scope: "vendor" | "platform";
  /** Existing coupon (form values) to edit; omitted to create one. */
  initial?: CouponFormInput & { couponId: string };
  /** The code has been used: its code and discount can no longer change. */
  locked?: boolean;
}

const EMPTY: CouponFormInput = {
  code: "",
  name: "",
  description: "",
  discountType: "percentage",
  percent: "",
  amount: "",
  minSubtotal: "",
  maxDiscount: "",
  usageLimit: "",
  usageLimitPerCustomer: "",
  startsAt: "",
  endsAt: "",
};

const FIELDS = [
  "code",
  "name",
  "description",
  "discountType",
  "percent",
  "amount",
  "minSubtotal",
  "maxDiscount",
  "usageLimit",
  "usageLimitPerCustomer",
  "startsAt",
  "endsAt",
] as const;

/** Create or edit a discount code. The database re-checks every rule. */
export function CouponFormDialog({ scope, initial, locked = false }: CouponFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: CouponFormInput = initial ?? EMPTY;
  const form = useForm<CouponFormInput, unknown, CouponFormValues>({
    resolver: zodResolver(couponFormSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const type = useWatch({ control: form.control, name: "discountType" });
  const id = initial?.couponId ?? `new-${scope}`;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = scope === "vendor" ? await saveVendorCoupon(values) : await savePlatformCoupon(values);
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
            <Plus /> New code
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit discount code" : "New discount code"}</DialogTitle>
          <DialogDescription>
            {scope === "vendor"
              ? "Your store pays for this discount: commission is charged on the discounted price. It applies only to your items that aren't on flash sale."
              : "Luxora pays for this discount: vendor earnings and commission are unchanged. It applies to items that aren't on flash sale."}{" "}
            One code per order.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          {locked ? (
            <p className="text-xs text-ink-soft">
              This code has been used, so its code and discount are locked. You can still change its name, dates and
              limits.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-code`} label="Code" hint="Letters, numbers, - or _" error={errors.code?.message}>
              <Input autoCapitalize="characters" maxLength={32} readOnly={locked} {...form.register("code")} />
            </FormField>
            <FormField id={`${id}-name`} label="Name (internal)" error={errors.name?.message}>
              <Input maxLength={120} {...form.register("name")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-type`} label="Discount" error={errors.discountType?.message}>
              {locked ? (
                <>
                  <input type="hidden" {...form.register("discountType")} />
                  <Input readOnly value={COUPON_TYPE_LABELS[type] ?? type} aria-readonly />
                </>
              ) : (
                <Select {...form.register("discountType")}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed_amount">Amount off</option>
                  {scope === "platform" ? <option value="free_shipping">Free shipping</option> : null}
                </Select>
              )}
            </FormField>
            {type === "percentage" ? (
              <FormField id={`${id}-percent`} label="Percentage" hint="e.g. 10 or 12.5" error={errors.percent?.message}>
                <Input inputMode="decimal" readOnly={locked} {...form.register("percent")} />
              </FormField>
            ) : type === "fixed_amount" ? (
              <FormField id={`${id}-amount`} label="Amount (USD)" error={errors.amount?.message}>
                <Input inputMode="decimal" readOnly={locked} {...form.register("amount")} />
              </FormField>
            ) : (
              <p className="self-end text-xs text-ink-soft">Luxora pays every vendor&rsquo;s shipping on the order.</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id={`${id}-min`}
              label="Minimum spend (optional)"
              hint={type === "free_shipping" ? "On the whole bag" : "On the items the code discounts"}
              error={errors.minSubtotal?.message}
            >
              <Input inputMode="decimal" {...form.register("minSubtotal")} />
            </FormField>
            {type === "percentage" ? (
              <FormField id={`${id}-max`} label="Maximum discount (optional)" error={errors.maxDiscount?.message}>
                <Input inputMode="decimal" {...form.register("maxDiscount")} />
              </FormField>
            ) : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-limit`} label="Total uses (optional)" error={errors.usageLimit?.message}>
              <Input inputMode="numeric" {...form.register("usageLimit")} />
            </FormField>
            <FormField
              id={`${id}-per-customer`}
              label="Uses per customer (optional)"
              error={errors.usageLimitPerCustomer?.message}
            >
              <Input inputMode="numeric" {...form.register("usageLimitPerCustomer")} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${id}-starts`} label="Starts (UTC, optional)" error={errors.startsAt?.message}>
              <Input type="datetime-local" {...form.register("startsAt")} />
            </FormField>
            <FormField id={`${id}-ends`} label="Ends (UTC, optional)" error={errors.endsAt?.message}>
              <Input type="datetime-local" {...form.register("endsAt")} />
            </FormField>
          </div>
          <FormField id={`${id}-description`} label="Notes (optional)" error={errors.description?.message}>
            <Textarea rows={2} maxLength={500} {...form.register("description")} />
          </FormField>
          <p className="text-xs text-ink-faint">
            Unused reservations are released if an order is never paid. Uses are not given back after a refund or
            return.
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {initial ? "Save changes" : "Create code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
