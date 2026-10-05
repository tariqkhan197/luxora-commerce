import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getClientEnv, getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES Row Level Security.
 *
 * Only for trusted server-side workflows that must act across tenants
 * (checkout orchestration, payment webhooks, scheduled jobs). Never pass this
 * client's results to the browser without re-checking authorization, and never
 * import this module from a Client Component (`server-only` enforces this).
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getClientEnv();
  const { SUPABASE_SECRET_KEY } = getServerEnv();
  return createSupabaseClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
