"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ROUTES } from "@/config/routes";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation";
import { requestPasswordReset } from "../actions";
import { FormShell } from "./form-shell";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["email"]));
        return;
      }
      setSent(true);
    });
  });

  return (
    <FormShell
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a secure link."
      error={formError}
      footer={
        <Link href={ROUTES.auth.login} className="font-medium text-ink underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertDescription>
            If an account exists for that address, a password reset link is on its way. The link expires after a short
            time, so please use it soon.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
          </FormField>
          <Button type="submit" size="lg" loading={pending} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </FormShell>
  );
}
