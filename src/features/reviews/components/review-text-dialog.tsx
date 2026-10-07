"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import { moderateReview, replyToReview } from "../actions";

/** Review steps that need text: a vendor reply, or an admin rejection reason. */
export type ReviewTextStep = "reply" | "reject";

const STEPS: Record<
  ReviewTextStep,
  {
    title: string;
    description: string;
    field: { name: string; label: string };
    submit: string;
    destructive?: boolean;
    run: (reviewId: string, text: string) => Promise<ActionResult<unknown>>;
  }
> = {
  reply: {
    title: "Reply to this review",
    description:
      "Your reply is published under the review straight away. There is one reply per review; you can edit it.",
    field: { name: "reply", label: "Your reply" },
    submit: "Publish reply",
    run: (reviewId, reply) => replyToReview({ reviewId, reply }),
  },
  reject: {
    title: "Reject this review",
    description:
      "The review is hidden (or taken down if it was published). The customer sees your reason and can edit and resubmit.",
    field: { name: "reason", label: "Reason for the customer" },
    submit: "Reject review",
    destructive: true,
    run: (reviewId, reason) => moderateReview({ reviewId, decision: "reject", reason }),
  },
};

interface ReviewTextDialogProps {
  reviewId: string;
  step: ReviewTextStep;
  triggerLabel: string;
  defaultValue?: string | null;
}

export function ReviewTextDialog({ reviewId, step, triggerLabel, defaultValue }: ReviewTextDialogProps) {
  const config = STEPS[step];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = `${reviewId}-${step}`;

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await config.run(reviewId, String(formData.get(config.field.name) ?? ""));
      if (!result.ok) {
        const fieldError = result.error.fieldErrors?.[config.field.name]?.[0];
        setError(fieldError ?? result.error.fieldErrors?._form?.[0] ?? result.error.message);
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
        <Button size="sm" variant={config.destructive ? "ghost" : "outline"}>
          {triggerLabel}
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
          <FormField id={id} label={config.field.label}>
            <Textarea name={config.field.name} rows={5} maxLength={2000} defaultValue={defaultValue ?? ""} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={config.destructive ? "destructive" : "primary"} loading={pending}>
              {config.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
