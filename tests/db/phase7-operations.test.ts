import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAddress, addToCart, openCheckoutSession, placeOrder } from "./checkout-fixtures";
import {
  asAnon,
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  SQLSTATE,
  type TestUser,
} from "./harness";

const pool = createPool();
let admin: TestUser;

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
});
afterAll(() => pool.end());

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
async function vendor(commissionBps: number | null = 1000) {
  const owner = await createUser(pool);
  const staff = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner, { commissionBps });
  await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
    vendorId,
    staff.profileId,
  ]);
  return { owner, staff, vendorId };
}

async function shopper(fullName = "Test Customer") {
  const customer = await createUser(pool, { fullName });
  const addressId = await addAddress(pool, customer);
  return { customer, addressId };
}

async function pay(customer: TestUser, orderId: string) {
  const session = await openCheckoutSession(pool, customer, orderId);
  const { rows } = await pool.query<{ total_minor: string }>("select total_minor from public.orders where id = $1", [
    orderId,
  ]);
  await asService(
    pool,
    (s) =>
      s.query("select * from public.confirm_order_payment($1, 'stripe', $2, $3, 'USD', 0, 0, $4, false)", [
        orderId,
        `pi_test_${randomUUID().slice(0, 12)}`,
        Number(rows[0].total_minor),
        session.sessionId,
      ]),
    true,
  );
}

/** Places (and by default pays) an order of `lines` for a shopper. */
async function order(
  who: { customer: TestUser; addressId: string },
  lines: { variantId: string; quantity: number }[],
  options: { pay?: boolean; code?: string } = {},
) {
  for (const line of lines) await addToCart(pool, who.customer, line.variantId, line.quantity);
  if (options.code) {
    const applied = await asUser(
      pool,
      who.customer,
      (s) => s.one<{ applied: boolean }>("select applied from public.apply_cart_coupon($1)", [options.code]),
      true,
    );
    expect(applied.applied).toBe(true);
  }
  const orderId = await placeOrder(pool, who.customer, who.addressId);
  if (options.pay ?? true) await pay(who.customer, orderId);
  return orderId;
}

async function platformCoupon(percentBps: number) {
  const code = `P7${randomUUID().slice(0, 8).toUpperCase()}`;
  await asUser(
    pool,
    admin,
    (s) =>
      s.query(
        "select public.save_coupon(null, null, $1, 'Report test', null, 'percentage', $2, 0, null, null, null, null, null)",
        [code, percentBps],
      ),
    true,
  );
  return code;
}

async function vendorCoupon(owner: TestUser, vendorId: string, percentBps: number) {
  const code = `V7${randomUUID().slice(0, 8).toUpperCase()}`;
  await asUser(
    pool,
    owner,
    (s) =>
      s.query(
        "select public.save_coupon(null, $1, $2, 'Vendor test', null, 'percentage', $3, 0, null, null, null, null, null)",
        [vendorId, code, percentBps],
      ),
    true,
  );
  return code;
}

const vendorOrderOf = async (orderId: string, vendorId: string) =>
  (
    await pool.query<{ id: string; total_minor: string; platform_funded_minor: string; commission_minor: string }>(
      "select id, total_minor, platform_funded_minor, commission_minor from public.vendor_orders where order_id = $1 and vendor_id = $2",
      [orderId, vendorId],
    )
  ).rows[0];

const itemOf = async (orderId: string, variantId: string) =>
  (
    await pool.query<{ id: string; commission_rate_bps: number; commission_minor: string }>(
      "select id, commission_rate_bps, commission_minor from public.order_items where order_id = $1 and variant_id = $2",
      [orderId, variantId],
    )
  ).rows[0];

async function refund(vendorOrderId: string, itemId: string, quantity: number, includeShipping: boolean | null = null) {
  const row = await asUser(
    pool,
    admin,
    (s) =>
      s.one<{ refund_id: string; amount_minor: string }>(
        "select * from public.request_refund($1, $2, 'return', 'Report test', $3)",
        [vendorOrderId, JSON.stringify([{ order_item_id: itemId, quantity }]), includeShipping],
      ),
    true,
  );
  await asService(
    pool,
    (s) =>
      s.query("select public.mark_refund_submitted($1, $2, 'succeeded')", [
        row.refund_id,
        `re_test_${randomUUID().slice(0, 10)}`,
      ]),
    true,
  );
  return { refundId: row.refund_id, amount: Number(row.amount_minor) };
}

/** Moves an order's payment date (and its refunds' completion) into a fixed UTC window, isolating it from other suites. */
async function backdate(orderId: string, paidAt: string, refundedAt?: string) {
  await pool.query("update public.orders set confirmed_at = $2 where id = $1", [orderId, paidAt]);
  if (refundedAt) {
    await pool.query("update public.refunds set processed_at = $2 where order_id = $1 and status = 'completed'", [
      orderId,
      refundedAt,
    ]);
  }
}

const today = () => new Date().toISOString().slice(0, 10);

// -----------------------------------------------------------------------------
describe("commission rules", () => {
  it("are written only through the audited admin functions", async () => {
    const v = await vendor();
    const customer = await createUser(pool);
    const save = (user: TestUser) =>
      asUser(pool, user, (s) =>
        s.denied("select public.save_commission_rule(null, 'vendor', $1, null, 900, 'Partner rate', null, null)", [
          v.vendorId,
        ]),
      );
    await save(v.owner);
    await save(customer);
    await asUser(pool, admin, async (s) => {
      await s.denied("insert into public.commission_rules (scope, rate_bps, name) values ('global', 100, 'Direct')");
      await s.denied("update public.commission_rules set rate_bps = 1");
      await s.denied("delete from public.commission_rules");
    });

    const rule = await asUser(
      pool,
      admin,
      (s) =>
        s.one<{ id: string }>(
          "select public.save_commission_rule(null, 'vendor', $1, null, 900, 'Partner rate', null, null) as id",
          [v.vendorId],
        ),
      true,
    );
    const audit = await pool.query<{ action: string; metadata: { rate_bps: number } }>(
      "select action, metadata from public.audit_logs where entity_type = 'commission_rule' and entity_id = $1",
      [rule.id],
    );
    expect(audit.rows).toEqual([
      { action: "commission.rule_created", metadata: expect.objectContaining({ rate_bps: 900 }) },
    ]);
    // Vendors still read their own rule (Phase 1 policy); other vendors do not.
    expect(
      await asUser(pool, v.owner, (s) => s.rows("select id from public.commission_rules where id = $1", [rule.id])),
    ).toHaveLength(1);
    const other = await vendor();
    expect(
      await asUser(pool, other.owner, (s) => s.rows("select id from public.commission_rules where id = $1", [rule.id])),
    ).toEqual([]);
  });

  it("validates targets, rates and dates", async () => {
    const v = await vendor();
    const fails = (sql: string, values: unknown[], message: string) =>
      asUser(pool, admin, async (s) => {
        const error = await s.fails(SQLSTATE.raiseException, sql, values);
        expect(error.message).toBe(message);
      });
    await fails(
      "select public.save_commission_rule(null, 'global', $1, null, 900, 'Bad', null, null)",
      [v.vendorId],
      "A global rule has no vendor or category.",
    );
    await fails(
      "select public.save_commission_rule(null, 'vendor', null, null, 900, 'Bad', null, null)",
      [],
      "Choose the vendor this rule applies to.",
    );
    await fails(
      "select public.save_commission_rule(null, 'vendor', $1, null, 10001, 'Bad', null, null)",
      [v.vendorId],
      "Enter a rate between 0% and 100%.",
    );
    await fails(
      "select public.save_commission_rule(null, 'vendor', $1, null, 900, 'Bad', '2027-01-02', '2027-01-01')",
      [v.vendorId],
      "The end must be after the start.",
    );
  });

  it("refuses overlapping active rules for the same target", async () => {
    const v = await vendor();
    const save = (starts: string, ends: string | null) =>
      asUser(
        pool,
        admin,
        (s) =>
          s.one<{ id: string }>(
            "select public.save_commission_rule(null, 'vendor', $1, null, 900, 'Window', $2, $3) as id",
            [v.vendorId, starts, ends],
          ),
        true,
      );
    const first = await save("2030-01-01T00:00:00Z", "2030-02-01T00:00:00Z");
    await expect(save("2030-01-15T00:00:00Z", null)).rejects.toThrow(/overlaps these dates/);
    // Back-to-back windows do not overlap ([start, end)).
    const next = await save("2030-02-01T00:00:00Z", null);
    // A different target is independent.
    const w = await vendor();
    await asUser(
      pool,
      admin,
      (s) =>
        s.query("select public.save_commission_rule(null, 'vendor', $1, null, 700, 'Other', '2030-01-10', null)", [
          w.vendorId,
        ]),
      true,
    );
    // Deactivated rules do not block; re-activating an overlapping one is refused.
    await asUser(pool, admin, (s) => s.query("select public.set_commission_rule_active($1, false)", [first.id]), true);
    const replacement = await save("2030-01-05T00:00:00Z", "2030-02-01T00:00:00Z");
    await asUser(pool, admin, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.set_commission_rule_active($1, true)", [
        first.id,
      ]);
      expect(error.message).toMatch(/overlaps these dates/);
      // Editing a rule into an overlap is refused too, and targets never change.
      await s.fails(
        SQLSTATE.raiseException,
        "select public.save_commission_rule($1, 'vendor', $2, null, 900, 'Window', '2030-01-20', null)",
        [replacement.id, v.vendorId],
      );
      const moved = await s.fails(
        SQLSTATE.raiseException,
        "select public.save_commission_rule($1, 'vendor', $2, null, 900, 'Window', '2031-01-01', null)",
        [next.id, w.vendorId],
      );
      expect(moved.message).toMatch(/target cannot change/);
    });
    const actions = await pool.query<{ action: string }>(
      "select action from public.audit_logs where entity_type = 'commission_rule' and entity_id = $1 order by id",
      [first.id],
    );
    expect(actions.rows.map((r) => r.action)).toEqual(["commission.rule_created", "commission.rule_deactivated"]);
  });

  it("previews the same rate and precedence as the resolver used at checkout", async () => {
    const v = await vendor(null);
    const parent = await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, commission_rate_bps) values ($1, 'P7 parent', 1200) returning id",
      [`p7-parent-${randomUUID().slice(0, 6)}`],
    );
    const child = await pool.query<{ id: string }>(
      "insert into public.categories (parent_id, slug, name) values ($1, $2, 'P7 child') returning id",
      [parent.rows[0].id, `p7-child-${randomUUID().slice(0, 6)}`],
    );
    const parentId = parent.rows[0].id;
    const childId = child.rows[0].id;
    const check = async (categoryId: string | null, expected: { rate_bps: number; source: string }) => {
      const explained = await asUser(pool, admin, (s) =>
        s.one<{ rate_bps: number; source: string }>(
          "select rate_bps, source from public.explain_commission_rate($1, $2)",
          [v.vendorId, categoryId],
        ),
      );
      const resolved = await pool.query<{ bps: number }>("select public.resolve_commission_rate_bps($1, $2) as bps", [
        v.vendorId,
        categoryId,
      ]);
      expect(explained).toEqual(expected);
      expect(resolved.rows[0].bps).toBe(expected.rate_bps);
    };
    const rule = (scope: string, vendorId: string | null, categoryId: string | null, bps: number) =>
      asUser(
        pool,
        admin,
        (s) =>
          s.one<{ id: string }>(
            "select public.save_commission_rule(null, $1, $2, $3, $4, 'Precedence', null, null) as id",
            [scope, vendorId, categoryId, bps],
          ),
        true,
      );

    await check(null, { rate_bps: 1500, source: "platform_default" });
    const global = await rule("global", null, null, 1800);
    try {
      await check(null, { rate_bps: 1800, source: "global_rule" });
      await check(childId, { rate_bps: 1200, source: "category_rate" }); // parent's own rate, walking up
      await rule("category", null, parentId, 1300);
      await check(childId, { rate_bps: 1300, source: "category_rule" }); // a rule beats the rate at the same level
      await rule("category", null, childId, 1100);
      await check(childId, { rate_bps: 1100, source: "category_rule" }); // nearest category first
      await pool.query("update public.vendors set commission_rate_bps = 1000 where id = $1", [v.vendorId]);
      await check(childId, { rate_bps: 1000, source: "vendor_override" });
      await rule("vendor", v.vendorId, null, 800);
      await check(childId, { rate_bps: 800, source: "vendor_rule" });
    } finally {
      // Global rules affect every suite's default commission: remove it (as the owner).
      await pool.query("delete from public.commission_rules where id = $1", [global.id]);
    }
  });

  it("keeps the commission rate snapshot of orders already placed", async () => {
    const v = await vendor(1000);
    const product = await createActiveProduct(pool, v.vendorId, { priceMinor: 10_000, stock: 10 });
    const first = await order(await shopper(), [{ variantId: product.variantId, quantity: 1 }]);
    expect(await itemOf(first, product.variantId)).toMatchObject({
      commission_rate_bps: 1000,
      commission_minor: "1000",
    });

    await asUser(
      pool,
      admin,
      (s) =>
        s.query("select public.save_commission_rule(null, 'vendor', $1, null, 500, 'Lower rate', null, null)", [
          v.vendorId,
        ]),
      true,
    );
    const second = await order(await shopper(), [{ variantId: product.variantId, quantity: 1 }]);
    expect(await itemOf(second, product.variantId)).toMatchObject({
      commission_rate_bps: 500,
      commission_minor: "500",
    });
    expect(await itemOf(first, product.variantId)).toMatchObject({
      commission_rate_bps: 1000,
      commission_minor: "1000",
    });
    const vo = await vendorOrderOf(first, v.vendorId);
    expect(vo.commission_minor).toBe("1000");
  });
});

describe("customer account status", () => {
  it("lets admins suspend and reactivate customers with a reason, audited", async () => {
    const { customer } = await shopper();
    const v = await vendor();
    await asUser(pool, v.owner, (s) =>
      s.denied("select public.set_account_status($1, 'suspended', 'Fraud')", [customer.profileId]),
    );
    await asUser(pool, admin, async (s) => {
      const noReason = await s.fails(
        SQLSTATE.raiseException,
        "select public.set_account_status($1, 'suspended', ' ')",
        [customer.profileId],
      );
      expect(noReason.message).toBe("Give a reason (3–500 characters).");
      const vendorAccount = await s.fails(
        SQLSTATE.raiseException,
        "select public.set_account_status($1, 'suspended', 'Not allowed')",
        [v.owner.profileId],
      );
      expect(vendorAccount.message).toBe("Only customer accounts can be suspended here.");
      await s.fails(SQLSTATE.raiseException, "select public.set_account_status($1, 'suspended', 'Admin')", [
        admin.profileId,
      ]);
      await s.fails(SQLSTATE.raiseException, "select public.set_account_status($1, 'deactivated', 'Closed')", [
        customer.profileId,
      ]);
    });

    await asUser(
      pool,
      admin,
      (s) => s.query("select public.set_account_status($1, 'suspended', 'Chargeback abuse')", [customer.profileId]),
      true,
    );
    await asUser(pool, admin, async (s) => {
      const again = await s.fails(
        SQLSTATE.raiseException,
        "select public.set_account_status($1, 'suspended', 'Again')",
        [customer.profileId],
      );
      expect(again.message).toBe("This account is already suspended.");
    });
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.set_account_status($1, 'active', 'Resolved with the bank')", [customer.profileId]),
      true,
    );

    const audit = await pool.query<{ action: string; metadata: { reason: string; to: string } }>(
      "select action, metadata from public.audit_logs where entity_type = 'profile' and entity_id = $1 order by id",
      [customer.profileId],
    );
    expect(audit.rows).toEqual([
      {
        action: "account.suspended",
        metadata: expect.objectContaining({ reason: "Chargeback abuse", to: "suspended" }),
      },
      {
        action: "account.reactivated",
        metadata: expect.objectContaining({ reason: "Resolved with the bank", to: "active" }),
      },
    ]);
  });

  it("blocks new orders, returns, reviews and codes for a suspended customer without touching existing records", async () => {
    const v = await vendor();
    const product = await createActiveProduct(pool, v.vendorId, { priceMinor: 5000, stock: 20 });
    const buyer = await shopper();
    const paidOrder = await order(buyer, [{ variantId: product.variantId, quantity: 2 }]);
    const vo = await vendorOrderOf(paidOrder, v.vendorId);
    await pool.query(
      "update public.vendor_orders set status = 'delivered', shipped_at = now() - interval '2 days', delivered_at = now() - interval '1 day' where id = $1",
      [vo.id],
    );
    const item = await itemOf(paidOrder, product.variantId);

    await asUser(
      pool,
      admin,
      (s) => s.query("select public.set_account_status($1, 'suspended', 'Under review')", [buyer.customer.profileId]),
      true,
    );
    await asUser(pool, buyer.customer, async (s) => {
      await s.denied("select public.add_to_cart($1, 1)", [product.variantId]);
      await s.denied("select public.place_order($1, $1, $2)", [buyer.addressId, randomUUID()]);
      await s.denied("select public.create_return_request($1, $2)", [
        vo.id,
        JSON.stringify([{ order_item_id: item.id, quantity: 1, reason: "Too small" }]),
      ]);
      await s.denied("select public.submit_review($1, 5, null, 'Lovely quality overall')", [item.id]);
      await s.denied("select * from public.apply_cart_coupon('ANYCODE')");
    });

    // Existing order untouched, and refunds still go through.
    const status = await pool.query("select status, payment_status from public.orders where id = $1", [paidOrder]);
    expect(status.rows[0]).toEqual({ status: "confirmed", payment_status: "paid" });
    const done = await refund(vo.id, item.id, 1);
    expect(done.amount).toBe(5000);

    await asUser(
      pool,
      admin,
      (s) => s.query("select public.set_account_status($1, 'active', 'Review complete')", [buyer.customer.profileId]),
      true,
    );
    await addToCart(pool, buyer.customer, product.variantId, 1);
  });

  it("still allows the Phase 1 direct admin status edit, and now audits it", async () => {
    const { customer } = await shopper();
    await asUser(
      pool,
      admin,
      (s) => s.query("update public.profiles set status = 'suspended' where id = $1", [customer.profileId]),
      true,
    );
    const audit = await pool.query<{ action: string; actor_id: string; metadata: { via: string } }>(
      "select action, actor_id, metadata from public.audit_logs where entity_type = 'profile' and entity_id = $1",
      [customer.profileId],
    );
    expect(audit.rows).toEqual([
      {
        action: "account.status_changed",
        actor_id: admin.profileId,
        metadata: expect.objectContaining({ via: "direct_update" }),
      },
    ]);
  });
});

describe("report access", () => {
  it("limits platform reports to admins and vendor reports to that vendor's team", async () => {
    const a = await vendor();
    const b = await vendor();
    const { customer } = await shopper();
    const day = today();
    await asUser(pool, customer, (s) => s.denied("select * from public.admin_sales_summary($1, $1)", [day]));
    await asUser(pool, a.owner, async (s) => {
      await s.denied("select * from public.admin_sales_summary($1, $1)", [day]);
      await s.denied("select * from public.admin_customers()");
      await s.denied("select * from public.vendor_sales_summary($1, $2, $2)", [b.vendorId, day]);
      await s.denied("select * from public.vendor_customers($1)", [b.vendorId]);
      await s.query("select * from public.vendor_sales_summary($1, $2, $2)", [a.vendorId, day]);
    });
    await asUser(pool, a.staff, (s) => s.query("select * from public.vendor_customers($1)", [a.vendorId]));
    await asUser(pool, admin, (s) =>
      s.query("select * from public.vendor_sales_summary($1, $2, $2)", [b.vendorId, day]),
    );
    await asAnon(pool, (s) => s.denied("select * from public.admin_sales_summary($1, $1)", [day]));
    await asUser(pool, admin, async (s) => {
      const tooLong = await s.fails(
        SQLSTATE.raiseException,
        "select * from public.admin_sales_summary('2026-01-01', '2027-01-02')",
      );
      expect(tooLong.message).toBe("Reports cover at most 366 days.");
      await s.query("select * from public.admin_sales_summary('2026-01-01', '2027-01-01')");
      const backwards = await s.fails(
        SQLSTATE.raiseException,
        "select * from public.admin_sales_daily('2026-02-01', '2026-01-01')",
      );
      expect(backwards.message).toBe("Choose a valid date range.");
      // The internal view of paid orders is not readable directly.
      await s.denied("select * from public.report_paid_orders");
    });
  });
});

describe("admin sales reporting", () => {
  // A fixed UTC window no other suite uses: the backdated orders below are the only data in it.
  const FROM = "2024-03-01";
  const TO = "2024-03-07";

  it("counts paid orders only and nets completed refunds, discounts and funding exactly", async () => {
    const a = await vendor(1000);
    const b = await vendor(2000);
    const pa = await createActiveProduct(pool, a.vendorId, { priceMinor: 5000, stock: 50 });
    const pb = await createActiveProduct(pool, b.vendorId, { priceMinor: 3000, stock: 50 });
    const code = await platformCoupon(1000); // Luxora-funded 10%
    const vendorCode = await vendorCoupon(b.owner, b.vendorId, 2000); // vendor-funded 20%

    // 1. Plain paid order: 2 × 50.00 + 1 × 30.00 = 130.00 (free test shipping).
    const first = await shopper();
    const o1 = await order(first, [
      { variantId: pa.variantId, quantity: 2 },
      { variantId: pb.variantId, quantity: 1 },
    ]);
    // 2. Paid with a Luxora code: 50.00 − 5.00 = 45.00.
    const second = await shopper();
    const o2 = await order(second, [{ variantId: pa.variantId, quantity: 1 }], { code });
    // 3. Paid with B's code: 30.00 − 6.00 = 24.00.
    const third = await shopper();
    const o3 = await order(third, [{ variantId: pb.variantId, quantity: 1 }], { code: vendorCode });
    // 4. Never paid (excluded), 5. expired (excluded).
    const unpaid = await order(await shopper(), [{ variantId: pa.variantId, quantity: 1 }], { pay: false });
    const expired = await order(await shopper(), [{ variantId: pa.variantId, quantity: 1 }], { pay: false });
    await pool.query("update public.orders set reservation_expires_at = now() - interval '1 minute' where id = $1", [
      expired,
    ]);
    await asService(pool, (s) => s.query("select public.expire_stale_checkouts()"), true);

    // Partial refund of o1 (one unit of A = 50.00) and full refund of o2 (45.00).
    const voA1 = await vendorOrderOf(o1, a.vendorId);
    const r1 = await refund(voA1.id, (await itemOf(o1, pa.variantId)).id, 1);
    const voA2 = await vendorOrderOf(o2, a.vendorId);
    const r2 = await refund(voA2.id, (await itemOf(o2, pa.variantId)).id, 1);
    expect([r1.amount, r2.amount]).toEqual([5000, 4500]);

    await backdate(o1, "2024-03-02T10:00:00Z", "2024-03-05T09:00:00Z");
    await backdate(o2, "2024-03-02T23:59:59Z", "2024-03-06T12:00:00Z");
    await backdate(o3, "2024-03-04T00:00:00Z");
    for (const id of [unpaid, expired])
      await pool.query("update public.orders set placed_at = '2024-03-03T10:00:00Z' where id = $1", [id]);

    const summary = await asUser(pool, admin, (s) =>
      s.one<Record<string, string | number>>("select * from public.admin_sales_summary($1, $2)", [FROM, TO]),
    );
    expect(summary).toMatchObject({
      gross_sales_minor: "19900", // 130.00 + 45.00 + 24.00
      refunds_minor: "9500",
      net_sales_minor: "10400",
      paid_orders: 3,
      units: "5",
      average_order_value_minor: "6633", // 199.00 / 3, half-up
      new_customers: 3,
    });

    const daily = await asUser(pool, admin, (s) =>
      s.rows<{ day: Date; gross_sales_minor: string; refunds_minor: string; paid_orders: number }>(
        "select * from public.admin_sales_daily($1, $2)",
        [FROM, TO],
      ),
    );
    expect(daily).toHaveLength(7); // zero-filled, UTC days
    const byDay = Object.fromEntries(
      daily.map((d) => [
        d.day.toISOString().slice(0, 10),
        [Number(d.gross_sales_minor), Number(d.refunds_minor), d.paid_orders],
      ]),
    );
    expect(byDay["2024-03-02"]).toEqual([17500, 0, 2]); // 23:59:59 UTC stays on the 2nd
    expect(byDay["2024-03-04"]).toEqual([2400, 0, 1]);
    expect(byDay["2024-03-05"]).toEqual([0, 5000, 0]);
    expect(byDay["2024-03-06"]).toEqual([0, 4500, 0]);
    expect(byDay["2024-03-01"]).toEqual([0, 0, 0]);

    const discounts = await asUser(pool, admin, (s) =>
      s.one("select * from public.admin_discount_usage($1, $2)", [FROM, TO]),
    );
    expect(discounts).toEqual({
      orders_with_code: 2,
      luxora_funded_minor: "500",
      vendor_code_minor: "600",
      flash_sale_savings_minor: "0",
    });

    const vendors = await asUser(pool, admin, (s) =>
      s.rows<{ vendor_id: string; paid_orders: number; sales_minor: string; commission_minor: string }>(
        "select vendor_id, paid_orders, sales_minor, commission_minor from public.admin_top_vendors($1, $2)",
        [FROM, TO],
      ),
    );
    expect(vendors).toEqual([
      { vendor_id: a.vendorId, paid_orders: 2, sales_minor: "14500", commission_minor: "1500" }, // 100 + 45; 10% of 100 + 50
      { vendor_id: b.vendorId, paid_orders: 2, sales_minor: "5400", commission_minor: "1080" }, // 30 + 24; 20% of 30 + 24
    ]);
    const products = await asUser(pool, admin, (s) =>
      s.rows<{ product_id: string; units: string; sales_minor: string }>(
        "select product_id, units, sales_minor from public.admin_top_products($1, $2)",
        [FROM, TO],
      ),
    );
    expect(products).toEqual([
      { product_id: pa.productId, units: "3", sales_minor: "14500" },
      { product_id: pb.productId, units: "2", sales_minor: "5400" },
    ]);

    // The previous, equal-length period is empty.
    const previous = await asUser(pool, admin, (s) =>
      s.one<{ gross_sales_minor: string; paid_orders: number }>(
        "select gross_sales_minor, paid_orders from public.admin_sales_summary('2024-02-23', '2024-02-29')",
      ),
    );
    expect(previous).toEqual({ gross_sales_minor: "0", paid_orders: 0 });
  });

  it("counts returned units and new customers by their first paid order", async () => {
    const v = await vendor();
    const p = await createActiveProduct(pool, v.vendorId, { priceMinor: 4000, stock: 50 });
    const repeat = await shopper();
    const earlier = await order(repeat, [{ variantId: p.variantId, quantity: 1 }]);
    await backdate(earlier, "2024-04-01T08:00:00Z"); // before the window: not new in it
    const later = await order(repeat, [{ variantId: p.variantId, quantity: 3 }]);
    await backdate(later, "2024-04-12T08:00:00Z");
    const vo = await vendorOrderOf(later, v.vendorId);
    await pool.query(
      "update public.vendor_orders set status = 'delivered', shipped_at = now() - interval '2 days', delivered_at = now() - interval '1 day' where id = $1",
      [vo.id],
    );
    const laterItem = await itemOf(later, p.variantId);
    const ret = await asUser(
      pool,
      repeat.customer,
      (s) =>
        s.one<{ id: string }>("select public.create_return_request($1, $2) as id", [
          vo.id,
          JSON.stringify([{ order_item_id: laterItem.id, quantity: 2, reason: "Too big" }]),
        ]),
      true,
    );
    await pool.query("update public.return_requests set requested_at = '2024-04-13T10:00:00Z' where id = $1", [ret.id]);

    const summary = await asUser(pool, admin, (s) =>
      s.one<{ units: string; returned_units: string; new_customers: number; paid_orders: number }>(
        "select units, returned_units, new_customers, paid_orders from public.admin_sales_summary('2024-04-10', '2024-04-16')",
      ),
    );
    expect(summary).toEqual({ units: "3", returned_units: "2", new_customers: 0, paid_orders: 1 });
  });

  it("reports Luxora's revenue exactly as the platform ledger records it", async () => {
    const day = today();
    const ledgerSum = async () =>
      Number(
        (
          await pool.query<{ total: string }>(
            "select coalesce(sum(amount_minor), 0) as total from public.platform_ledger_entries where created_at >= $1::date and created_at < $1::date + 1",
            [day],
          )
        ).rows[0].total,
      );
    const revenue = async () =>
      Number(
        (
          await asUser(pool, admin, (s) =>
            s.one<{ luxora_net_revenue_minor: string }>(
              "select luxora_net_revenue_minor from public.admin_sales_summary($1, $1)",
              [day],
            ),
          )
        ).luxora_net_revenue_minor,
      );
    const before = await revenue();
    expect(before).toBe(await ledgerSum());

    const v = await vendor(1000);
    const p = await createActiveProduct(pool, v.vendorId, { priceMinor: 10_000, stock: 10 });
    const code = await platformCoupon(1000);
    const o = await order(await shopper(), [{ variantId: p.variantId, quantity: 1 }], { code });
    // + commission 10.00 − Luxora-funded discount 10.00 = 0; then a refund of 90.00 borne by Luxora.
    expect((await revenue()) - before).toBe(0);
    await refund((await vendorOrderOf(o, v.vendorId)).id, (await itemOf(o, p.variantId)).id, 1);
    expect((await revenue()) - before).toBe(-9000);
    expect(await revenue()).toBe(await ledgerSum());

    const breakdown = await asUser(pool, admin, (s) =>
      s.rows<{ amount_minor: string }>("select amount_minor from public.admin_revenue_breakdown($1, $1)", [day]),
    );
    expect(breakdown.reduce((sum, row) => sum + Number(row.amount_minor), 0)).toBe(await revenue());
  });
});

describe("vendor reporting", () => {
  it("reports the vendor's own sales before Luxora-funded discounts, and nothing of other vendors", async () => {
    const a = await vendor(1000);
    const b = await vendor(1000);
    const pa = await createActiveProduct(pool, a.vendorId, { priceMinor: 10_000, stock: 50 });
    const pb = await createActiveProduct(pool, b.vendorId, { priceMinor: 7000, stock: 50 });
    const code = await platformCoupon(1000);
    const shared = await shopper("Jane Doe");
    // One order with both vendors and a Luxora code.
    const o = await order(
      shared,
      [
        { variantId: pa.variantId, quantity: 1 },
        { variantId: pb.variantId, quantity: 1 },
      ],
      { code },
    );
    const voA = await vendorOrderOf(o, a.vendorId);
    expect(voA).toMatchObject({ total_minor: "9000", platform_funded_minor: "1000", commission_minor: "1000" });
    await refund(voA.id, (await itemOf(o, pa.variantId)).id, 1);

    const day = today();
    const summary = await asUser(pool, a.staff, (s) =>
      s.one<Record<string, string | number>>("select * from public.vendor_sales_summary($1, $2, $2)", [
        a.vendorId,
        day,
      ]),
    );
    expect(summary).toMatchObject({
      sales_minor: "10000", // what A sold; Luxora pays the 10.00 discount
      customer_paid_minor: "9000",
      paid_orders: 1,
      units: "1",
      commission_minor: "1000",
      earnings_minor: "9000", // the order earning; Luxora bears the refund under the current policy
      refunds_minor: "9000",
    });
    const daily = await asUser(pool, a.owner, (s) =>
      s.rows<{ sales_minor: string; paid_orders: number }>(
        "select sales_minor, paid_orders from public.vendor_sales_daily($1, $2, $2)",
        [a.vendorId, day],
      ),
    );
    expect(daily).toEqual([{ sales_minor: "10000", paid_orders: 1 }]);
    const top = await asUser(pool, a.owner, (s) =>
      s.rows("select product_id, units, sales_minor from public.vendor_top_products($1, $2, $2)", [a.vendorId, day]),
    );
    expect(top).toEqual([{ product_id: pa.productId, units: "1", sales_minor: "10000" }]);

    // B's figures stay separate.
    const bSummary = await asUser(pool, b.owner, (s) =>
      s.one<{ sales_minor: string; refunds_minor: string }>(
        "select sales_minor, refunds_minor from public.vendor_sales_summary($1, $2, $2)",
        [b.vendorId, day],
      ),
    );
    expect(bSummary).toEqual({ sales_minor: "7000", refunds_minor: "0" });
  });

  it("lists a vendor's customers with limited fields and spend net of refunds", async () => {
    const a = await vendor();
    const b = await vendor();
    const pa = await createActiveProduct(pool, a.vendorId, { priceMinor: 5000, stock: 50 });
    const pb = await createActiveProduct(pool, b.vendorId, { priceMinor: 5000, stock: 50 });
    const jane = await shopper("Jane Doe");
    const omar = await shopper("Omar Q");
    const janeFirst = await order(jane, [{ variantId: pa.variantId, quantity: 2 }]);
    await order(jane, [{ variantId: pa.variantId, quantity: 1 }]);
    await order(omar, [{ variantId: pb.variantId, quantity: 1 }]); // B's customer only
    await order(omar, [{ variantId: pa.variantId, quantity: 1 }], { pay: false }); // unpaid: not A's customer
    await refund((await vendorOrderOf(janeFirst, a.vendorId)).id, (await itemOf(janeFirst, pa.variantId)).id, 1);

    const rows = await asUser(pool, a.owner, (s) =>
      s.rows<Record<string, unknown>>("select * from public.vendor_customers($1)", [a.vendorId]),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "city",
        "country_code",
        "customer_key",
        "customer_name",
        "last_order_at",
        "paid_orders",
        "spent_minor",
        "total_count",
      ].sort(),
    );
    expect(rows[0]).toMatchObject({
      customer_name: "Test Customer", // name on the shipping address
      city: "Paris",
      country_code: "FR",
      paid_orders: 2,
      spent_minor: "10000", // 100.00 + 50.00 − 50.00 refunded
      total_count: 1,
    });
    expect(rows[0].customer_key).not.toBe(jane.customer.profileId);
    expect(
      await asUser(pool, a.owner, (s) => s.rows("select * from public.vendor_customers($1, 'nobody')", [a.vendorId])),
    ).toEqual([]);
    const bRows = await asUser(pool, b.owner, (s) =>
      s.rows<{ paid_orders: number }>("select paid_orders from public.vendor_customers($1)", [b.vendorId]),
    );
    expect(bRows).toEqual([{ paid_orders: 1 }]);
  });
});

describe("admin customers, audit log and settings", () => {
  it("finds customers by email with paid orders, net spend and returns", async () => {
    const v = await vendor();
    const p = await createActiveProduct(pool, v.vendorId, { priceMinor: 6000, stock: 20 });
    const buyer = await shopper("Ada Lovelace");
    const o = await order(buyer, [{ variantId: p.variantId, quantity: 2 }]);
    await order(buyer, [{ variantId: p.variantId, quantity: 1 }], { pay: false });
    await refund((await vendorOrderOf(o, v.vendorId)).id, (await itemOf(o, p.variantId)).id, 1);

    const found = await asUser(pool, admin, (s) =>
      s.rows<Record<string, unknown>>("select * from public.admin_customers($1)", [buyer.customer.email.toUpperCase()]),
    );
    expect(found).toEqual([
      expect.objectContaining({
        profile_id: buyer.customer.profileId,
        full_name: "Ada Lovelace",
        email: buyer.customer.email,
        status: "active",
        paid_orders: 1,
        spent_minor: "6000",
        return_requests: 0,
        total_count: 1,
      }),
    ]);
    const vendorAccounts = await asUser(pool, admin, (s) =>
      s.rows("select * from public.admin_customers(null, null, $1)", [v.owner.profileId]),
    );
    expect(vendorAccounts).toEqual([]); // customer accounts only
  });

  it("keeps the audit log admin-only and immutable, and settings read-only for admins", async () => {
    const v = await vendor();
    await asUser(pool, v.owner, async (s) => {
      expect(await s.rows("select id from public.audit_logs limit 1")).toEqual([]);
    });
    await asUser(pool, admin, async (s) => {
      expect((await s.rows("select id from public.audit_logs limit 1")).length).toBe(1);
      // No API role may change it (no update grant; the immutability trigger backs this up).
      await s.denied("update public.audit_logs set action = 'x.y' where id = (select min(id) from public.audit_logs)");
      const keys = await s.rows<{ key: string }>(
        "select key from public.platform_settings where key = 'commission.default_bps'",
      );
      expect(keys).toEqual([{ key: "commission.default_bps" }]);
      const updated = await s.query(
        "update public.platform_settings set value = '0' where key = 'commission.default_bps'",
      );
      expect(updated.rowCount).toBe(0); // only super admins may write settings (Phase 1)
    });
  });
});
