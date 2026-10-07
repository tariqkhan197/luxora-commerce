import "server-only";

import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ShippingBlockReason, VendorShippingQuote } from "./quote";

/** Most addresses a customer is quoted for in one checkout render. */
export const MAX_QUOTED_ADDRESSES = 20;

function asReason(value: string | null): ShippingBlockReason | null {
  return value === "country_not_served" || value === "vendor_does_not_ship" ? value : null;
}

/**
 * Per-vendor shipping for the caller's bag to each of the given addresses,
 * computed by `public.checkout_shipping_quote` (the same rules `place_order`
 * charges). Addresses beyond `MAX_QUOTED_ADDRESSES` are not quoted.
 */
export async function getShippingQuotes(addressIds: readonly string[]): Promise<Record<string, VendorShippingQuote[]>> {
  const supabase = await createClient();
  const ids = addressIds.slice(0, MAX_QUOTED_ADDRESSES);
  const results = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await supabase.rpc("checkout_shipping_quote", { p_address_id: id });
      if (error) throw fromPostgrestError(error);
      const rows: VendorShippingQuote[] = (data ?? []).map((row) => ({
        vendorId: row.vendor_id,
        shippable: row.shippable,
        shippingMinor: Number(row.shipping_minor),
        minDeliveryDays: row.min_delivery_days,
        maxDeliveryDays: row.max_delivery_days,
        reason: asReason(row.reason),
      }));
      return [id, rows] as const;
    }),
  );
  return Object.fromEntries(results);
}
