import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAddress, addToCart, inventoryOf, openCheckoutSession, placeOrder } from "./checkout-fixtures";
import {
  asAnon,
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  ensureTestShippingZone,
  SQLSTATE,
  type TestUser,
} from "./harness";

const pool = createPool();
let admin: TestUser;

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
});
afterAll(() => pool.end());

/**
 * A paid, delivered order: one vendor (owner + staff member), 2 units at 100.00
 * plus shipping 5.00 + 2.00. Delivered `deliveredDaysAgo` days ago.
 */
async function deliveredOrder(options: { deliveredDaysAgo?: number | null; quantity?: number } = {}) {
  const customer = await createUser(pool);
  const owner = await createUser(pool);
  const staff = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner, { commissionBps: 1000, freeTestShipping: false });
  await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
    vendorId,
    staff.profileId,
  ]);
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
  const { rows } = await pool.query<{ total_minor: string }>("select total_minor from public.orders where id = $1", [
    orderId,
  ]);
  await asService(
    pool,
    (s) =>
      s.query("select * from public.confirm_order_payment($1, 'stripe', $2, $3, 'USD', 600, 0, $4, false)", [
        orderId,
        `pi_test_${randomUUID().slice(0, 12)}`,
        Number(rows[0].total_minor),
        session.sessionId,
      ]),
    true,
  );
  const vo = await pool.query<{ id: string; vendor_order_number: string }>(
    "select id, vendor_order_number from public.vendor_orders where order_id = $1",
    [orderId],
  );
  const vendorOrderId = vo.rows[0].id;
  if (options.deliveredDaysAgo !== null) {
    await pool.query(
      "update public.vendor_orders set status = 'delivered', shipped_at = now() - interval '20 days', delivered_at = now() - make_interval(days => $2) where id = $1",
      [vendorOrderId, options.deliveredDaysAgo ?? 2],
    );
  }
  const item = await pool.query<{ id: string }>("select id from public.order_items where order_id = $1", [orderId]);
  return {
    customer,
    owner,
    staff,
    vendorId,
    orderId,
    vendorOrderId,
    vendorOrderNumber: vo.rows[0].vendor_order_number,
    itemId: item.rows[0].id,
    ...product,
  };
}

const request = (user: TestUser, vendorOrderId: string, items: unknown[], note: string | null = null) =>
  asUser(
    pool,
    user,
    (s) =>
      s.one<{ id: string }>("select public.create_return_request($1, $2, $3) as id", [
        vendorOrderId,
        JSON.stringify(items),
        note,
      ]),
    true,
  );

async function returnRow(id: string) {
  const { rows } = await pool.query("select * from public.return_requests where id = $1", [id]);
  return rows[0];
}

describe("requesting a return", () => {
  it("lets the customer return delivered items within the window, with an RMA number", async () => {
    const order = await deliveredOrder();
    const eligibility = await asUser(pool, order.customer, (s) =>
      s.rows<{ returnable_quantity: number; eligible: boolean }>("select * from public.return_eligibility($1)", [
        order.orderId,
      ]),
    );
    expect(eligibility).toEqual([
      expect.objectContaining({ vendor_order_id: order.vendorOrderId, returnable_quantity: 2, eligible: true }),
    ]);

    const { id } = await request(
      order.customer,
      order.vendorOrderId,
      [{ order_item_id: order.itemId, quantity: 1, reason: "Too small" }],
      "Exchange not needed",
    );
    const row = await returnRow(id);
    expect(row).toMatchObject({
      status: "requested",
      rma_number: `${order.vendorOrderNumber}-R1`,
      customer_note: "Exchange not needed",
      vendor_id: order.vendorId,
    });
    const items = await pool.query(
      "select quantity, reason from public.return_request_items where return_request_id = $1",
      [id],
    );
    expect(items.rows).toEqual([{ quantity: 1, reason: "Too small" }]);
    const left = await asUser(pool, order.customer, (s) =>
      s.one<{ returnable_quantity: number }>("select returnable_quantity from public.return_eligibility($1)", [
        order.orderId,
      ]),
    );
    expect(left.returnable_quantity).toBe(1);
    const audit = await pool.query("select action from public.audit_logs where entity_id = $1", [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(["return.requested"]);
  });

  it("refuses undelivered shipments, closed windows, unpaid orders and other customers", async () => {
    const undelivered = await deliveredOrder({ deliveredDaysAgo: null });
    const notYet = await asUser(pool, undelivered.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.create_return_request($1, $2)", [
        undelivered.vendorOrderId,
        JSON.stringify([{ order_item_id: undelivered.itemId, quantity: 1, reason: "Too small" }]),
      ]),
    );
    expect(notYet.message).toContain("once this shipment has been delivered");

    const late = await deliveredOrder({ deliveredDaysAgo: 15 });
    const closed = await asUser(pool, late.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.create_return_request($1, $2)", [
        late.vendorOrderId,
        JSON.stringify([{ order_item_id: late.itemId, quantity: 1, reason: "Too small" }]),
      ]),
    );
    expect(closed.message).toBe("The 14 day return window for this shipment has closed.");

    const order = await deliveredOrder();
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.create_return_request($1, $2)", [
        order.vendorOrderId,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 1, reason: "Not mine" }]),
      ]),
    );
    await asAnon(pool, (s) => s.denied("select public.create_return_request($1, '[]')", [order.vendorOrderId]));
    // Customers cannot write return rows directly.
    await asUser(pool, order.customer, (s) =>
      s.denied(
        "insert into public.return_requests (rma_number, order_id, vendor_order_id, customer_id, vendor_id) values ('X', $1, $2, public.current_profile_id(), $3)",
        [order.orderId, order.vendorOrderId, order.vendorId],
      ),
    );
  });

  it("never lets returns exceed what was bought, and requires a reason per item", async () => {
    const order = await deliveredOrder();
    await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 2, reason: "Wrong colour" },
    ]);
    const tooMany = await asUser(pool, order.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.create_return_request($1, $2)", [
        order.vendorOrderId,
        JSON.stringify([{ order_item_id: order.itemId, quantity: 1, reason: "Again" }]),
      ]),
    );
    expect(tooMany.message).toMatch(/^Only 0 of ".+" can be returned\.$/);

    const other = await deliveredOrder();
    const noReason = await asUser(pool, other.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.create_return_request($1, $2)", [
        other.vendorOrderId,
        JSON.stringify([{ order_item_id: other.itemId, quantity: 1, reason: "" }]),
      ]),
    );
    expect(noReason.message).toContain("Tell us why");
    const nothing = await asUser(pool, other.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.create_return_request($1, '[]')", [other.vendorOrderId]),
    );
    expect(nothing.message).toBe("Choose at least one item to return.");
  });

  it("counts units already refunded outside a return", async () => {
    const order = await deliveredOrder();
    await asUser(
      pool,
      admin,
      (s) =>
        s.query("select * from public.request_refund($1, $2, 'goodwill', 'Damaged box', null)", [
          order.vendorOrderId,
          JSON.stringify([{ order_item_id: order.itemId, quantity: 1 }]),
        ]),
      true,
    );
    const left = await asUser(pool, order.customer, (s) =>
      s.one<{ returnable_quantity: number }>("select returnable_quantity from public.return_eligibility($1)", [
        order.orderId,
      ]),
    );
    expect(left.returnable_quantity).toBe(1);
  });
});

describe("vendor and customer steps", () => {
  it("runs the full happy path: approve, ship, receive with restock", async () => {
    const order = await deliveredOrder();
    const { id } = await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 2, reason: "Changed my mind" },
    ]);

    // Staff members can see the request but not decide on it.
    const visible = await asUser(pool, order.staff, (s) =>
      s.rows("select id from public.return_requests where id = $1", [id]),
    );
    expect(visible).toHaveLength(1);
    await asUser(pool, order.staff, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.approve_return_request($1, 'Send to our studio, 1 Rue X, Paris')", [
        id,
      ]),
    );
    // Shipping before approval is refused.
    await asUser(pool, order.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.mark_return_shipped($1, 'La Poste', 'LP123456')", [id]),
    );

    await asUser(pool, order.owner, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.approve_return_request($1, 'short')", [id]),
    );
    await asUser(
      pool,
      order.owner,
      (s) => s.query("select public.approve_return_request($1, 'Send to our studio: 1 Rue X, 75001 Paris')", [id]),
      true,
    );
    expect(await returnRow(id)).toMatchObject({ status: "approved", decided_by: order.owner.profileId });

    await asUser(
      pool,
      order.customer,
      (s) =>
        s.query(
          "select public.mark_return_shipped($1, 'La Poste', 'LP123456789', 'https://track.example/LP123456789')",
          [id],
        ),
      true,
    );
    expect(await returnRow(id)).toMatchObject({
      status: "in_transit",
      carrier: "La Poste",
      tracking_number: "LP123456789",
    });

    const before = await inventoryOf(pool, order.variantId);
    await asUser(
      pool,
      order.owner,
      (s) => s.query("select public.mark_return_received($1, true, 'Unworn, tags on')", [id]),
      true,
    );
    expect(await returnRow(id)).toMatchObject({
      status: "received",
      restocked: true,
      inspection_notes: "Unworn, tags on",
    });
    expect((await inventoryOf(pool, order.variantId)).stock_quantity).toBe(before.stock_quantity + 2);
    const movement = await pool.query(
      "select m.type, m.quantity_delta, m.reference_type from public.inventory_movements m join public.inventory i on i.id = m.inventory_id where i.variant_id = $1 and m.type = 'return'",
      [order.variantId],
    );
    expect(movement.rows).toEqual([{ type: "return", quantity_delta: 2, reference_type: "return_request" }]);
  });

  it("lets the customer cancel before shipping and the vendor reject with a reason", async () => {
    const order = await deliveredOrder();
    const first = await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 1, reason: "Too big" },
    ]);
    await asUser(pool, order.customer, (s) => s.query("select public.cancel_return_request($1)", [first.id]), true);
    expect((await returnRow(first.id)).status).toBe("cancelled");
    // Cancelled requests free their units again.
    const second = await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 2, reason: "Too big" },
    ]);
    expect((await returnRow(second.id)).rma_number).toBe(`${order.vendorOrderNumber}-R2`);

    await asUser(pool, order.owner, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.reject_return_request($1, '')", [second.id]),
    );
    await asUser(
      pool,
      order.owner,
      (s) => s.query("select public.reject_return_request($1, 'Final sale item')", [second.id]),
      true,
    );
    expect(await returnRow(second.id)).toMatchObject({ status: "rejected", rejection_reason: "Final sale item" });
    await asUser(pool, order.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.cancel_return_request($1)", [second.id]),
    );
  });

  it("hides returns from other vendors and customers", async () => {
    const order = await deliveredOrder();
    const { id } = await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 1, reason: "Too big" },
    ]);
    const otherVendor = await deliveredOrder();
    for (const user of [otherVendor.owner, otherVendor.customer]) {
      expect(
        await asUser(pool, user, (s) => s.rows("select id from public.return_requests where id = $1", [id])),
      ).toEqual([]);
      expect(
        await asUser(pool, user, (s) =>
          s.rows("select id from public.return_request_items where return_request_id = $1", [id]),
        ),
      ).toEqual([]);
      await asUser(pool, user, (s) =>
        s.fails(SQLSTATE.noDataFound, "select public.approve_return_request($1, 'Send it to me please, thanks')", [id]),
      );
    }
    expect(
      await asUser(pool, admin, (s) => s.rows("select id from public.return_requests where id = $1", [id])),
    ).toHaveLength(1);
  });
});

describe("refunding a return", () => {
  async function receivedReturn() {
    const order = await deliveredOrder();
    const { id } = await request(order.customer, order.vendorOrderId, [
      { order_item_id: order.itemId, quantity: 1, reason: "Faulty zip" },
    ]);
    await asUser(
      pool,
      order.owner,
      (s) => s.query("select public.approve_return_request($1, 'Send to our studio: 1 Rue X')", [id]),
      true,
    );
    await asUser(pool, order.owner, (s) => s.query("select public.mark_return_received($1, false)", [id]), true);
    return { ...order, returnId: id };
  }

  it("is admin-only and only once received; the refund follows the return policy and links back", async () => {
    const order = await receivedReturn();
    await asUser(pool, order.owner, (s) =>
      s.denied("select * from public.request_return_refund($1)", [order.returnId]),
    );
    await asUser(pool, order.customer, (s) =>
      s.denied("select * from public.request_return_refund($1)", [order.returnId]),
    );

    const refund = await asUser(
      pool,
      admin,
      (s) =>
        s.one<{ refund_id: string; amount_minor: string }>("select * from public.request_return_refund($1)", [
          order.returnId,
        ]),
      true,
    );
    // Partial return: 1 × 100.00, shipping not refunded under the default policy.
    expect(refund.amount_minor).toBe("10000");
    expect(await returnRow(order.returnId)).toMatchObject({ status: "completed", refund_id: refund.refund_id });
    const linked = await pool.query("select kind, return_request_id, status from public.refunds where id = $1", [
      refund.refund_id,
    ]);
    expect(linked.rows[0]).toEqual({ kind: "return", return_request_id: order.returnId, status: "processing" });

    await asService(
      pool,
      (s) => s.query("select public.mark_refund_submitted($1, 're_test_return', 'succeeded')", [refund.refund_id]),
      true,
    );
    const qty = await pool.query("select refunded_quantity from public.order_items where id = $1", [order.itemId]);
    expect(qty.rows[0].refunded_quantity).toBe(1);
    // The returned unit is not returnable twice.
    const left = await asUser(pool, order.customer, (s) =>
      s.one<{ returnable_quantity: number }>("select returnable_quantity from public.return_eligibility($1)", [
        order.orderId,
      ]),
    );
    expect(left.returnable_quantity).toBe(1);
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.request_return_refund($1)", [order.returnId]),
    );
  });

  it("reopens the return when the provider refund fails, so it can be retried", async () => {
    const order = await receivedReturn();
    const refund = await asUser(
      pool,
      admin,
      (s) => s.one<{ refund_id: string }>("select refund_id from public.request_return_refund($1)", [order.returnId]),
      true,
    );
    await asService(
      pool,
      (s) => s.query("select public.fail_refund($1, 'Stripe unreachable')", [refund.refund_id]),
      true,
    );
    expect(await returnRow(order.returnId)).toMatchObject({ status: "received", refund_id: null });
    const retry = await asUser(
      pool,
      admin,
      (s) => s.one<{ refund_id: string }>("select refund_id from public.request_return_refund($1)", [order.returnId]),
      true,
    );
    expect(retry.refund_id).not.toBe(refund.refund_id);
  });

  it("lets an admin close a received return without a refund", async () => {
    const order = await receivedReturn();
    await asUser(pool, order.owner, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.reject_return_request($1, 'Item was worn')", [order.returnId]),
    );
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.reject_return_request($1, 'Item was worn')", [order.returnId]),
      true,
    );
    expect(await returnRow(order.returnId)).toMatchObject({ status: "rejected", rejection_reason: "Item was worn" });
  });
});
