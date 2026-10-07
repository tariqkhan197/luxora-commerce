"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, RotateCcw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { returnRequestSchema, type ReturnRequestInput, type ReturnRequestValues } from "@/lib/validation";
import { requestReturn } from "../actions";

interface ReturnableItem {
  id: string;
  productName: string;
  variantTitle: string;
  returnable: number;
}

interface ReturnRequestDialogProps {
  vendorOrderId: string;
  vendorName: string;
  windowEndsLabel: string;
  items: ReturnableItem[];
}

/** Customer return request for items of one shipment. Eligibility is re-checked by the database. */
export function ReturnRequestDialog({ vendorOrderId, vendorName, windowEndsLabel, items }: ReturnRequestDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: ReturnRequestInput = {
    vendorOrderId,
    note: "",
    items: items.map((item) => ({ orderItemId: item.id, quantity: "0", reason: "" })),
  };
  const form = useForm<ReturnRequestInput, unknown, ReturnRequestValues>({
    resolver: zodResolver(returnRequestSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await requestReturn(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["items", "note"]));
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
        <Button size="sm" variant="outline">
          <RotateCcw /> Request a return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Return items from {vendorName}</DialogTitle>
          <DialogDescription>
            Returns for this shipment are accepted until {windowEndsLabel}. Once {vendorName} approves your request you
            will get the return address. You pay the return postage; the refund goes to your original payment method.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <ul className="grid gap-4">
            {items.map((item, index) => (
              <li key={item.id} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-[1fr_6rem]">
                <div className="min-w-0 text-sm">
                  <p className="truncate text-ink">{item.productName}</p>
                  <p className="text-xs text-ink-faint">
                    {item.variantTitle} · up to {item.returnable} can be returned
                  </p>
                </div>
                <Input
                  aria-label={`Quantity of ${item.productName} to return`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={item.returnable}
                  {...form.register(`items.${index}.quantity` as const)}
                />
                <Input
                  aria-label={`Reason for returning ${item.productName}`}
                  placeholder="Reason (e.g. too small, not as described)"
                  className="sm:col-span-2"
                  {...form.register(`items.${index}.reason` as const)}
                />
              </li>
            ))}
          </ul>
          {errors.items?.message ? <p className="text-xs text-danger">{errors.items.message}</p> : null}
          <FormField
            id={`${vendorOrderId}-return-note`}
            label="Note for the brand (optional)"
            error={errors.note?.message}
          >
            <Textarea rows={3} {...form.register("note")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Send return request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
