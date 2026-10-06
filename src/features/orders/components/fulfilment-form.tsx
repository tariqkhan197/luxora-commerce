"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle } from "lucide-react";
import { ActionButton } from "@/components/shared/action-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { applyActionError } from "@/lib/forms/apply-action-error";
import type { Enums } from "@/lib/supabase/database.types";
import { vendorFulfilmentSchema, type VendorFulfilmentInput } from "@/lib/validation";
import { updateFulfilment } from "../actions";

interface FulfilmentFormProps {
  vendorOrderId: string;
  status: Enums<"vendor_order_status">;
}

/** Forward-only fulfilment controls. The database enforces the same transitions. */
export function FulfilmentControls({ vendorOrderId, status }: FulfilmentFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<VendorFulfilmentInput>({
    resolver: zodResolver(vendorFulfilmentSchema),
    defaultValues: { vendorOrderId, status: "shipped", carrier: "", trackingNumber: "", trackingUrl: "" },
  });

  if (status === "pending") {
    return <p className="text-sm text-ink-soft">This order is awaiting payment. Do not ship until it is confirmed.</p>;
  }
  if (status === "shipped") {
    return (
      <ActionButton size="sm" action={() => updateFulfilment({ vendorOrderId, status: "delivered" })}>
        Mark as delivered
      </ActionButton>
    );
  }
  if (status !== "confirmed" && status !== "processing") {
    return <p className="text-sm text-ink-soft">No further fulfilment steps.</p>;
  }

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await updateFulfilment(values);
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["carrier", "trackingNumber", "trackingUrl"]));
        return;
      }
      router.refresh();
    });
  });

  return (
    <div className="flex flex-col gap-5">
      {status === "confirmed" ? (
        <ActionButton
          size="sm"
          variant="outline"
          action={() => updateFulfilment({ vendorOrderId, status: "processing" })}
        >
          Start processing
        </ActionButton>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="carrier" label="Carrier" error={form.formState.errors.carrier?.message}>
            <Input placeholder="DHL Express" {...form.register("carrier")} />
          </FormField>
          <FormField id="trackingNumber" label="Tracking number" error={form.formState.errors.trackingNumber?.message}>
            <Input {...form.register("trackingNumber")} />
          </FormField>
        </div>
        <FormField id="trackingUrl" label="Tracking link (optional)" error={form.formState.errors.trackingUrl?.message}>
          <Input type="url" inputMode="url" {...form.register("trackingUrl")} />
        </FormField>
        <div>
          <Button type="submit" loading={pending}>
            Mark as shipped
          </Button>
        </div>
      </form>
    </div>
  );
}
