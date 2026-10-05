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
import { moderateProductSchema } from "@/lib/validation";
import type { z } from "zod";
import { moderateProduct } from "../actions";

type Values = z.input<typeof moderateProductSchema>;

export function ProductModerationControls({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm<Values>({
    resolver: zodResolver(moderateProductSchema),
    defaultValues: { productId, approve: false, reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await moderateProduct(values);
      if (!result.ok) {
        const message = applyActionError(form.setError, result.error, ["reason"]);
        if (message) form.setError("reason", { type: "server", message });
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionButton size="sm" action={() => moderateProduct({ productId, approve: true, reason: "" })}>
        Approve
      </ActionButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject “{productName}”</DialogTitle>
            <DialogDescription>The vendor sees this reason and can resubmit after making changes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} noValidate className="grid gap-5">
            <FormField id={`reason-${productId}`} label="Reason" error={form.formState.errors.reason?.message}>
              <Textarea rows={3} {...form.register("reason")} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" loading={pending}>
                Reject product
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
