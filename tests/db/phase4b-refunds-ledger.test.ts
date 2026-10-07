import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAddress, addToCart, openCheckoutSession, placeOrder } from "./checkout-fixtures";
import {
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  ensureTestShippingZone,
  expectSqlError,
  SQLSTATE,
  type TestUser,
} from "./harness";

const pool = createPool();
let admin: TestUser;

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
});
afterAll(() => pool.end());

async function setSetting(key: string, value: unknown) {
  await pool.query("update public.platform_settings set value = $2::jsonb where key = $1", [
    key,
    JSON.stringify(value),
  ]);
}

/** A paid order: one vendor (10% commission, shipping 5.00 + 2.00 each extra), 2 units at 100.00. */
async function paidOrder(options: { fee?: number | null; quantity?: number } = {}) {
  const customer = await createUser(pool);
  const owner = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner, { commissionBps: 1000, freeTestShipping: false });
  const zoneId = await ensureTestShippingZone(pool);
  await pool.query(
    "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor, additional_item_minor) values ($1, $2, 500, 200)",
    [vendorId, zoneId],
  );
  const product = await createActiveProduct(pool, vendorId, { priceMinor: 10_000, stock: 10 });
  const addressId = await addAddress(pool, customer);
  await addToCart(pool, customer, product.variantId, options.quantity ?? 2);
  const orderId = await placeOrder(pool, customer, addressId);
  const session = await openCheckoutSession(pool, customer, orderId);
  const intent = `pi_test_${randomUUID().slice(0, 12)}`;
  const { rows: totals } = await pool.query<{ total_minor: string }>(
    "select total_minor from public.orders where id = $1",
    [orderId],
  );
  await asService(
    pool,
    (s) =>
      s.query("select * from public.confirm_order_payment($1, 'stripe', $2, $3, 'USD', $4, 0, $5, false)", [
        orderId,
        intent,
        Number(totals[0].total_minor),
        options.fee === undefined ? 600 : options.fee,
        session.sessionId,
      ]),
    true,
  );
  const vo = await pool.query<{ id: string; total_minor: string; commission_minor: string; shipping_minor: string }>(
    "select id, total_minor, commission_minor, shipping_minor from public.vendor_orders where order_id = $1",
    [orderId],
  );
  const item = await pool.query<{ id: string }>("select id from public.order_items where order_id = $1", [orderId]);
  return { customer, owner, vendorId, orderId, intent, vendorOrder: vo.rows[0], itemId: item.rows[0].id, ...product };
}

const requestRefund = (
  vendorOrderId: string,
  items: { order_item_id: string; quantity: number }[],
  kind: string,
  includeShipping: boolean | null = null,
) =>
  asUser(
    pool,
    admin,
    (s) =>
      s.one<{ refund_id: string; amount_minor: string; provider_payment_id: string }>(
        "select * from public.request_refund($1, $2, $3, 'Customer request', $4)",
        [vendorOrderId, JSON.stringify(items), kind, includeShipping],
      ),
    true,
  );

const submitted = (refundId: string, providerRefundId: string, status = "succeeded") =>
  asService(
    pool,
    (s) =>
      s.one<{ r: string }>("select public.mark_refund_submitted($1, $2, $3) as r", [
        refundId,
        providerRefundId,
        status,
      ]),
    true,
  );

async function vendorLedger(vendorId: string) {
  const { rows } = await pool.query<{ entry_type: string; amount_minor: string }>(
    "select entry_type, amount_minor from public.vendor_ledger_entries where vendor_id = $1 order by id",
    [vendorId],
  );
  return rows;
}

async function platformLedger(orderId: string) {
  const { rows } = await pool.query<{ entry_type: string; amount_minor: string }>(
    "select entry_type, amount_minor from public.platform_ledger_entries where order_id = $1 order by id",
    [orderId],
  );
  return rows;
}

describe("ledger postings on payment", () => {
  it("owes the vendor its earnings, books commission, and charges the fee to the platform", async () => {
    const { vendorId, orderId, vendorOrder } = await paidOrder();
    // 2 × 100.00 + shipping 5.00 + 2.00 = 207.00; commission 10% of merchandise = 20.00
    expect(vendorOrder).toMatchObject({ total_minor: "20700", commission_minor: "2000", shipping_minor: "700" });
    expect(await vendorLedger(vendorId)).toEqual([{ entry_type: "order_earning", amount_minor: "18700" }]);
    expect(await platformLedger(orderId)).toEqual([
      { entry_type: "processing_fee", amount_minor: "-600" },
      { entry_type: "commission_earned", amount_minor: "2000" },
    ]);
  });

  it("keeps earnings pending until delivery plus 14 days", async () => {
    const { vendorId, owner, vendorOrder } = await paidOrder();
    const balance = () =>
      asUser(pool, owner, (s) =>
        s.one<{ available_minor: string; pending_minor: string }>(
          "select available_minor, pending_minor from public.vendor_balances where vendor_id = $1",
          [vendorId],
        ),
      );
    expect(await balance()).toEqual({ available_minor: "0", pending_minor: "18700" });
    await pool.query("update public.vendor_orders set delivered_at = now() - interval '13 days' where id = $1", [
      vendorOrder.id,
    ]);
    expect(await balance()).toEqual({ available_minor: "0", pending_minor: "18700" });
    await pool.query("update public.vendor_orders set delivered_at = now() - interval '15 days' where id = $1", [
      vendorOrder.id,
    ]);
    expect(await balance()).toEqual({ available_minor: "18700", pending_minor: "0" });
  });

  it("adjusts vendor earnings when vendors bear fees and the fee arrives late", async () => {
    await setSetting("payments.fee_bearer", "vendor");
    try {
      const { vendorId, intent } = await paidOrder({ fee: null });
      await asService(pool, (s) => s.query("select public.record_payment_fee('stripe', $1, 600)", [intent]), true);
      expect(await vendorLedger(vendorId)).toEqual([
        { entry_type: "order_earning", amount_minor: "18700" },
        { entry_type: "fee_adjustment", amount_minor: "-600" },
      ]);
    } finally {
      await setSetting("payments.fee_bearer", "platform");
    }
  });
});

describe("refunds", () => {
  it("are requested by admins only", async () => {
    const { customer, owner, vendorOrder, itemId } = await paidOrder();
    for (const user of [customer, owner]) {
      await asUser(pool, user, (s) =>
        s.denied("select * from public.request_refund($1, $2, 'return', 'x reason', null)", [
          vendorOrder.id,
          JSON.stringify([{ order_item_id: itemId, quantity: 1 }]),
        ]),
      );
    }
  });

  it("refunds part of an order without shipping, borne by the platform", async () => {
    const { vendorId, orderId, vendorOrder, itemId, intent } = await paidOrder();
    const refund = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 1 }], "return");
    expect(refund).toMatchObject({ amount_minor: "10000", provider_payment_id: intent });
    const row = await pool.query(
      "select status, shipping_minor, commission_reversed_minor, vendor_debit_minor, kind from public.refunds where id = $1",
      [refund.refund_id],
    );
    expect(row.rows[0]).toEqual({
      status: "processing",
      shipping_minor: "0",
      commission_reversed_minor: "0",
      vendor_debit_minor: "0",
      kind: "return",
    });
    const items = await pool.query(
      "select quantity, amount_minor, commission_minor from public.refund_items where refund_id = $1",
      [refund.refund_id],
    );
    expect(items.rows).toEqual([{ quantity: 1, amount_minor: "10000", commission_minor: "1000" }]);

    expect((await submitted(refund.refund_id, "re_test_partial")).r).toBe("completed");
    const order = await pool.query("select status, payment_status from public.orders where id = $1", [orderId]);
    expect(order.rows[0]).toEqual({ status: "confirmed", payment_status: "partially_refunded" });
    const payment = await pool.query("select status, refunded_minor from public.payments where order_id = $1", [
      orderId,
    ]);
    expect(payment.rows[0]).toEqual({ status: "partially_refunded", refunded_minor: "10000" });
    const qty = await pool.query("select refunded_quantity from public.order_items where id = $1", [itemId]);
    expect(qty.rows[0].refunded_quantity).toBe(1);
    // Platform bears it: no vendor debit, a platform refund loss.
    expect(await vendorLedger(vendorId)).toEqual([{ entry_type: "order_earning", amount_minor: "18700" }]);
    expect((await platformLedger(orderId)).at(-1)).toEqual({ entry_type: "refund_loss", amount_minor: "-10000" });

    // Replays are harmless.
    expect((await submitted(refund.refund_id, "re_test_partial")).r).toBe("duplicate");
  });

  it("refunds shipping per policy on full cancellations and returns, and allows an explicit override", async () => {
    const cancel = await paidOrder();
    const full = [{ order_item_id: cancel.itemId, quantity: 2 }];
    expect((await requestRefund(cancel.vendorOrder.id, full, "cancellation")).amount_minor).toBe("20700");

    const ret = await paidOrder();
    expect(
      (await requestRefund(ret.vendorOrder.id, [{ order_item_id: ret.itemId, quantity: 2 }], "return")).amount_minor,
    ).toBe("20000");

    const override = await paidOrder();
    expect(
      (
        await requestRefund(
          override.vendorOrder.id,
          [{ order_item_id: override.itemId, quantity: 1 }],
          "goodwill",
          true,
        )
      ).amount_minor,
    ).toBe("10700");
  });

  it("marks a fully refunded order and vendor order as refunded", async () => {
    const { orderId, vendorOrder, itemId } = await paidOrder();
    const refund = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 2 }], "cancellation");
    await submitted(refund.refund_id, "re_test_full");
    const order = await pool.query("select status, payment_status from public.orders where id = $1", [orderId]);
    expect(order.rows[0]).toEqual({ status: "refunded", payment_status: "refunded" });
    const vo = await pool.query("select status from public.vendor_orders where id = $1", [vendorOrder.id]);
    expect(vo.rows[0].status).toBe("refunded");
  });

  it("never refunds more than was bought, counting refunds still in flight", async () => {
    const { vendorOrder, itemId } = await paidOrder();
    await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 1 }], "return");
    const tooMany = await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.request_refund($1, $2, 'return', 'again', null)", [
        vendorOrder.id,
        JSON.stringify([{ order_item_id: itemId, quantity: 2 }]),
      ]),
    );
    expect(tooMany.message).toMatch(/^Only 1 of ".+" can still be refunded\.$/);
    const other = await paidOrder();
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.request_refund($1, $2, 'return', 'wrong order', null)", [
        vendorOrder.id,
        JSON.stringify([{ order_item_id: other.itemId, quantity: 1 }]),
      ]),
    );
  });

  it("frees the amount again when a refund cannot be submitted or fails", async () => {
    const { vendorOrder, itemId } = await paidOrder();
    const first = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 2 }], "return");
    await asService(
      pool,
      (s) => s.query("select public.fail_refund($1, 'Stripe unreachable')", [first.refund_id]),
      true,
    );
    const second = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 2 }], "return");
    expect((await submitted(second.refund_id, "re_test_x", "failed")).r).toBe("failed");
    await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 2 }], "return");
  });

  it("can debit the vendor net of commission when that policy is chosen", async () => {
    await setSetting("refunds.vendor_liability", "net_of_commission");
    try {
      const { vendorId, orderId, vendorOrder, itemId } = await paidOrder();
      const refund = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 1 }], "return");
      await submitted(refund.refund_id, "re_test_net");
      expect((await vendorLedger(vendorId)).at(-1)).toEqual({ entry_type: "refund_debit", amount_minor: "-9000" });
      expect((await platformLedger(orderId)).slice(-1)).toEqual([
        { entry_type: "commission_reversed", amount_minor: "-1000" },
      ]);
    } finally {
      await setSetting("refunds.vendor_liability", "none");
    }
  });
});

describe("provider refund events", () => {
  it("matches refunds by Luxora id before the provider id is stored", async () => {
    const { vendorOrder, itemId, intent } = await paidOrder();
    const refund = await requestRefund(vendorOrder.id, [{ order_item_id: itemId, quantity: 1 }], "return");
    const apply = (status: string) =>
      asService(
        pool,
        (s) =>
          s.one<{ r: string }>("select public.apply_provider_refund('re_test_evt', $1, $2, $3, 10000, 'usd') as r", [
            refund.refund_id,
            intent,
            status,
          ]),
        true,
      );
    expect((await apply("pending")).r).toBe("pending");
    expect((await apply("succeeded")).r).toBe("completed");
    expect((await apply("succeeded")).r).toBe("duplicate");
  });

  it("records refunds made outside Luxora as platform-borne external refunds", async () => {
    const { orderId, intent } = await paidOrder();
    const result = await asService(
      pool,
      (s) =>
        s.one<{ r: string }>(
          "select public.apply_provider_refund('re_test_dash', null, $1, 'succeeded', 5000, 'usd') as r",
          [intent],
        ),
      true,
    );
    expect(result.r).toBe("completed");
    const refund = await pool.query(
      "select kind, status, amount_minor from public.refunds where provider_refund_id = 're_test_dash'",
    );
    expect(refund.rows[0]).toEqual({ kind: "external", status: "completed", amount_minor: "5000" });
    expect((await platformLedger(orderId)).at(-1)).toEqual({ entry_type: "refund_loss", amount_minor: "-5000" });
    const audit = await pool.query(
      "select action from public.audit_logs where action = 'refund.external' and metadata->>'order_id' = $1",
      [orderId],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("disputes", () => {
  it("books the disputed amount and fee as platform losses and the recovery when won", async () => {
    const { orderId, intent } = await paidOrder();
    const dispute = (status: string) =>
      asService(
        pool,
        (s) =>
          s.one<{ r: string }>(
            "select public.record_dispute('dp_test_1' || $1, $2, $3, 'fraudulent', 20700, 'usd', 1500) as r",
            [orderId.slice(0, 8), intent, status],
          ),
        true,
      );
    expect((await dispute("needs_response")).r).toBe("recorded");
    expect((await dispute("under_review")).r).toBe("recorded");
    expect((await dispute("won")).r).toBe("closed");
    expect((await dispute("won")).r).toBe("recorded");
    expect((await platformLedger(orderId)).slice(-3)).toEqual([
      { entry_type: "dispute_loss", amount_minor: "-20700" },
      { entry_type: "dispute_fee", amount_minor: "-1500" },
      { entry_type: "dispute_recovered", amount_minor: "20700" },
    ]);
  });
});

describe("payouts", () => {
  it("are recorded by admins against the available balance only, and can be reversed", async () => {
    const { vendorId, owner, vendorOrder } = await paidOrder();
    const payout = (amount: number) =>
      asUser(
        pool,
        admin,
        (s) =>
          s.one<{ id: string }>("select public.record_vendor_payout($1, $2, 'bank transfer', 'TRX-001', null) as id", [
            vendorId,
            amount,
          ]),
        true,
      );
    const notYet = await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.record_vendor_payout($1, 100, 'bank transfer', 'TRX-000')", [
        vendorId,
      ]),
    );
    expect(notYet.message).toContain("available balance");

    await pool.query("update public.vendor_orders set delivered_at = now() - interval '20 days' where id = $1", [
      vendorOrder.id,
    ]);
    const { id: payoutId } = await payout(10_000);
    const balance = () =>
      asUser(pool, owner, (s) =>
        s.one<{ available_minor: string; paid_out_minor: string }>(
          "select available_minor, paid_out_minor from public.vendor_balances where vendor_id = $1",
          [vendorId],
        ),
      );
    expect(await balance()).toEqual({ available_minor: "8700", paid_out_minor: "10000" });
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.record_vendor_payout($1, 8701, 'bank transfer', 'TRX-002')", [
        vendorId,
      ]),
    );

    await asUser(pool, admin, (s) => s.query("select public.reverse_vendor_payout($1, 'Bounced')", [payoutId]), true);
    expect(await balance()).toEqual({ available_minor: "18700", paid_out_minor: "0" });
    const status = await pool.query("select status from public.payouts where id = $1", [payoutId]);
    expect(status.rows[0].status).toBe("failed");
  });

  it("are visible to the vendor's own members only, and never writable directly", async () => {
    const { vendorId, owner } = await paidOrder();
    const outsider = (await paidOrder()).owner;
    const own = await asUser(pool, owner, (s) =>
      s.rows("select id from public.vendor_ledger_entries where vendor_id = $1", [vendorId]),
    );
    expect(own).toHaveLength(1);
    const seen = await asUser(pool, outsider, (s) =>
      s.rows("select id from public.vendor_ledger_entries where vendor_id = $1", [vendorId]),
    );
    expect(seen).toEqual([]);
    await asUser(pool, owner, (s) => s.denied("select public.record_vendor_payout($1, 1, 'x', 'y')", [vendorId]));
    await asUser(pool, owner, (s) => s.denied("select public.adjust_vendor_balance($1, 100, 'please')", [vendorId]));
    await asUser(pool, admin, (s) =>
      s.denied(
        "insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, description) values ($1, 'adjustment', 1, 'USD', 'x')",
        [vendorId],
      ),
    );
    await asUser(pool, admin, (s) =>
      s.denied(
        "insert into public.payouts (vendor_id, currency, period_start, period_end) values ($1, 'USD', now() - interval '1 day', now())",
        [vendorId],
      ),
    );
    // The platform ledger is admin-only: vendors see no rows.
    expect(await asUser(pool, owner, (s) => s.rows("select id from public.platform_ledger_entries"))).toEqual([]);
  });

  it("keeps both ledgers append-only and requires a reason for adjustments", async () => {
    const { vendorId } = await paidOrder();
    await expectSqlError(
      pool.query("update public.vendor_ledger_entries set amount_minor = 0 where vendor_id = $1", [vendorId]),
      SQLSTATE.restrictViolation,
    );
    await expectSqlError(pool.query("delete from public.platform_ledger_entries"), SQLSTATE.restrictViolation);
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.adjust_vendor_balance($1, 100, '')", [vendorId]),
    );
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.adjust_vendor_balance($1, -250, 'Packaging damage')", [vendorId]),
      true,
    );
    expect((await vendorLedger(vendorId)).at(-1)).toEqual({ entry_type: "adjustment", amount_minor: "-250" });
  });
});
