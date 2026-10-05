"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ROUTES } from "@/config/routes";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { signInSchema, type SignInInput } from "@/lib/validation";
import { signIn } from "../actions";
import { FormShell } from "./form-shell";

const FIELDS = ["email", "password"] as const;

export function SignInForm({ next, notice }: { next?: string | null; notice?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await signIn(values, next);
      if (result && !result.ok) setFormError(applyActionError(form.setError, result.error, FIELDS));
    });
  });

  return (
    <FormShell
      title="Welcome back"
      description={notice ?? "Sign in to your Luxora account."}
      error={formError}
      footer={
        <p>
          New to Luxora?{" "}
          <Link href={ROUTES.auth.signup} className="font-medium text-ink underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
        </FormField>
        <FormField id="password" label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register("password")} />
        </FormField>
        <div className="flex items-center justify-between">
          <Link href={ROUTES.auth.forgotPassword} className="text-xs text-ink-soft underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Sign in
        </Button>
      </form>
    </FormShell>
  );
}
