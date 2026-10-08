"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TicketPercent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyCoupon, removeCoupon } from "../actions";

interface CouponFormProps {
  /** The code in the bag, if any, with why it does not apply right now. */
  current: { code: string; applied: boolean; message: string | null } | null;
}

/** Discount code entry for the bag. One code per order; the database checks it. */
export function CouponForm({ current }: CouponFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await applyCoupon({ code });
      if (!result.ok) {
        setFeedback({ ok: false, text: result.error.fieldErrors?.code?.[0] ?? result.error.message });
        return;
      }
      setFeedback({ ok: result.data.applied, text: result.data.message });
      if (result.data.applied) setCode("");
      router.refresh();
    });
  }

  function remove() {
    setFeedback(null);
    startTransition(async () => {
      await removeCoupon();
      router.refresh();
    });
  }

  if (current) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-medium text-ink">
            <TicketPercent className="size-4" aria-hidden /> {current.code}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={remove} loading={pending}>
            <X /> Remove
          </Button>
        </div>
        {!current.applied && current.message ? (
          <p role="alert" className="text-xs text-danger">
            {current.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={apply} className="flex flex-col gap-2">
      <label htmlFor="coupon-code" className="text-sm text-ink-soft">
        Discount code
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          maxLength={32}
          placeholder="Enter code"
        />
        <Button type="submit" variant="outline" loading={pending} disabled={!code.trim()}>
          Apply
        </Button>
      </div>
      {feedback ? (
        <p
          role={feedback.ok ? "status" : "alert"}
          className={`text-xs ${feedback.ok ? "text-success" : "text-danger"}`}
        >
          {feedback.text}
        </p>
      ) : null}
      <p className="text-xs text-ink-faint">One code per order. Codes don&rsquo;t apply to flash-sale items.</p>
    </form>
  );
}
