import "server-only";

import { paymentsEnabled } from "./provider";

/**
 * Whether online payment is available, for rendering. A misconfiguration is
 * logged and treated as "off" so pages degrade to the Phase 3 behaviour
 * instead of failing; the payment entry points still refuse to run.
 */
export function paymentsOn(): boolean {
  try {
    return paymentsEnabled();
  } catch (error) {
    console.error("[payments] configuration error:", error instanceof Error ? error.message : error);
    return false;
  }
}
