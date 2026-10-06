"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { removeCartItem, updateCartItem } from "../actions";

interface CartLineControlsProps {
  cartItemId: string;
  quantity: number;
  maxQuantity: number;
  productName: string;
}

export function CartLineControls({ cartItemId, quantity, maxQuantity, productName }: CartLineControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const limit = Math.max(Math.min(maxQuantity, 99), 0);
  const options = Array.from({ length: Math.max(limit, quantity) }, (_, index) => index + 1);

  function run(action: () => ReturnType<typeof updateCartItem>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error.message);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2">
        {limit > 0 ? (
          <div className="w-20">
            <Select
              aria-label={`Quantity of ${productName}`}
              value={String(quantity)}
              disabled={pending}
              onChange={(event) => run(() => updateCartItem({ cartItemId, quantity: Number(event.target.value) }))}
              className="h-9"
            >
              {options.map((value) => (
                <option key={value} value={value} disabled={value > limit}>
                  {value}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(() => removeCartItem(cartItemId))}
          aria-label={`Remove ${productName} from bag`}
        >
          {pending ? <Loader2 className="animate-spin" /> : <X />} Remove
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
