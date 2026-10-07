"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import { approveReturn, markReturnShipped, receiveReturn, refundReturn, rejectReturn } from "../actions";

/** The steps of a return that need input. Each maps to one Server Action. */
export type ReturnStep = "approve" | "reject" | "receive" | "ship" | "refund";

type Field =
  | { name: string; label: string; kind: "text" | "textarea"; placeholder?: string; hint?: string }
  | { name: string; label: string; kind: "checkbox"; description?: string; defaultChecked?: boolean }
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[]; hint?: string };

const STEPS: Record<
  ReturnStep,
  {
    title: string;
    description: string;
    trigger: string;
    submit: string;
    variant: ButtonProps["variant"];
    fields: Field[];
    run: (input: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  }
> = {
  approve: {
    title: "Approve this return",
    description: "Tell the customer where to send the items. They pay the return postage.",
    trigger: "Approve",
    submit: "Approve return",
    variant: "primary",
    fields: [
      {
        name: "instructions",
        label: "Return address and instructions",
        kind: "textarea",
        placeholder: "Studio name, street, postcode, city, country — and how to pack the items.",
      },
    ],
    run: approveReturn,
  },
  reject: {
    title: "Decline this return",
    description: "The customer sees your reason. Use this only when the request does not meet the returns policy.",
    trigger: "Decline",
    submit: "Decline return",
    variant: "destructive",
    fields: [{ name: "reason", label: "Reason", kind: "textarea" }],
    run: rejectReturn,
  },
  receive: {
    title: "Mark the return as received",
    description: "Confirm the parcel arrived. A Luxora administrator then issues the refund.",
    trigger: "Mark received",
    submit: "Mark received",
    variant: "primary",
    fields: [
      {
        name: "restock",
        label: "Put the items back in stock",
        kind: "checkbox",
        description: "Adds the returned units to inventory with a 'return' movement.",
        defaultChecked: true,
      },
      { name: "notes", label: "Inspection notes (optional)", kind: "textarea" },
    ],
    run: receiveReturn,
  },
  ship: {
    title: "Add return tracking",
    description: "Share the tracking details once you have sent the parcel.",
    trigger: "Add tracking",
    submit: "Save tracking",
    variant: "outline",
    fields: [
      { name: "carrier", label: "Carrier", kind: "text", placeholder: "e.g. La Poste" },
      { name: "trackingNumber", label: "Tracking number", kind: "text" },
      { name: "trackingUrl", label: "Tracking link (optional)", kind: "text", placeholder: "https://" },
    ],
    run: markReturnShipped,
  },
  refund: {
    title: "Refund this return",
    description:
      "Refunds the returned items to the customer's original payment method through Stripe (test mode). Under the current policy Luxora bears the cost.",
    trigger: "Issue refund",
    submit: "Issue refund",
    variant: "destructive",
    fields: [
      {
        name: "shipping",
        label: "Shipping charge",
        kind: "select",
        options: [
          { value: "policy", label: "Follow policy (not refunded for returns)" },
          { value: "include", label: "Refund shipping" },
          { value: "exclude", label: "Do not refund shipping" },
        ],
      },
    ],
    run: refundReturn,
  },
};

export function ReturnStepDialog({ returnId, step }: { returnId: string; step: ReturnStep }) {
  const config = STEPS[step];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function submit(formData: FormData) {
    const input: Record<string, unknown> = { returnId };
    for (const field of config.fields) {
      input[field.name] =
        field.kind === "checkbox" ? formData.get(field.name) === "on" : (formData.get(field.name) ?? "");
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await config.run(input);
      if (!result.ok) {
        const perField: Record<string, string> = {};
        for (const [name, messages] of Object.entries(result.error.fieldErrors ?? {})) {
          if (messages[0] && config.fields.some((field) => field.name === name)) perField[name] = messages[0];
        }
        setFieldErrors(perField);
        setError(Object.keys(perField).length ? null : (result.error.fieldErrors?._form?.[0] ?? result.error.message));
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
        if (next) {
          setError(null);
          setFieldErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant={config.variant === "primary" ? "primary" : config.variant === "destructive" ? "ghost" : "outline"}
        >
          {config.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.title}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {config.fields.map((field) => {
            const id = `${returnId}-${step}-${field.name}`;
            if (field.kind === "checkbox") {
              return (
                <CheckboxField
                  key={field.name}
                  id={id}
                  name={field.name}
                  label={field.label}
                  description={field.description}
                  defaultChecked={field.defaultChecked}
                />
              );
            }
            return (
              <FormField
                key={field.name}
                id={id}
                label={field.label}
                hint={"hint" in field ? field.hint : undefined}
                error={fieldErrors[field.name]}
              >
                {field.kind === "textarea" ? (
                  <Textarea name={field.name} rows={4} placeholder={field.placeholder} />
                ) : field.kind === "select" ? (
                  <Select name={field.name} defaultValue={field.options[0]?.value}>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input name={field.name} placeholder={field.placeholder} />
                )}
              </FormField>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={config.variant} loading={pending}>
              {config.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
