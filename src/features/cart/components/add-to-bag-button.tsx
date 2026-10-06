"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { addToCart } from "../actions";

interface AddToBagButtonProps {
  variantId: string;
  inStock: boolean;
  /** Where to return after signing in. */
  returnPath: string;
}

export function AddToBagButton({ variantId, inStock, returnPath }: AddToBagButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="lg"
        disabled={!inStock}
        loading={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await addToCart({ variantId, quantity: 1 });
            if (!result.ok) {
              if (result.error.code === "UNAUTHORIZED") {
                router.push(`${ROUTES.auth.login}?next=${encodeURIComponent(returnPath)}`);
                return;
              }
              setMessage({ kind: "error", text: result.error.message });
              return;
            }
            setMessage({
              kind: "success",
              text: result.data.quantity > 1 ? `Added — ${result.data.quantity} in your bag.` : "Added to your bag.",
            });
            router.refresh();
          });
        }}
      >
        {inStock ? "Add to bag" : "Sold out"}
      </Button>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-sm ${message.kind === "error" ? "text-danger" : "text-ink-soft"}`}
        >
          {message.text}{" "}
          {message.kind === "success" ? (
            <Link href={ROUTES.cart} className="font-medium text-ink underline-offset-4 hover:underline">
              View bag
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
