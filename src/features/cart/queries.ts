import "server-only";

import { cache } from "react";
import type { CartLine, UnavailableReason } from "@/features/checkout/quote";
import { getCurrentUser } from "@/lib/auth/dal";
import { fromPostgrestError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { asOptionRecord, type Database } from "@/lib/supabase/database.types";

type CartLineRow = Database["public"]["Functions"]["cart_lines"]["Returns"][number];

const REASONS: readonly UnavailableReason[] = [
  "unavailable",
  "currency_mismatch",
  "out_of_stock",
  "insufficient_stock",
];

function toCartLine(row: CartLineRow): CartLine {
  // Generated types mark set-returning columns non-null; these two can be null.
  const storeSlug = row.store_slug as string | null;
  const imagePath = row.image_path as string | null;
  const reason = row.unavailable_reason as string | null;
  return {
    cartItemId: row.cart_item_id,
    variantId: row.variant_id,
    productId: row.product_id,
    productSlug: row.product_slug,
    productName: row.product_name,
    variantTitle: row.variant_title,
    sku: row.sku,
    options: asOptionRecord(row.options),
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    storeSlug,
    imagePath,
    currency: row.currency,
    quantity: row.quantity,
    unitPriceMinor: row.unit_price_minor,
    addedPriceMinor: row.added_price_minor,
    maxQuantity: row.max_quantity,
    purchasable: row.purchasable,
    unavailableReason: reason && (REASONS as readonly string[]).includes(reason) ? (reason as UnavailableReason) : null,
  };
}

/** The signed-in customer's active cart, priced from the catalog by the database. */
export const getCartLines = cache(async (): Promise<CartLine[]> => {
  const current = await getCurrentUser();
  if (!current) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cart_lines");
  if (error) throw fromPostgrestError(error);
  return (data ?? []).map(toCartLine);
});

export async function getCartItemCount(): Promise<number> {
  const lines = await getCartLines();
  return lines.reduce((count, line) => count + line.quantity, 0);
}
