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
import { slugify } from "@/lib/slug";
import { approveApplicationSchema, rejectApplicationSchema } from "@/lib/validation";
import type { z } from "zod";
import { approveVendorApplication, rejectVendorApplication } from "../actions";

type ApproveInput = z.input<typeof approveApplicationSchema>;
type ApproveValues = z.output<typeof approveApplicationSchema>;
type RejectValues = z.output<typeof rejectApplicationSchema>;

interface ApplicationReviewProps {
  applicationId: string;
  businessName: string;
}

export function ApproveApplicationDialog({ applicationId, businessName }: ApplicationReviewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ApproveInput, unknown, ApproveValues>({
    resolver: zodResolver(approveApplicationSchema),
    defaultValues: { applicationId, slug: slugify(businessName), commissionRateBps: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await approveVendorApplication(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["slug", "commissionRateBps"]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Approve</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve {businessName}</DialogTitle>
          <DialogDescription>
            This creates the vendor, makes the applicant its owner and prepares a draft store. The action is recorded in
            the audit log.
          </DialogDescription>
        </DialogHeader>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormField
            id="slug"
            label="Store URL slug"
            hint="Used for /store/<slug>. Lowercase letters, numbers and hyphens."
            error={form.formState.errors.slug?.message}
          >
            <Input {...form.register("slug")} />
          </FormField>
          <FormField
            id="commissionRateBps"
            label="Commission override (basis points, optional)"
            hint="Leave blank to use category and platform rules. 1500 = 15%."
            error={form.formState.errors.commissionRateBps?.message}
          >
            <Input type="number" inputMode="numeric" min={0} max={10000} {...form.register("commissionRateBps")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Approve vendor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RejectApplicationDialog({ applicationId, businessName }: ApplicationReviewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RejectValues>({
    resolver: zodResolver(rejectApplicationSchema),
    defaultValues: { applicationId, reason: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await rejectVendorApplication(values);
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
        <Button size="sm" variant="outline">
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {businessName}</DialogTitle>
          <DialogDescription>The applicant sees this reason and may apply again later.</DialogDescription>
        </DialogHeader>
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormField id="reason" label="Reason" error={form.formState.errors.reason?.message}>
            <Textarea rows={4} {...form.register("reason")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              Reject application
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
