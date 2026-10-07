import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  addAddress,
  addToCart,
  inventoryOf,
  newVendor,
  openCheckoutSession,
  orderRow,
  placeOrder,
} from "./checkout-fixtures";
import {
  asAnon,
  asService,
  asUser,
  createActiveProduct,
  createPool,
  createUser,
  expectSqlError,
  SQLSTATE,
} from "./harness";

const pool = createPool();
afterAll(() => pool.end());

async function pendingOrder(options: { stock?: number; quantity?: number; priceMinor?: number } = {}) {
  const customer = await createUser(pool);
  const { vendorId } = await newVendor(pool, 1000);
  const product = await createActiveProduct(pool, vendorId, {
    priceMinor: options.priceMinor ?? 10_000,
    stock: options.stock ?? 5,
  });
  const addressId = await addAddress(pool, customer);
  await addToCart(pool, customer, product.variantId, options.quantity ?? 2);
  const orderId = await placeOrder(pool, customer, addressId);
  return { customer, vendorId, orderId, addressId, ...product };
}

const confirm = (orderId: string, paymentIntent: string, amount: number, fee: number | null, sessionId?: string) =>
  asService(
    pool,
    (s) =>
      s.one<{ payment_id: string; outcome: string }>(
        "select * from public.confirm_order_payment($1, 'stripe', $2, $3, 'USD', $4, 0, $5, false, $6)",
        [orderId, paymentIntent, amount, fee, sessionId ?? null, JSON.stringify({ id: "evt_test_raw", secret: "x" })],
      ),
    true,
  );

describe("payment attempts", () => {
  it("lets only the order's customer begin an attempt, and only the platform record a session", async () => {
    const { customer, orderId } = await pendingOrder();
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select * from public.begin_payment_attempt($1)", [orderId]),
    );
    await asAnon(pool, (s) => s.denied("select * from public.begin_payment_attempt($1)", [orderId]));

    const begin = await asUser(pool, customer, (s) =>
      s.one<{ action: string; attempt_no: number; session_expires_at: Date; amount_minor: string }>(
        "select * from public.begin_payment_attempt($1)",
        [orderId],
      ),
    );
    expect(begin).toMatchObject({ action: "create", attempt_no: 1, amount_minor: "20000" });
    const minutes = (begin.session_expires_at.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);

    // Customers can never record (forge) a provider session.
    await asUser(pool, customer, (s) =>
      s.denied(
        "select public.record_checkout_session($1, 1, 'stripe', 'cs_test_forged', null, now() + interval '30 minutes', 20000, 'USD', false)",
        [orderId],
      ),
    );
  });

  it("records a session, extends the stock hold to its expiry plus grace, and reuses the open session", async () => {
    const { customer, orderId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    const order = await orderRow(pool, orderId);
    const holdAfterSession = (order.reservation_expires_at!.getTime() - session.session_expires_at.getTime()) / 60_000;
    expect(holdAfterSession).toBeCloseTo(5, 5);

    const again = await asUser(pool, customer, (s) =>
      s.one<{ action: string; checkout_url: string }>("select * from public.begin_payment_attempt($1)", [orderId]),
    );
    expect(again).toMatchObject({
      action: "reuse",
      checkout_url: `https://checkout.stripe.com/c/pay/${session.sessionId}`,
    });

    // Recording the same session twice is idempotent.
    await asService(pool, (s) =>
      s.query("select public.record_checkout_session($1, 1, 'stripe', $2, null, $3, 20000, 'USD', false)", [
        orderId,
        session.sessionId,
        session.session_expires_at,
      ]),
    );
    const { rows } = await pool.query("select count(*)::int as n from public.payment_attempts where order_id = $1", [
      orderId,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects sessions whose amount differs from the order, and live-mode data", async () => {
    const { customer, orderId } = await pendingOrder();
    const begin = await asUser(pool, customer, (s) =>
      s.one<{ session_expires_at: Date }>("select * from public.begin_payment_attempt($1)", [orderId]),
    );
    await asService(pool, (s) =>
      s.fails(
        SQLSTATE.checkViolation,
        "select public.record_checkout_session($1, 1, 'stripe', 'cs_test_wrong', null, $2, 19999, 'USD', false)",
        [orderId, begin.session_expires_at],
      ),
    );
    await asService(pool, (s) =>
      s.denied("select public.record_checkout_session($1, 1, 'stripe', 'cs_live_x', null, $2, 20000, 'USD', true)", [
        orderId,
        begin.session_expires_at,
      ]),
    );
    await asService(pool, (s) =>
      s.denied(
        "select public.begin_webhook_event('evt_live_1', 'stripe', 'checkout.session.completed', true, null, '{}')",
      ),
    );
    await asService(pool, (s) =>
      s.denied(
        "select * from public.confirm_order_payment($1, 'stripe', 'pi_live_1', 20000, 'USD', 0, 0, null, true)",
        [orderId],
      ),
    );
  });

  it("caps attempts per order and the total stock hold", async () => {
    const { customer, orderId } = await pendingOrder();
    for (let i = 0; i < 3; i += 1) {
      // Simulate the previous session expiring before the customer retries.
      await pool.query(
        "update public.payment_attempts set expires_at = now() where order_id = $1 and status = 'open'",
        [orderId],
      );
      await openCheckoutSession(pool, customer, orderId);
    }
    await pool.query("update public.payment_attempts set expires_at = now() where order_id = $1 and status = 'open'", [
      orderId,
    ]);
    const capped = await asUser(pool, customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.begin_payment_attempt($1)", [orderId]),
    );
    expect(capped.message).toContain("maximum number of payment attempts");

    const other = await pendingOrder();
    await pool.query("update public.orders set placed_at = now() - interval '100 minutes' where id = $1", [
      other.orderId,
    ]);
    const closed = await asUser(pool, other.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.begin_payment_attempt($1)", [other.orderId]),
    );
    expect(closed.message).toContain("payment window for this order has closed");
  });

  it("shows customers their attempt state but never the checkout URL or provider ids", async () => {
    const { customer, orderId } = await pendingOrder();
    await openCheckoutSession(pool, customer, orderId);
    await asUser(pool, customer, async (s) => {
      const row = await s.one<{ status: string; attempt_no: number }>(
        "select status, attempt_no from public.payment_attempts where order_id = $1",
        [orderId],
      );
      expect(row).toEqual({ status: "open", attempt_no: 1 });
      await s.denied("select checkout_url from public.payment_attempts where order_id = $1", [orderId]);
      await s.denied("select provider_session_id from public.payment_attempts where order_id = $1", [orderId]);
    });
    const stranger = await createUser(pool);
    const seen = await asUser(pool, stranger, (s) =>
      s.rows("select id from public.payment_attempts where order_id = $1", [orderId]),
    );
    expect(seen).toEqual([]);
  });
});

describe("payment confirmation", () => {
  it("confirms once per provider payment and keeps the raw payload away from the customer", async () => {
    const { customer, orderId, variantId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    const first = await confirm(orderId, `pi_test_${randomUUID().slice(0, 8)}`, 20_000, 610, session.sessionId);
    expect(first.outcome).toBe("confirmed");
    expect(await inventoryOf(pool, variantId)).toEqual({
      stock_quantity: 3,
      reserved_quantity: 0,
      available_quantity: 3,
    });
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "confirmed", payment_status: "paid" });
    const attempt = await pool.query("select status from public.payment_attempts where provider_session_id = $1", [
      session.sessionId,
    ]);
    expect(attempt.rows[0].status).toBe("complete");

    // Fees are borne by the platform: vendor earnings are untouched.
    const vendorOrder = await pool.query(
      "select payment_fee_minor, vendor_earnings_minor, total_minor, commission_minor from public.vendor_orders where order_id = $1",
      [orderId],
    );
    expect(vendorOrder.rows[0]).toEqual({
      payment_fee_minor: "0",
      vendor_earnings_minor: "18000",
      total_minor: "20000",
      commission_minor: "2000",
    });

    await asUser(pool, customer, async (s) => {
      const payment = await s.one<{ metadata: Record<string, unknown>; status: string }>(
        "select metadata, status from public.payments where order_id = $1",
        [orderId],
      );
      expect(payment.status).toBe("paid");
      expect(payment.metadata).toEqual({
        session_id: session.sessionId,
        livemode: false,
        fee_pending: false,
        late: false,
      });
      // Raw provider payloads live in admin-only transactions.
      const tx = await s.rows("select id from public.payment_transactions");
      expect(tx).toEqual([]);
    });
  });

  it("records a processing fee that arrives after the payment, once", async () => {
    const { customer, orderId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    const intent = `pi_test_${randomUUID().slice(0, 8)}`;
    await confirm(orderId, intent, 20_000, null, session.sessionId);
    const pending = await pool.query("select fee_minor, metadata from public.payments where provider_payment_id = $1", [
      intent,
    ]);
    expect(pending.rows[0]).toMatchObject({ fee_minor: "0", metadata: expect.objectContaining({ fee_pending: true }) });

    const recorded = await asService(
      pool,
      (s) => s.one<{ r: string }>("select public.record_payment_fee('stripe', $1, 610) as r", [intent]),
      true,
    );
    expect(recorded.r).toBe("recorded");
    const again = await asService(
      pool,
      (s) => s.one<{ r: string }>("select public.record_payment_fee('stripe', $1, 610) as r", [intent]),
      true,
    );
    expect(again.r).toBe("duplicate");
    const after = await pool.query("select fee_minor, metadata from public.payments where provider_payment_id = $1", [
      intent,
    ]);
    expect(after.rows[0].fee_minor).toBe("610");
    expect(after.rows[0].metadata).not.toHaveProperty("fee_pending");
  });

  it("treats money for a closed order as refund-required and records the automatic refund", async () => {
    const { customer, orderId, variantId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    await asService(pool, (s) => s.query("select public.expire_payment_attempt($1)", [session.sessionId]), true);
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "cancelled", payment_status: "expired" });
    expect(await inventoryOf(pool, variantId)).toMatchObject({ reserved_quantity: 0, stock_quantity: 5 });

    const intent = `pi_test_${randomUUID().slice(0, 8)}`;
    const late = await confirm(orderId, intent, 20_000, 610, session.sessionId);
    expect(late.outcome).toBe("refund_required");
    // Stock is never committed for a closed order, and the order stays closed.
    expect(await inventoryOf(pool, variantId)).toMatchObject({ reserved_quantity: 0, stock_quantity: 5 });
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "cancelled", payment_status: "expired" });
    const audit = await pool.query("select action from public.audit_logs where entity_id = $1", [orderId]);
    expect(audit.rows.map((r) => r.action)).toContain("payment.late_received");

    const refund = await asService(
      pool,
      (s) =>
        s.one<{ r: string }>("select public.record_late_payment_refund($1, 're_test_late') as r", [late.payment_id]),
      true,
    );
    expect(refund.r).toBe("recorded");
    const replay = await asService(
      pool,
      (s) =>
        s.one<{ r: string }>("select public.record_late_payment_refund($1, 're_test_late') as r", [late.payment_id]),
      true,
    );
    expect(replay.r).toBe("duplicate");
    const payment = await pool.query("select status, refunded_minor from public.payments where id = $1", [
      late.payment_id,
    ]);
    expect(payment.rows[0]).toEqual({ status: "refunded", refunded_minor: "20000" });
    const refunds = await pool.query("select status, amount_minor from public.refunds where payment_id = $1", [
      late.payment_id,
    ]);
    expect(refunds.rows).toEqual([{ status: "completed", amount_minor: "20000" }]);
  });

  it("rejects amount and tax mismatches, and browsers entirely", async () => {
    const { customer, orderId } = await pendingOrder();
    await asService(pool, (s) =>
      s.fails(
        SQLSTATE.checkViolation,
        "select * from public.confirm_order_payment($1, 'stripe', 'pi_test_bad', 19999, 'USD')",
        [orderId],
      ),
    );
    await asService(pool, (s) =>
      s.fails(
        SQLSTATE.checkViolation,
        "select * from public.confirm_order_payment($1, 'stripe', 'pi_test_tax', 20000, 'USD', 0, 100)",
        [orderId],
      ),
    );
    await asUser(pool, customer, (s) =>
      s.denied("select * from public.confirm_order_payment($1, 'stripe', 'pi_test_x', 20000, 'USD')", [orderId]),
    );
  });
});

describe("processing, failure, expiry and cancellation", () => {
  it("never expires an order whose payment is processing, and fails it cleanly", async () => {
    const { customer, orderId, variantId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    const processing = await asService(
      pool,
      (s) =>
        s.one<{ r: string }>("select public.mark_payment_processing($1, 'pi_test_async', false) as r", [
          session.sessionId,
        ]),
      true,
    );
    expect(processing.r).toBe("processing");
    await pool.query("update public.orders set reservation_expires_at = now() - interval '1 minute' where id = $1", [
      orderId,
    ]);
    await asService(pool, (s) => s.query("select public.expire_stale_checkouts()"), true);
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "pending", payment_status: "processing" });

    const cancel = await asUser(pool, customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.cancel_pending_order($1)", [orderId]),
    );
    expect(cancel.message).toContain("being processed");

    const failed = await asService(
      pool,
      (s) => s.one<{ r: string }>("select public.fail_payment_attempt($1, 'payment_failed') as r", [session.sessionId]),
      true,
    );
    expect(failed.r).toBe("order_failed");
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "cancelled", payment_status: "failed" });
    expect(await inventoryOf(pool, variantId)).toMatchObject({ reserved_quantity: 0 });
  });

  it("confirms an order whose payment was processing", async () => {
    const { customer, orderId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    await asService(
      pool,
      (s) => s.query("select public.mark_payment_processing($1, 'pi_test_async2', false)", [session.sessionId]),
      true,
    );
    const result = await confirm(orderId, "pi_test_async2", 20_000, 0, session.sessionId);
    expect(result.outcome).toBe("confirmed");
  });

  it("expires the order only when no other session can still pay it", async () => {
    const { customer, orderId } = await pendingOrder();
    const first = await openCheckoutSession(pool, customer, orderId);
    await pool.query("update public.payment_attempts set expires_at = now() where provider_session_id = $1", [
      first.sessionId,
    ]);
    const second = await openCheckoutSession(pool, customer, orderId);
    // The first session's late expiry event must not cancel an order the second can still pay.
    const late = await asService(
      pool,
      (s) => s.one<{ r: string }>("select public.expire_payment_attempt($1) as r", [first.sessionId]),
      true,
    );
    expect(late.r).toBe("attempt_expired");
    expect(await orderRow(pool, orderId)).toMatchObject({ status: "pending", payment_status: "pending" });
    const now = await asService(
      pool,
      (s) => s.one<{ r: string }>("select public.expire_payment_attempt($1) as r", [second.sessionId]),
      true,
    );
    expect(now.r).toBe("order_expired");
    const unknown = await asService(pool, (s) =>
      s.one<{ r: string }>("select public.expire_payment_attempt('cs_test_nope') as r"),
    );
    expect(unknown.r).toBe("unknown_session");
  });

  it("refuses to cancel while a payment page is open, then cancels once it is closed", async () => {
    const { customer, orderId, variantId } = await pendingOrder();
    const session = await openCheckoutSession(pool, customer, orderId);
    const blocked = await asUser(pool, customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.cancel_pending_order($1)", [orderId]),
    );
    expect(blocked.message).toContain("open payment page");
    await asUser(pool, customer, (s) => s.denied("select public.close_payment_attempt($1)", [session.sessionId]));
    await asService(pool, (s) => s.query("select public.close_payment_attempt($1)", [session.sessionId]), true);
    await asUser(pool, customer, (s) => s.query("select public.cancel_pending_order($1)", [orderId]), true);
    expect(await orderRow(pool, orderId)).toMatchObject({
      status: "cancelled",
      payment_status: "cancelled",
      cancellation_reason: "cancelled_by_customer",
    });
    expect(await inventoryOf(pool, variantId)).toMatchObject({ reserved_quantity: 0 });
  });
});

describe("webhook de-duplication", () => {
  const begin = (eventId: string) =>
    asService(
      pool,
      (s) =>
        s.one<{ r: string }>(
          "select public.begin_webhook_event($1, 'stripe', 'checkout.session.completed', false, '2026-test', '{}') as r",
          [eventId],
        ),
      true,
    );
  const finish = (eventId: string, status: string, error: string | null = null) =>
    asService(pool, (s) => s.query("select public.finish_webhook_event($1, $2, $3)", [eventId, status, error]), true);

  it("processes an event once, reports concurrent deliveries as busy and retries failures", async () => {
    const id = `evt_test_${randomUUID().slice(0, 8)}`;
    expect((await begin(id)).r).toBe("process");
    expect((await begin(id)).r).toBe("busy");
    await finish(id, "failed", "boom");
    expect((await begin(id)).r).toBe("process");
    await finish(id, "processed");
    expect((await begin(id)).r).toBe("duplicate");
    const row = await pool.query(
      "select status, attempts, last_error, processed_at from public.payment_webhook_events where event_id = $1",
      [id],
    );
    expect(row.rows[0]).toMatchObject({ status: "processed", attempts: 2, last_error: null });
    expect(row.rows[0].processed_at).toBeInstanceOf(Date);
  });

  it("is invisible and unusable for customers; admins can read events", async () => {
    const id = `evt_test_${randomUUID().slice(0, 8)}`;
    await begin(id);
    const customer = await createUser(pool);
    const admin = await createUser(pool, { role: "admin" });
    await asUser(pool, customer, async (s) => {
      expect(await s.rows("select event_id from public.payment_webhook_events where event_id = $1", [id])).toEqual([]);
      await s.denied("select public.begin_webhook_event('evt_x', 'stripe', 't', false, null, '{}')");
      await s.denied("select public.finish_webhook_event($1, 'processed')", [id]);
    });
    const seen = await asUser(pool, admin, (s) =>
      s.rows("select event_id from public.payment_webhook_events where event_id = $1", [id]),
    );
    expect(seen).toHaveLength(1);
    await asAnon(pool, (s) => s.denied("select event_id from public.payment_webhook_events"));
  });
});

describe("restore cart", () => {
  it("puts an expired order's items back in the bag at current prices, once", async () => {
    const { customer, orderId, variantId, productId } = await pendingOrder({ quantity: 2 });
    const session = await openCheckoutSession(pool, customer, orderId);
    await asService(pool, (s) => s.query("select public.expire_payment_attempt($1)", [session.sessionId]), true);
    await pool.query("update public.product_variants set price_minor = 12000 where id = $1", [variantId]);

    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select * from public.restore_cart_from_order($1)", [orderId]),
    );
    const result = await asUser(
      pool,
      customer,
      (s) =>
        s.one<{ restored: number; skipped: number }>("select * from public.restore_cart_from_order($1)", [orderId]),
      true,
    );
    expect(result).toEqual({ restored: 1, skipped: 0 });
    const lines = await asUser(pool, customer, (s) =>
      s.rows<{ quantity: number; unit_price_minor: string }>(
        "select quantity, unit_price_minor from public.cart_lines()",
      ),
    );
    expect(lines).toEqual([{ quantity: 2, unit_price_minor: "12000" }]);

    const twice = await asUser(pool, customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.restore_cart_from_order($1)", [orderId]),
    );
    expect(twice.message).toContain("already been restored");
    expect(productId).toBeTruthy();
  });

  it("skips items that can no longer be bought and refuses paid orders", async () => {
    const { customer, orderId, productId } = await pendingOrder({ quantity: 1 });
    await asUser(pool, customer, (s) => s.query("select public.cancel_pending_order($1)", [orderId]), true);
    await pool.query("update public.products set status = 'archived' where id = $1", [productId]);
    const result = await asUser(
      pool,
      customer,
      (s) =>
        s.one<{ restored: number; skipped: number }>("select * from public.restore_cart_from_order($1)", [orderId]),
      true,
    );
    expect(result).toEqual({ restored: 0, skipped: 1 });

    const paid = await pendingOrder();
    const session = await openCheckoutSession(pool, paid.customer, paid.orderId);
    await confirm(paid.orderId, `pi_test_${randomUUID().slice(0, 8)}`, 20_000, 0, session.sessionId);
    await asUser(pool, paid.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.restore_cart_from_order($1)", [paid.orderId]),
    );
  });
});

describe("catalog guards", () => {
  it("prices every product in the platform currency", async () => {
    const { vendorId } = await newVendor(pool);
    await expectSqlError(
      pool.query("insert into public.products (vendor_id, slug, name, currency) values ($1, $2, 'Euro thing', 'EUR')", [
        vendorId,
        `euro-${randomUUID().slice(0, 8)}`,
      ]),
      SQLSTATE.raiseException,
    );
  });

  it("caps a bag at 100 different items (hosted checkout's line-item limit)", async () => {
    const customer = await createUser(pool);
    const { vendorId } = await newVendor(pool);
    const { productId } = await createActiveProduct(pool, vendorId, { stock: 5 });
    const variants = await pool.query<{ id: string }>(
      `insert into public.product_variants (product_id, sku, title, price_minor)
       select $1, 'BULK-' || $2 || '-' || g, 'Variant ' || g, 1000 from generate_series(1, 101) g returning id`,
      [productId, randomUUID().slice(0, 6)],
    );
    const cart = await pool.query<{ id: string }>(
      "insert into public.carts (profile_id, currency) values ($1, 'USD') returning id",
      [customer.profileId],
    );
    await pool.query(
      "insert into public.cart_items (cart_id, variant_id, quantity, unit_price_minor) select $1, unnest($2::uuid[]), 1, 1000",
      [cart.rows[0].id, variants.rows.slice(0, 100).map((v) => v.id)],
    );
    const error = await expectSqlError(
      pool.query(
        "insert into public.cart_items (cart_id, variant_id, quantity, unit_price_minor) values ($1, $2, 1, 1000)",
        [cart.rows[0].id, variants.rows[100].id],
      ),
      SQLSTATE.raiseException,
    );
    expect(error.message).toBe("Your bag can hold up to 100 different items.");
  });
});
