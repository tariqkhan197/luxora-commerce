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
import { adminDisableCoupon, adminDisableFlashSale } from "../actions";

const COPY = {
  coupon: {
    title: "Disable this code",
    description:
      "The code stops working at once and its owner cannot switch it back on. Orders already placed keep their discount. The reason is shown to the vendor and recorded in the audit log.",
    run: adminDisableCoupon,
  },
  flash_sale: {
    title: "Disable this flash sale",
    description:
      "The sale ends at once and prices return to normal. Orders already placed keep their price. The reason is shown to the vendor and recorded in the audit log.",
    run: adminDisableFlashSale,
  },
} as const;

/** Administrator: disable a coupon or a flash sale, with a reason. */
export function AdminDisableDialog({ id, kind }: { id: string; kind: keyof typeof COPY }) {
  const config = COPY[kind];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await config.run({ id, reason: String(formData.get("reason") ?? "") });
      if (!result.ok) {
        setError(result.error.fieldErrors?.reason?.[0] ?? result.error.fieldErrors?._form?.[0] ?? result.error.message);
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
        <Button size="sm" variant="ghost">
          Disable
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
          <FormField id={`${id}-disable-reason`} label="Reason">
            <Textarea name="reason" rows={3} maxLength={500} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              Disable
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
