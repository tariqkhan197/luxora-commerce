"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { updateProfile } from "@/features/auth/actions";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { updateProfileSchema, type UpdateProfileInput } from "@/lib/validation";
import type { z } from "zod";

type FormInput = z.input<typeof updateProfileSchema>;
const FIELDS = ["fullName", "phone"] as const;

export function ProfileForm({ fullName, phone }: { fullName: string | null; phone: string | null }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const form = useForm<FormInput, unknown, UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { fullName: fullName ?? "", phone: phone ?? "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setStatus(null);
    startTransition(async () => {
      const result = await updateProfile(values);
      if (!result.ok) {
        const message = applyActionError(form.setError, result.error, FIELDS);
        if (message) setStatus({ kind: "error", message });
        return;
      }
      setStatus({ kind: "success", message: "Your details have been saved." });
      form.reset(values);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      {status ? (
        <Alert variant={status.kind === "error" ? "destructive" : "success"}>
          {status.kind === "error" ? <AlertCircle /> : <CheckCircle2 />}
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField id="fullName" label="Full name" error={form.formState.errors.fullName?.message}>
        <Input autoComplete="name" {...form.register("fullName")} />
      </FormField>
      <FormField
        id="phone"
        label="Phone"
        hint="Used for delivery updates only."
        error={form.formState.errors.phone?.message}
      >
        <Input type="tel" autoComplete="tel" {...form.register("phone")} />
      </FormField>
      <div>
        <Button type="submit" loading={pending} disabled={!form.formState.isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
