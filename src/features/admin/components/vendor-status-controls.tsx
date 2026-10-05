"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ActionButton } from "@/components/shared/action-button";
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
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import type { VendorStatus } from "@/lib/supabase/database.types";
import { vendorStatusChangeSchema } from "@/lib/validation";
import type { z } from "zod";
import { changeVendorStatus } from "../actions";

type Values = z.input<typeof vendorStatusChangeSchema>;

export function VendorStatusControls({ vendorId, status }: { vendorId: string; status: VendorStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(vendorStatusChangeSchema),
    defaultValues: { vendorId, status: "suspended", reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await changeVendorStatus(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["reason"]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <div className="flex flex-wrap items-start gap-3">
      {status === "approved" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Suspend vendor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Suspend this vendor</DialogTitle>
              <DialogDescription>
                Their store and products disappear from the storefront immediately. Existing orders are unaffected.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} noValidate className="grid gap-5">
              <FormField
                id="reason"
                label="Reason"
                error={form.formState.errors.reason?.message ?? formError ?? undefined}
              >
                <Textarea rows={3} {...form.register("reason")} />
              </FormField>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="destructive" loading={pending}>
                  Suspend
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
      {status === "suspended" || status === "pending" ? (
        <ActionButton size="sm" action={() => changeVendorStatus({ vendorId, status: "approved", reason: "" })}>
          {status === "pending" ? "Approve vendor" : "Reinstate vendor"}
        </ActionButton>
      ) : null}
      {status !== "closed" ? (
        <ActionButton
          size="sm"
          variant="outline"
          confirmMessage="Close this vendor permanently? Their catalog will be hidden."
          action={() => changeVendorStatus({ vendorId, status: "closed", reason: "" })}
        >
          Close vendor
        </ActionButton>
      ) : null}
    </div>
  );
}
