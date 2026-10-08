import "server-only";

import { cache } from "react";
import type { CartLine, PromotionQuote, UnavailableReason } from "@/features/checkout/quote";
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
    listPriceMinor: row.list_price_minor,
    flashSaleItemId: row.flash_sale_item_id as string | null,
    flashSaleEndsAt: row.flash_sale_ends_at as string | null,
    flashSaleUnitsLeft: row.flash_sale_units_left as number | null,
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

function asAmounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, amount]) => [key, Number(amount)] as const)
      .filter(([, amount]) => Number.isSafeInteger(amount) && amount >= 0),
  );
}

/**
 * The bag's discount code as evaluated by the database (null without a code).
 * With a shipping address the free-shipping amounts are included.
 */
export async function getPromotionQuote(addressId?: string): Promise<PromotionQuote | null> {
  const current = await getCurrentUser();
  if (!current) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cart_promotion_quote", addressId ? { p_address_id: addressId } : {});
  if (error) throw fromPostgrestError(error);
  const row = data?.[0];
  if (!row) return null;
  return {
    couponId: row.coupon_id,
    code: row.code,
    name: row.name,
    fundedBy: row.funded_by === "vendor" ? "vendor" : "platform",
    discountType: row.discount_type,
    applied: row.applied,
    message: row.message as string | null,
    discountMinor: Number(row.discount_minor),
    shippingDiscountMinor: Number(row.shipping_discount_minor),
    lineDiscounts: asAmounts(row.line_discounts),
    vendorShippingDiscounts: asAmounts(row.vendor_shipping_discounts),
  };
}
