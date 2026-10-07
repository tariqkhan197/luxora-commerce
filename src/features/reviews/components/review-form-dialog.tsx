"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, PenLine, Star } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { applyActionError } from "@/lib/forms/apply-action-error";
import { cn } from "@/lib/utils";
import { reviewUpdateSchema, type ReviewUpdateInput, type ReviewUpdateValues } from "@/lib/validation";
import { submitReview, updateReview } from "../actions";

type ReviewFormDialogProps = {
  productName: string;
  triggerLabel?: string;
  triggerVariant?: ButtonProps["variant"];
} & (
  | { mode: "create"; orderItemId: string }
  | {
      mode: "edit";
      review: { id: string; rating: number; title: string | null; body: string; status: string };
    }
);

// One form for both modes: the review id slot carries the order item id when creating.
type FormValues = ReviewUpdateInput;

/**
 * Write or edit a review. The database re-checks the verified purchase, the
 * review window and ownership; every new or edited review is moderated.
 */
export function ReviewFormDialog(props: ReviewFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const defaults: FormValues =
    props.mode === "edit"
      ? {
          reviewId: props.review.id,
          rating: String(props.review.rating),
          title: props.review.title ?? "",
          body: props.review.body,
        }
      : { reviewId: props.orderItemId, rating: "", title: "", body: "" };
  const form = useForm<FormValues, unknown, ReviewUpdateValues>({
    resolver: zodResolver(reviewUpdateSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const rating = Number(useWatch({ control: form.control, name: "rating" })) || 0;
  const idPrefix = props.mode === "edit" ? props.review.id : props.orderItemId;

  const onSubmit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result =
        props.mode === "edit"
          ? await updateReview(values)
          : await submitReview({
              orderItemId: props.orderItemId,
              rating: values.rating,
              title: values.title,
              body: values.body,
            });
      if (!result.ok) {
        setFormError(applyActionError(form.setError, result.error, ["rating", "title", "body"]));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          form.reset(defaults);
          setFormError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={props.triggerVariant ?? (props.mode === "edit" ? "outline" : "primary")}>
          <PenLine /> {props.triggerLabel ?? (props.mode === "edit" ? "Edit review" : "Write a review")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{props.mode === "edit" ? "Edit your review" : "Review this purchase"}</DialogTitle>
          <DialogDescription>
            {props.productName}.{" "}
            {props.mode === "edit" && props.review.status === "approved"
              ? "Your changes are checked by our team before they are published again."
              : "Our team checks every review before it is published."}{" "}
            Your first name and last initial are shown with it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          {formError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">Your rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className="cursor-pointer rounded-sm focus-within:ring-2 focus-within:ring-ink">
                  <input
                    type="radio"
                    value={String(value)}
                    className="sr-only"
                    aria-label={`${value} ${value === 1 ? "star" : "stars"}`}
                    {...form.register("rating")}
                  />
                  <Star
                    aria-hidden
                    className={cn(
                      "size-7 transition-colors",
                      value <= rating ? "fill-current text-ink" : "text-line-strong",
                    )}
                  />
                </label>
              ))}
            </div>
            {errors.rating?.message ? <p className="text-xs text-danger">{errors.rating.message}</p> : null}
          </fieldset>
          <FormField id={`${idPrefix}-review-title`} label="Title (optional)" error={errors.title?.message}>
            <Input maxLength={120} placeholder="Sum it up in a few words" {...form.register("title")} />
          </FormField>
          <FormField
            id={`${idPrefix}-review-body`}
            label="Your review"
            hint="Fit, quality, how it looks in person — what would help another shopper?"
            error={errors.body?.message}
          >
            <Textarea rows={6} maxLength={4000} {...form.register("body")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {props.mode === "edit" ? "Save changes" : "Submit review"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
