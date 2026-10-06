import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type Address = Tables<"addresses">;

/** Addresses of the signed-in user (RLS restricts rows to the owner). */
export async function listAddresses(profileId: string): Promise<Address[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("addresses")
    .select("*")
    .eq("profile_id", profileId)
    .order("is_default_shipping", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw fromPostgrestError(error);
  return data ?? [];
}
