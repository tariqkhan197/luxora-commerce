"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Undo2 } from "lucide-react";
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
import { refundRequestSchema, type RefundRequestInput, type RefundRequestValues } from "@/lib/validation";
import { refundVendorOrder } from "../admin-actions";

interface RefundableItem {
  id: string;
  productName: string;
  variantTitle: string;
  unitPriceMinor: number;
  refundable: number;
}

interface RefundDialogProps {
  vendorOrderId: string;
  vendorOrderNumber: string;
  currency: string;
  shippingMinor: number;
  items: RefundableItem[];
}

/** Admin refund of items of one vendor order. Amounts are computed by the database. */
export function RefundDialog({ vendorOrderId, vendorOrderNumber, currency, shippingMinor, items }: RefundDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const defaults: RefundRequestInput = {
    vendorOrderId,
    kind: "return",
    reason: "",
    shipping: "policy",
    items: items.map((item) => ({ orderItemId: item.id, quantity: "0" })),
  };
  const form = useForm<RefundRequestInput, unknown, RefundRequestValues>({
    resolver: zodResolver(refundRequestSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const quantities = useWatch({ control: form.control, name: "items" }) ?? [];
  const itemsTotal = items.reduce((sum, item, index) => {
    const quantity = Math.min(Number(quantities[index]?.quantity) || 0, item.refundable);
    return sum + quantity * item.unitPriceMinor;
  }, 0);

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await refundVendorOrder(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["reason", "items"]));
        return;
      }
      setNotice(
        result.data.status === "completed"
          ? "Refund completed."
          : "Refund submitted — it completes when Stripe confirms it.",
      );
      setOpen(false);
      router.refresh();
    });
  });

  if (items.every((item) => item.refundable === 0) && shippingMinor === 0) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            form.reset(defaults);
            setFormError(null);
            setNotice(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Undo2 /> Refund
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Refund {vendorOrderNumber}</DialogTitle>
            <DialogDescription>
              The refund goes back to the customer&apos;s original payment method (Stripe test mode). Under the current
              policy Luxora bears the cost; every refund is recorded in the finance ledger.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <ul className="grid gap-3">
              {items.map((item, index) => (
                <li key={item.id} className="grid grid-cols-[1fr_6rem] items-center gap-4">
                  <div className="min-w-0 text-sm">
                    <p className="truncate text-ink">{item.productName}</p>
                    <p className="text-xs text-ink-faint">
                      {item.variantTitle} · {formatMoney(item.unitPriceMinor, currency)} each · {item.refundable}{" "}
                      refundable
                    </p>
                  </div>
                  <Input
                    aria-label={`Quantity of ${item.productName} to refund`}
                    inputMode="numeric"
                    type="number"
                    min={0}
                    max={item.refundable}
                    disabled={item.refundable === 0}
                    {...form.register(`items.${index}.quantity` as const)}
                  />
                </li>
              ))}
            </ul>
            {errors.items?.message ? <p className="text-xs text-danger">{errors.items.message}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id={`${vendorOrderId}-kind`} label="Type" error={errors.kind?.message}>
                <Select {...form.register("kind")}>
                  <option value="return">Return</option>
                  <option value="cancellation">Cancellation</option>
                  <option value="goodwill">Goodwill</option>
                </Select>
              </FormField>
              <FormField
                id={`${vendorOrderId}-shipping`}
                label={`Shipping (${formatMoney(shippingMinor, currency)} charged)`}
                hint="Policy: partial refunds keep shipping; a full cancellation refunds it; a full return does not."
              >
                <Select {...form.register("shipping")}>
                  <option value="policy">Follow policy</option>
                  <option value="include">Refund shipping</option>
                  <option value="exclude">Do not refund shipping</option>
                </Select>
              </FormField>
            </div>
            <FormField id={`${vendorOrderId}-reason`} label="Reason" error={errors.reason?.message}>
              <Textarea rows={3} {...form.register("reason")} />
            </FormField>
            <p className="text-sm text-ink-soft">
              Items selected: <span className="text-ink tabular-nums">{formatMoney(itemsTotal, currency)}</span> (plus
              shipping if refunded). The database computes the final amount.
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Issue refund
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {notice ? (
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
