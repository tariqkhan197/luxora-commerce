"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
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
import { formatMoney, toDecimalInput } from "@/lib/money";
import { reversePayoutSchema, vendorPayoutSchema, type VendorPayoutInput } from "@/lib/validation";
import type { z } from "zod";
import { recordVendorPayout, reverseVendorPayout } from "../admin-actions";

/** Records a payout Luxora made to the vendor outside Stripe. */
export function RecordPayoutDialog({
  vendorId,
  vendorName,
  availableMinor,
  currency,
}: {
  vendorId: string;
  vendorName: string;
  availableMinor: number;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: VendorPayoutInput = {
    vendorId,
    amount: toDecimalInput(availableMinor, currency),
    method: "Bank transfer",
    reference: "",
    notes: "",
  };
  const form = useForm<VendorPayoutInput>({ resolver: zodResolver(vendorPayoutSchema), defaultValues: defaults });
  const { errors } = form.formState;
  const id = (name: string) => `${vendorId}-payout-${name}`;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await recordVendorPayout(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["amount", "method", "reference", "notes"]));
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
        <Button size="sm" variant="outline" disabled={availableMinor <= 0}>
          Record payout
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payout to {vendorName}</DialogTitle>
          <DialogDescription>
            Record a transfer you have already made outside Stripe. Available now:{" "}
            {formatMoney(availableMinor, currency)}. Vendor bank details are not stored by Luxora.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={id("amount")} label={`Amount (${currency})`} error={errors.amount?.message}>
              <Input inputMode="decimal" {...form.register("amount")} />
            </FormField>
            <FormField id={id("method")} label="Method" error={errors.method?.message}>
              <Input {...form.register("method")} />
            </FormField>
          </div>
          <FormField id={id("reference")} label="Transfer reference" error={errors.reference?.message}>
            <Input {...form.register("reference")} />
          </FormField>
          <FormField id={id("notes")} label="Notes (optional)" error={errors.notes?.message}>
            <Textarea rows={2} {...form.register("notes")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Record payout
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ReverseValues = z.input<typeof reversePayoutSchema>;

/** Reverses a recorded payout that did not reach the vendor. */
export function ReversePayoutDialog({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ReverseValues>({
    resolver: zodResolver(reversePayoutSchema),
    defaultValues: { payoutId, reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await reverseVendorPayout(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["reason"]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Reverse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this payout</DialogTitle>
          <DialogDescription>
            Use this when a transfer bounced or was never sent. The amount returns to the vendor balance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <FormField
            id={`${payoutId}-reason`}
            label="Reason"
            error={form.formState.errors.reason?.message ?? formError ?? undefined}
          >
            <Textarea rows={2} {...form.register("reason")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              Reverse payout
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
