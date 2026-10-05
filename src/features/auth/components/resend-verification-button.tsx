"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { resendVerificationEmail } from "../actions";

export function ResendVerificationButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="outline"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await resendVerificationEmail({ email });
            setMessage(result.ok ? "A new verification email has been sent." : result.error.message);
          })
        }
      >
        Resend verification email
      </Button>
      {message ? (
        <p className="text-xs text-ink-soft" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
