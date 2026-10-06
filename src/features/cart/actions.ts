"use server";

import { revalidatePath } from "next/cache";
import { ROUTES } from "@/config/routes";
import { assertUser } from "@/lib/auth/dal";
import { fromPostgrestError, runAction, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { addToCartSchema, updateCartItemSchema, uuidSchema } from "@/lib/validation";

/**
 * Cart Server Actions. They pass only ids and quantities to the database cart
 * functions, which look up prices, check availability and enforce ownership.
 */

function revalidateCart() {
  revalidatePath(ROUTES.cart);
  revalidatePath(ROUTES.checkout);
  revalidatePath("/", "layout"); // header bag count
}

export async function addToCart(input: unknown): Promise<ActionResult<{ quantity: number }>> {
  return runAction(async () => {
    const { variantId, quantity } = addToCartSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_to_cart", { p_variant_id: variantId, p_quantity: quantity });
    if (error) throw fromPostgrestError(error);
    revalidateCart();
    return { quantity: data };
  });
}

export async function updateCartItem(input: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const { cartItemId, quantity } = updateCartItemSchema.parse(input);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_cart_item_quantity", {
      p_cart_item_id: cartItemId,
      p_quantity: quantity,
    });
    if (error) throw fromPostgrestError(error);
    revalidateCart();
  });
}

export async function removeCartItem(cartItemId: unknown): Promise<ActionResult<void>> {
  return runAction(async () => {
    const id = uuidSchema.parse(cartItemId);
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_cart_item", { p_cart_item_id: id });
    if (error) throw fromPostgrestError(error);
    revalidateCart();
  });
}

export async function clearCart(): Promise<ActionResult<void>> {
  return runAction(async () => {
    await assertUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("clear_cart");
    if (error) throw fromPostgrestError(error);
    revalidateCart();
  });
}
