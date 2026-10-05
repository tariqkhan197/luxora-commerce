"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validation";
import { updatePassword } from "../actions";
import { FormShell } from "./form-shell";

const FIELDS = ["password", "confirmPassword"] as const;

export function ResetPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await updatePassword(values);
      if (result && !result.ok) setFormError(applyActionError(form.setError, result.error, FIELDS));
    });
  });

  return (
    <FormShell
      title="Choose a new password"
      description="Your new password will apply to all your devices."
      error={formError}
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormField
          id="password"
          label="New password"
          hint="At least 10 characters with upper and lower case letters and a number."
          error={form.formState.errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={form.formState.errors.confirmPassword?.message}
        >
          <Input type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Update password
        </Button>
      </form>
    </FormShell>
  );
}
