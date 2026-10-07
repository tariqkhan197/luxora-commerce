import { randomUUID } from "node:crypto";
import type pg from "pg";
import { asService, asUser, createApprovedVendor, createUser, TEST_SHIPPING_COUNTRY, type TestUser } from "./harness";

/** Checkout fixtures shared by the payment-era suites (Phase 4b onwards). */

export async function addAddress(pool: pg.Pool, user: TestUser): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.addresses (profile_id, type, full_name, line1, city, postal_code, country_code)
     values ($1, 'both', 'Test Customer', '12 Rue Saint-Honoré', 'Paris', '75001', $2) returning id`,
    [user.profileId, TEST_SHIPPING_COUNTRY],
  );
  return rows[0].id;
}

export async function addToCart(pool: pg.Pool, user: TestUser, variantId: string, quantity = 1): Promise<void> {
  await asUser(pool, user, (s) => s.query("select public.add_to_cart($1, $2)", [variantId, quantity]), true);
}

export async function placeOrder(pool: pg.Pool, user: TestUser, addressId: string): Promise<string> {
  const row = await asUser(
    pool,
    user,
    (s) => s.one<{ id: string }>("select public.place_order($1, $1, $2) as id", [addressId, randomUUID()]),
    true,
  );
  return row.id;
}

export async function inventoryOf(pool: pg.Pool, variantId: string) {
  const { rows } = await pool.query<{ stock_quantity: number; reserved_quantity: number; available_quantity: number }>(
    "select stock_quantity, reserved_quantity, available_quantity from public.inventory where variant_id = $1",
    [variantId],
  );
  return rows[0];
}

export async function newVendor(pool: pg.Pool, commissionBps = 1000) {
  const owner = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner, { commissionBps });
  return { owner, vendorId };
}

export async function orderRow(pool: pg.Pool, orderId: string) {
  const { rows } = await pool.query<{
    status: string;
    payment_status: string;
    total_minor: string;
    cancellation_reason: string | null;
    reservation_expires_at: Date | null;
    placed_at: Date;
  }>(
    "select status, payment_status, total_minor, cancellation_reason, reservation_expires_at, placed_at from public.orders where id = $1",
    [orderId],
  );
  return rows[0];
}

/** Begins an attempt as the customer and records a fake test-mode session for it as the platform. */
export async function openCheckoutSession(pool: pg.Pool, customer: TestUser, orderId: string, sessionId?: string) {
  const begin = await asUser(
    pool,
    customer,
    (s) =>
      s.one<{ action: string; attempt_no: number; session_expires_at: Date; amount_minor: string; currency: string }>(
        "select * from public.begin_payment_attempt($1)",
        [orderId],
      ),
    true,
  );
  const id = sessionId ?? `cs_test_${randomUUID().replaceAll("-", "")}`;
  await asService(
    pool,
    (s) =>
      s.query("select public.record_checkout_session($1, $2, 'stripe', $3, $4, $5, $6, $7, false)", [
        orderId,
        begin.attempt_no,
        id,
        `https://checkout.stripe.com/c/pay/${id}`,
        begin.session_expires_at,
        begin.amount_minor,
        begin.currency,
      ]),
    true,
  );
  return { sessionId: id, ...begin };
}
