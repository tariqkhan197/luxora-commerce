"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Never renders error internals to the user; the
 * digest is shown so support can correlate with server logs.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container-editorial flex min-h-[60vh] flex-col items-start justify-center py-16">
      <p className="mb-4 eyebrow">Something went wrong</p>
      <h1 className="display-2">We couldn&apos;t load this page.</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
        Please try again. If the problem persists, contact support
        {error.digest ? ` and quote reference ${error.digest}` : ""}.
      </p>
      <Button className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
