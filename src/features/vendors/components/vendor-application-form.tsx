"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { vendorApplicationSchema, type VendorApplicationInput, type VendorApplicationValues } from "@/lib/validation";
import { submitVendorApplication } from "../actions";

const FIELDS = ["businessName", "businessEmail", "businessPhone", "websiteUrl", "description"] as const;

export function VendorApplicationForm({ defaultEmail }: { defaultEmail: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<VendorApplicationInput, unknown, VendorApplicationValues>({
    resolver: zodResolver(vendorApplicationSchema),
    defaultValues: {
      businessName: "",
      businessEmail: defaultEmail,
      businessPhone: "",
      websiteUrl: "",
      description: "",
      productCategories: [],
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await submitVendorApplication(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, FIELDS));
        return;
      }
      router.refresh();
    });
  });

  const { errors } = form.formState;

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        <FormField id="businessName" label="Business name" error={errors.businessName?.message}>
          <Input autoComplete="organization" {...form.register("businessName")} />
        </FormField>
        <FormField id="businessEmail" label="Business email" error={errors.businessEmail?.message}>
          <Input type="email" autoComplete="email" {...form.register("businessEmail")} />
        </FormField>
        <FormField id="businessPhone" label="Phone (optional)" error={errors.businessPhone?.message}>
          <Input type="tel" autoComplete="tel" {...form.register("businessPhone")} />
        </FormField>
        <FormField
          id="websiteUrl"
          label="Website (optional)"
          hint="Including https://"
          error={errors.websiteUrl?.message}
        >
          <Input type="url" inputMode="url" {...form.register("websiteUrl")} />
        </FormField>
      </div>
      <FormField
        id="description"
        label="About your brand"
        hint="What you make, who it is for, and where you currently sell."
        error={errors.description?.message}
      >
        <Textarea rows={6} {...form.register("description")} />
      </FormField>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-ink-faint">
          Applications are reviewed by our team; we usually respond within a few days.
        </p>
        <Button type="submit" size="lg" loading={pending}>
          Submit application
        </Button>
      </div>
    </form>
  );
}
