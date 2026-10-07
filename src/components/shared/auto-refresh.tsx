"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current server page every `intervalMs`, at most `maxRefreshes` times. */
export function AutoRefresh({ intervalMs = 3000, maxRefreshes = 10 }: { intervalMs?: number; maxRefreshes?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= maxRefreshes) window.clearInterval(timer);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs, maxRefreshes]);
  return null;
}
