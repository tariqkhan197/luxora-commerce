"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";

interface ActionButtonProps extends Omit<ButtonProps, "onClick" | "loading"> {
  /** Server action to run. Return value errors are shown below the button. */
  action: () => Promise<ActionResult<unknown> | void>;
  /** Native confirm() prompt before running. */
  confirmMessage?: string;
  onSuccess?: () => void;
  successMessage?: string;
}

/**
 * Button that runs a Server Action with pending state and inline error/success
 * feedback. Use for single-click state transitions (approve, archive, publish).
 */
export function ActionButton({
  action,
  confirmMessage,
  onSuccess,
  successMessage,
  children,
  ...props
}: ActionButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <Button
        {...props}
        loading={pending}
        onClick={() => {
          if (confirmMessage && !window.confirm(confirmMessage)) return;
          setMessage(null);
          startTransition(async () => {
            const result = await action();
            if (result && !result.ok) {
              setMessage({ kind: "error", text: result.error.fieldErrors?._form?.[0] ?? result.error.message });
              return;
            }
            if (successMessage) setMessage({ kind: "success", text: successMessage });
            onSuccess?.();
            router.refresh();
          });
        }}
      >
        {children}
      </Button>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-xs ${message.kind === "error" ? "text-danger" : "text-success"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
