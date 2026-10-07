"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ROUTES } from "@/config/routes";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { signUpSchema, type SignUpInput } from "@/lib/validation";
import { signUp } from "../actions";
import { FormShell } from "./form-shell";

const FIELDS = ["fullName", "email", "password"] as const;

export function SignUpForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await signUp(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      if (result.data.requiresEmailVerification) {
        router.push(`${ROUTES.auth.verifyEmail}?email=${encodeURIComponent(values.email)}`);
      } else {
        router.push(ROUTES.account.root);
        router.refresh();
      }
    });
  });

  return (
    <FormShell
      title="Create your account"
      description="Save favourites, track orders and manage your addresses in one place."
      error={formError}
      footer={
        <p>
          Already have an account?{" "}
          <Link href={ROUTES.auth.login} className="font-medium text-ink underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5">
        <FormField id="fullName" label="Full name" error={form.formState.errors.fullName?.message}>
          <Input autoComplete="name" {...form.register("fullName")} />
        </FormField>
        <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
        </FormField>
        <FormField
          id="password"
          label="Password"
          hint="At least 10 characters with upper and lower case letters and a number."
          error={form.formState.errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...form.register("password")} />
        </FormField>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Create account
        </Button>
        <p className="text-xs leading-relaxed text-ink-faint">
          By creating an account you agree to our{" "}
          <Link href={ROUTES.legal.terms} className="underline underline-offset-4 hover:text-ink">
            Terms of Service
          </Link>{" "}
          and acknowledge our{" "}
          <Link href={ROUTES.legal.privacy} className="underline underline-offset-4 hover:text-ink">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </FormShell>
  );
}
