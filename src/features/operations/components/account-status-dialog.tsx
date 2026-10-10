"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
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
import { setCustomerAccountStatus } from "../actions";

const COPY = {
  suspended: {
    trigger: "Suspend account",
    title: "Suspend this customer account",
    description:
      "The customer loses access to their account: they cannot sign in, place orders, pay, request returns or write reviews. Their orders, returns, refunds and reviews are left exactly as they are. The reason is recorded in the audit log.",
    confirm: "I understand this customer will not be able to sign in or buy until reactivated.",
    submit: "Suspend",
    variant: "destructive",
  },
  active: {
    trigger: "Reactivate account",
    title: "Reactivate this customer account",
    description:
      "The customer can sign in and shop again. Nothing that happened while suspended is changed. The reason is recorded in the audit log.",
    confirm: "I want to restore this customer's access.",
    submit: "Reactivate",
    variant: "primary",
  },
} as const;

/** Administrator: suspend or reactivate a customer account, with a reason and confirmation. */
export function AccountStatusDialog({
  profileId,
  status,
  customerLabel,
}: {
  profileId: string;
  /** The status to change to. */
  status: keyof typeof COPY;
  customerLabel: string;
}) {
  const copy = COPY[status];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await setCustomerAccountStatus({
        profileId,
        status,
        reason: String(formData.get("reason") ?? ""),
        confirmed: formData.get("confirmed") === "on",
      });
      if (!result.ok) {
        const fields = result.error.fieldErrors;
        setError(fields?.reason?.[0] ?? fields?.confirmed?.[0] ?? fields?._form?.[0] ?? result.error.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={status === "suspended" ? "destructive" : "outline"}>
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {customerLabel}. {copy.description}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FormField id={`${profileId}-status-reason`} label="Reason (required)">
            <Textarea name="reason" rows={3} minLength={3} maxLength={500} required />
          </FormField>
          <CheckboxField name="confirmed" label={copy.confirm} required />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={copy.variant} loading={pending}>
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
