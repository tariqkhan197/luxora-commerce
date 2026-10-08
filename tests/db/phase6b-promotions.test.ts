import { randomUUID } from "node:crypto";
import type pg from "pg";
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

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const newCode = (prefix = "CODE") => `${prefix}${randomUUID().slice(0, 8).toUpperCase()}`;

/** A vendor (owner + staff). `shippingMinor` null = free test shipping. */
async function vendor(options: { commissionBps?: number; shippingMinor?: number | null } = {}) {
  const owner = await createUser(pool);
  const staff = await createUser(pool);
  const shippingMinor = options.shippingMinor ?? null;
  const { vendorId } = await createApprovedVendor(pool, owner, {
    commissionBps: options.commissionBps ?? 1000,
    freeTestShipping: shippingMinor === null,
  });
  await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
    vendorId,
    staff.profileId,
  ]);
  if (shippingMinor !== null) {
    const zoneId = await ensureTestShippingZone(pool);
    await pool.query(
      "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor, additional_item_minor) values ($1, $2, $3, 0)",
      [vendorId, zoneId, shippingMinor],
    );
  }
  return { owner, staff, vendorId };
}

const product = (vendorId: string, priceMinor: number, stock = 50) =>
  createActiveProduct(pool, vendorId, { priceMinor, stock });

async function shopper() {
  const customer = await createUser(pool);
  const addressId = await addAddress(pool, customer);
  return { customer, addressId };
}

interface CouponFields {
  code?: string;
  type: "percentage" | "fixed_amount" | "free_shipping";
  value?: number;
  minSubtotal?: number;
  maxDiscount?: number | null;
  usageLimit?: number | null;
  perCustomer?: number | null;
}

async function saveCoupon(user: TestUser, vendorId: string | null, fields: CouponFields) {
  const code = fields.code ?? newCode();
  const row = await asUser(
    pool,
    user,
    (s) =>
      s.one<{ id: string }>(
        "select public.save_coupon(null, $1, $2, 'Test code', null, $3, $4, $5, $6, $7, $8, null, null) as id",
        [
          vendorId,
          code,
          fields.type,
          fields.value ?? 0,
          fields.minSubtotal ?? 0,
          fields.maxDiscount ?? null,
          fields.usageLimit ?? null,
          fields.perCustomer ?? null,
        ],
      ),
    true,
  );
  return { id: row.id, code };
}

const apply = (user: TestUser, code: string) =>
  asUser(
    pool,
    user,
    (s) => s.one<{ applied: boolean; message: string }>("select * from public.apply_cart_coupon($1)", [code]),
    true,
  );

const quote = (user: TestUser, addressId: string | null = null) =>
  asUser(pool, user, (s) =>
    s.rows<{
      applied: boolean;
      message: string | null;
      discount_minor: string;
      shipping_discount_minor: string;
      line_discounts: Record<string, number>;
    }>("select * from public.cart_promotion_quote($1)", [addressId]),
  );

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

async function order(orderId: string) {
  const { rows } = await pool.query(
    `select subtotal_minor::int, discount_minor::int, shipping_minor::int, shipping_discount_minor::int, total_minor::int,
            coupon_code, status, payment_status
       from public.orders where id = $1`,
    [orderId],
  );
  return rows[0];
}

async function vendorOrderOf(orderId: string, vendorId: string) {
  const { rows } = await pool.query(
    `select id, subtotal_minor::int, discount_minor::int, shipping_minor::int, shipping_discount_minor::int,
            total_minor::int, platform_funded_minor::int, commission_minor::int, vendor_earnings_minor::int
       from public.vendor_orders where order_id = $1 and vendor_id = $2`,
    [orderId, vendorId],
  );
  return rows[0];
}

async function items(orderId: string) {
  const { rows } = await pool.query(
    `select id, variant_id, quantity, unit_price_minor::int, list_price_minor::int, discount_minor::int,
            platform_discount_minor::int, total_minor::int, commission_minor::int, flash_sale_item_id
       from public.order_items where order_id = $1 order by created_at, id`,
    [orderId],
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

async function couponState(couponId: string) {
  const { rows } = await pool.query<{ used_count: number }>("select used_count from public.coupons where id = $1", [
    couponId,
  ]);
  const usages = await pool.query<{ status: string }>(
    "select status from public.coupon_usages where coupon_id = $1 order by created_at",
    [couponId],
  );
  return { used: rows[0].used_count, usages: usages.rows.map((r) => r.status) };
}

const cancelOrder = (customer: TestUser, orderId: string) =>
  asUser(pool, customer, (s) => s.query("select public.cancel_pending_order($1)", [orderId]), true);

const requestRefund = (
  vendorOrderId: string,
  lines: { order_item_id: string; quantity: number }[],
  kind: string,
  includeShipping: boolean | null = null,
) =>
  asUser(
    pool,
    admin,
    (s) =>
      s.one<{ refund_id: string; amount_minor: string }>(
        "select * from public.request_refund($1, $2, $3, 'Customer request', $4)",
        [vendorOrderId, JSON.stringify(lines), kind, includeShipping],
      ),
    true,
  );

const refundSucceeded = (refundId: string) =>
  asService(
    pool,
    (s) =>
      s.query("select public.mark_refund_submitted($1, $2, 'succeeded')", [
        refundId,
        `re_test_${randomUUID().slice(0, 10)}`,
      ]),
    true,
  );

async function setSetting(key: string, value: unknown) {
  await pool.query("update public.platform_settings set value = $2::jsonb where key = $1", [
    key,
    JSON.stringify(value),
  ]);
}

/** A live flash sale of `vendorId` with one item; returns the sale and item ids. */
async function flashSale(
  owner: TestUser,
  vendorId: string,
  variantId: string,
  salePriceMinor: number,
  quantityLimit: number | null = null,
) {
  const sale = await asUser(
    pool,
    owner,
    (s) =>
      s.one<{ id: string }>(
        "select public.save_flash_sale(null, $1, 'Weekend sale', null, now() - interval '1 minute', now() + interval '1 day') as id",
        [vendorId],
      ),
    true,
  );
  await asUser(
    pool,
    owner,
    (s) =>
      s.query("select public.set_flash_sale_items($1, $2)", [
        sale.id,
        JSON.stringify([{ variant_id: variantId, sale_price_minor: salePriceMinor, quantity_limit: quantityLimit }]),
      ]),
    true,
  );
  const item = await pool.query<{ id: string }>("select id from public.flash_sale_items where flash_sale_id = $1", [
    sale.id,
  ]);
  return { saleId: sale.id, itemId: item.rows[0].id };
}

async function soldCount(itemId: string) {
  const { rows } = await pool.query<{ sold_count: number }>(
    "select sold_count from public.flash_sale_items where id = $1",
    [itemId],
  );
  return rows[0].sold_count;
}

// -----------------------------------------------------------------------------
describe("integer allocation", () => {
  it("splits by largest remainder, ties to the earlier line, and always adds up", async () => {
    const alloc = async (amount: number, weights: number[]) =>
      (
        await pool.query<{ a: string[] }>("select public.allocate_minor_internal($1, $2::bigint[]) as a", [
          amount,
          weights,
        ])
      ).rows[0].a.map(Number);
    expect(await alloc(1000, [3333, 3333, 3334])).toEqual([333, 333, 334]);
    expect(await alloc(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(await alloc(1300, [10000, 3000])).toEqual([1000, 300]);
    expect(await alloc(0, [5, 5])).toEqual([0, 0]);
    const shares = await alloc(997, [123, 4567, 89, 1011]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(997);
  });
});

describe("platform coupons (funded by Luxora)", () => {
  it("keeps vendor earnings and commission on the full price and books the cost when paid", async () => {
    const a = await vendor({ commissionBps: 1000 });
    const b = await vendor({ commissionBps: 2000 });
    const pa = await product(a.vendorId, 5000);
    const pb = await product(b.vendorId, 3000);
    const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, pa.variantId, 2);
    await addToCart(pool, customer, pb.variantId, 1);

    expect(await apply(customer, coupon.code.toLowerCase())).toEqual({ applied: true, message: "Code applied." });
    expect(await quote(customer)).toEqual([expect.objectContaining({ applied: true, discount_minor: "1300" })]);

    const orderId = await placeOrder(pool, customer, addressId);
    expect(await order(orderId)).toMatchObject({
      subtotal_minor: 13000,
      discount_minor: 1300,
      total_minor: 11700,
      coupon_code: coupon.code,
    });
    expect(await vendorOrderOf(orderId, a.vendorId)).toMatchObject({
      discount_minor: 1000,
      total_minor: 9000,
      platform_funded_minor: 1000,
      commission_minor: 1000,
      vendor_earnings_minor: 9000,
    });
    expect(await vendorOrderOf(orderId, b.vendorId)).toMatchObject({
      discount_minor: 300,
      total_minor: 2700,
      platform_funded_minor: 300,
      commission_minor: 600,
      vendor_earnings_minor: 2400,
    });
    expect((await items(orderId)).map((i) => [i.discount_minor, i.platform_discount_minor])).toEqual([
      expect.any(Array),
      expect.any(Array),
    ]);
    for (const item of await items(orderId)) {
      expect(item.platform_discount_minor).toBe(item.discount_minor);
    }
    expect(await couponState(coupon.id)).toEqual({ used: 1, usages: ["reserved"] });

    await pay(customer, orderId);
    const ledger = await platformLedger(orderId);
    expect(
      ledger
        .filter((e) => e.entry_type === "promotion_cost")
        .map((e) => Number(e.amount_minor))
        .sort(),
    ).toEqual([-1000, -300]);
    expect(
      ledger.filter((e) => e.entry_type === "commission_earned").reduce((sum, e) => sum + Number(e.amount_minor), 0),
    ).toBe(1600);
    expect(await couponState(coupon.id)).toEqual({ used: 1, usages: ["redeemed"] });
  });

  it("rounds percentages half-up, applies caps and splits fixed amounts exactly", async () => {
    const v = await vendor();
    const { customer, addressId } = await shopper();
    const p = await product(v.vendorId, 3333);
    await addToCart(pool, customer, p.variantId, 1);
    await apply(customer, (await saveCoupon(admin, null, { type: "percentage", value: 1500 })).code);
    // 15% of 33.33 = 4.9995 → 5.00
    expect((await quote(customer))[0].discount_minor).toBe("500");

    await apply(customer, (await saveCoupon(admin, null, { type: "percentage", value: 5000, maxDiscount: 1000 })).code);
    expect((await quote(customer))[0].discount_minor).toBe("1000");

    const p2 = await product(v.vendorId, 3333);
    const p3 = await product(v.vendorId, 3334);
    await addToCart(pool, customer, p2.variantId, 1);
    await addToCart(pool, customer, p3.variantId, 1);
    await apply(customer, (await saveCoupon(admin, null, { type: "fixed_amount", value: 1000 })).code);
    const orderId = await placeOrder(pool, customer, addressId);
    // Items are inserted together, so order them by price: the 33.34 line takes the extra cent.
    const discounts = (await items(orderId))
      .sort((x, y) => x.unit_price_minor - y.unit_price_minor)
      .map((i) => [i.unit_price_minor, i.discount_minor]);
    expect(discounts).toEqual([
      [3333, 333],
      [3333, 333],
      [3334, 334],
    ]);
    expect(await order(orderId)).toMatchObject({ discount_minor: 1000, total_minor: 9000 });
  });

  it("enforces the minimum spend, the minimum charge and the expected total", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    expect(
      await apply(
        customer,
        (await saveCoupon(admin, null, { type: "percentage", value: 1000, minSubtotal: 6000 })).code,
      ),
    ).toEqual({
      applied: false,
      message: "Spend at least USD 60.00 on eligible items to use this code.",
    });
    expect(await apply(customer, (await saveCoupon(admin, null, { type: "fixed_amount", value: 4980 })).code)).toEqual({
      applied: false,
      message: "This code would bring your order below the minimum payment of USD 0.50.",
    });

    await apply(customer, (await saveCoupon(admin, null, { type: "fixed_amount", value: 500 })).code);
    await asUser(pool, customer, async (s) => {
      const stale = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2, 5000)", [
        addressId,
        randomUUID(),
      ]);
      expect(stale.message).toBe("Prices or shipping costs have changed. Please review your order and try again.");
      await s.query("select public.place_order($1, $1, $2, 4500)", [addressId, randomUUID()]);
    });
  });

  it("refuses unknown codes with one message and throttles repeated failures", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const { customer } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    const paused = await saveCoupon(admin, null, { type: "percentage", value: 1000 });
    await asUser(pool, admin, (s) => s.query("select public.set_coupon_active($1, false)", [paused.id]), true);
    expect(await apply(customer, "NOPE-NOT-REAL")).toEqual({ applied: false, message: "This code isn't valid." });
    expect(await apply(customer, paused.code)).toEqual({ applied: false, message: "This code isn't valid." });
    for (let i = 0; i < 8; i += 1) await apply(customer, `MISSING${i}`);
    const valid = await saveCoupon(admin, null, { type: "percentage", value: 1000 });
    expect(await apply(customer, valid.code)).toEqual({
      applied: false,
      message: "Too many attempts. Please try again later.",
    });
  });
});

describe("vendor coupons (funded by the vendor)", () => {
  it("discounts only the vendor's items and charges commission on the discounted amount", async () => {
    const a = await vendor({ commissionBps: 1000 });
    const b = await vendor({ commissionBps: 2000 });
    const pa = await product(a.vendorId, 5000);
    const pb = await product(b.vendorId, 3000);
    const coupon = await saveCoupon(a.owner, a.vendorId, { type: "percentage", value: 1000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, pa.variantId, 2);
    await addToCart(pool, customer, pb.variantId, 1);
    expect((await apply(customer, coupon.code)).applied).toBe(true);

    const orderId = await placeOrder(pool, customer, addressId);
    expect(await order(orderId)).toMatchObject({ discount_minor: 1000, total_minor: 12000 });
    expect(await vendorOrderOf(orderId, a.vendorId)).toMatchObject({
      discount_minor: 1000,
      platform_funded_minor: 0,
      commission_minor: 900,
      vendor_earnings_minor: 8100,
    });
    expect(await vendorOrderOf(orderId, b.vendorId)).toMatchObject({
      discount_minor: 0,
      commission_minor: 600,
      vendor_earnings_minor: 2400,
    });
    await pay(customer, orderId);
    expect((await platformLedger(orderId)).some((e) => e.entry_type === "promotion_cost")).toBe(false);
  });

  it("is managed only by the vendor's owners and managers, with admin override", async () => {
    const a = await vendor();
    const other = await vendor();
    const { customer } = await shopper();
    await asUser(pool, a.owner, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.save_coupon(null, $1, $2, 'Ship free', null, 'free_shipping', 0, 0, null, null, null, null, null)",
        [a.vendorId, newCode()],
      );
      expect(error.message).toBe("Only Luxora can offer free-shipping codes.");
    });
    await asUser(pool, a.staff, (s) =>
      s.denied(
        "select public.save_coupon(null, $1, $2, 'Staff', null, 'percentage', 500, 0, null, null, null, null, null)",
        [a.vendorId, newCode()],
      ),
    );
    await asUser(pool, a.owner, (s) =>
      s.denied(
        "select public.save_coupon(null, null, $1, 'Platform', null, 'percentage', 500, 0, null, null, null, null, null)",
        [newCode()],
      ),
    );
    const coupon = await saveCoupon(a.owner, a.vendorId, { type: "percentage", value: 500 });
    await asUser(pool, other.owner, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.set_coupon_active($1, false)", [coupon.id]),
    );
    // Read access: the vendor team yes, other vendors and customers no; nobody writes directly.
    expect(
      await asUser(pool, a.staff, (s) => s.rows("select id from public.coupons where id = $1", [coupon.id])),
    ).toHaveLength(1);
    expect(
      await asUser(pool, other.owner, (s) => s.rows("select id from public.coupons where id = $1", [coupon.id])),
    ).toEqual([]);
    expect(await asUser(pool, customer, (s) => s.rows("select id from public.coupons"))).toEqual([]);
    await asUser(pool, a.owner, (s) => s.denied("update public.coupons set used_count = 0 where id = $1", [coupon.id]));
    await asUser(pool, admin, (s) =>
      s.denied("update public.coupons set discount_value = 9000 where id = $1", [coupon.id]),
    );

    // Admin disables it: the code stops working and the vendor cannot switch it back on.
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.admin_set_coupon_disabled($1, true, '')", [coupon.id]),
    );
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.admin_set_coupon_disabled($1, true, 'Misleading offer')", [coupon.id]),
      true,
    );
    await asUser(pool, a.owner, (s) => s.query("select public.set_coupon_active($1, false)", [coupon.id]), true);
    await asUser(pool, a.owner, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.set_coupon_active($1, true)", [coupon.id]);
      expect(error.message).toBe("Luxora has disabled this code: Misleading offer");
    });
    const p = await product(a.vendorId, 5000);
    await addToCart(pool, customer, p.variantId, 1);
    expect(await apply(customer, coupon.code)).toEqual({ applied: false, message: "This code isn't valid." });
    const audit = await pool.query<{ action: string }>(
      "select action from public.audit_logs where entity_type = 'coupon' and entity_id = $1 order by id",
      [coupon.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["coupon.created", "coupon.disabled_by_admin", "coupon.paused"]);
  });

  it("locks the code and discount once used, but not the dates and limits", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(v.owner, v.vendorId, { type: "percentage", value: 1000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    await apply(customer, coupon.code);
    await placeOrder(pool, customer, addressId);
    await asUser(pool, v.owner, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.save_coupon($1, null, $2, 'Test code', null, 'percentage', 2000, 0, null, null, null, null, null)",
        [coupon.id, coupon.code],
      );
      expect(error.message).toBe("This code has been used, so its code and discount can no longer change.");
      await s.query(
        "select public.save_coupon($1, null, $2, 'Renamed', null, 'percentage', 1000, 1000, null, 50, 1, null, now() + interval '7 days')",
        [coupon.id, coupon.code],
      );
    });
  });
});

describe("free-shipping coupons", () => {
  it("lets Luxora pay the shipping, never refunds shipping the customer did not pay", async () => {
    const v = await vendor({ shippingMinor: 500, commissionBps: 1000 });
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(admin, null, { type: "free_shipping" });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    expect(await apply(customer, coupon.code)).toEqual({
      applied: true,
      message: "Code applied: free shipping at checkout.",
    });
    expect(await quote(customer, addressId)).toEqual([
      expect.objectContaining({ applied: true, discount_minor: "0", shipping_discount_minor: "500" }),
    ]);

    const orderId = await placeOrder(pool, customer, addressId);
    expect(await order(orderId)).toMatchObject({
      shipping_minor: 500,
      shipping_discount_minor: 500,
      total_minor: 5000,
    });
    const vo = await vendorOrderOf(orderId, v.vendorId);
    expect(vo).toMatchObject({
      total_minor: 5000,
      platform_funded_minor: 500,
      commission_minor: 500,
      vendor_earnings_minor: 5000,
    });
    await pay(customer, orderId);
    expect((await platformLedger(orderId)).filter((e) => e.entry_type === "promotion_cost")).toEqual([
      { entry_type: "promotion_cost", amount_minor: "-500" },
    ]);

    const [item] = await items(orderId);
    const refund = await requestRefund(vo.id, [{ order_item_id: item.id, quantity: 1 }], "cancellation", true);
    expect(refund.amount_minor).toBe("5000");
  });
});

describe("coupon reservations", () => {
  it("reserves a use when ordering and releases it only if the order is never paid", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000, usageLimit: 1 });
    const first = await shopper();
    const second = await shopper();
    await addToCart(pool, first.customer, p.variantId, 1);
    await addToCart(pool, second.customer, p.variantId, 1);
    await apply(first.customer, coupon.code);
    await apply(second.customer, coupon.code);

    const orderId = await placeOrder(pool, first.customer, first.addressId);
    expect(await couponState(coupon.id)).toEqual({ used: 1, usages: ["reserved"] });
    expect((await quote(second.customer))[0]).toMatchObject({
      applied: false,
      message: "This code has reached its usage limit.",
    });
    await asUser(pool, second.customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        second.addressId,
        randomUUID(),
      ]);
      expect(error.message).toBe(
        `This code has reached its usage limit. Remove the code ${coupon.code} from your bag to continue.`,
      );
    });

    await cancelOrder(first.customer, orderId);
    expect(await couponState(coupon.id)).toEqual({ used: 0, usages: ["released"] });
    const secondOrder = await placeOrder(pool, second.customer, second.addressId);
    await pay(second.customer, secondOrder);
    const vo = await vendorOrderOf(secondOrder, v.vendorId);
    const [item] = await items(secondOrder);
    const refund = await requestRefund(vo.id, [{ order_item_id: item.id, quantity: 1 }], "return");
    await refundSucceeded(refund.refund_id);
    // Paid, then refunded: the use is not given back (P5).
    expect(await couponState(coupon.id)).toEqual({ used: 1, usages: ["released", "redeemed"] });
  });

  it("limits uses per customer and re-attaches the code when an expired order is restored", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000, perCustomer: 1 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    await apply(customer, coupon.code);
    const orderId = await placeOrder(pool, customer, addressId);
    await addToCart(pool, customer, p.variantId, 1);
    expect(await apply(customer, coupon.code)).toEqual({ applied: false, message: "You have already used this code." });
    await asUser(pool, customer, (s) => s.query("select public.clear_cart()"), true);

    await pool.query("update public.orders set reservation_expires_at = now() - interval '1 minute' where id = $1", [
      orderId,
    ]);
    await asService(pool, (s) => s.query("select public.expire_stale_checkouts()"), true);
    expect(await couponState(coupon.id)).toEqual({ used: 0, usages: ["released"] });
    await asUser(pool, customer, (s) => s.query("select * from public.restore_cart_from_order($1)", [orderId]), true);
    expect(await quote(customer)).toEqual([expect.objectContaining({ applied: true, discount_minor: "500" })]);
  });

  it("serialises concurrent checkouts racing for the last use", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000, usageLimit: 1 });
    const a = await shopper();
    const b = await shopper();
    for (const s of [a, b]) {
      await addToCart(pool, s.customer, p.variantId, 1);
      await apply(s.customer, coupon.code);
    }
    const results = await race(a, b);
    expect(results.first).toBe("ok");
    expect(results.second).toMatch(/usage limit/);
    expect(await couponState(coupon.id)).toEqual({ used: 1, usages: ["reserved"] });
  });
});

describe("flash sales (funded by the vendor)", () => {
  it("prices the line at the sale price, excludes it from coupons and charges commission on the sale price", async () => {
    const v = await vendor({ commissionBps: 1000 });
    const onSale = await product(v.vendorId, 10_000);
    const regular = await product(v.vendorId, 5000);
    const { itemId } = await flashSale(v.owner, v.vendorId, onSale.variantId, 7000);
    const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, onSale.variantId, 1);
    expect(await apply(customer, coupon.code)).toEqual({
      applied: false,
      message: "This code doesn't apply to items on flash sale.",
    });
    await addToCart(pool, customer, regular.variantId, 1);
    expect((await apply(customer, coupon.code)).applied).toBe(true);
    const lines = await asUser(pool, customer, (s) =>
      s.rows<{ unit_price_minor: string; list_price_minor: string; flash_sale_item_id: string | null }>(
        "select unit_price_minor, list_price_minor, flash_sale_item_id from public.cart_lines() order by list_price_minor desc",
      ),
    );
    expect(lines[0]).toEqual({ unit_price_minor: "7000", list_price_minor: "10000", flash_sale_item_id: itemId });

    const orderId = await placeOrder(pool, customer, addressId);
    const [flash, plain] = (await items(orderId)).sort((x, y) => y.list_price_minor - x.list_price_minor);
    expect(flash).toMatchObject({
      unit_price_minor: 7000,
      list_price_minor: 10_000,
      discount_minor: 0,
      commission_minor: 700,
      flash_sale_item_id: itemId,
    });
    expect(plain).toMatchObject({
      unit_price_minor: 5000,
      discount_minor: 500,
      platform_discount_minor: 500,
      commission_minor: 500,
    });
    expect(await soldCount(itemId)).toBe(1);
  });

  it("reserves capped units, prices lines that do not fit at the regular price and releases unpaid orders", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 10_000);
    const { itemId } = await flashSale(v.owner, v.vendorId, p.variantId, 6000, 2);
    const first = await shopper();
    const second = await shopper();

    await addToCart(pool, second.customer, p.variantId, 3);
    const tooMany = await asUser(pool, second.customer, (s) =>
      s.one<{ unit_price_minor: string; flash_sale_units_left: number }>(
        "select unit_price_minor, flash_sale_units_left from public.cart_lines()",
      ),
    );
    expect(tooMany).toEqual({ unit_price_minor: "10000", flash_sale_units_left: 2 });
    await asUser(pool, second.customer, (s) => s.query("select public.clear_cart()"), true);
    await addToCart(pool, second.customer, p.variantId, 1);

    await addToCart(pool, first.customer, p.variantId, 2);
    const firstOrder = await placeOrder(pool, first.customer, first.addressId);
    expect(await soldCount(itemId)).toBe(2);
    // The second shopper saw the sale price; it is gone now, so their checkout is refused.
    await asUser(pool, second.customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2, 6000)", [
        second.addressId,
        randomUUID(),
      ]);
      expect(error.message).toBe("Prices or shipping costs have changed. Please review your order and try again.");
    });

    await cancelOrder(first.customer, firstOrder);
    expect(await soldCount(itemId)).toBe(0);
    const secondOrder = await placeOrder(pool, second.customer, second.addressId);
    await pay(second.customer, secondOrder);
    const [item] = await items(secondOrder);
    const refund = await requestRefund(
      (await vendorOrderOf(secondOrder, v.vendorId)).id,
      [{ order_item_id: item.id, quantity: 1 }],
      "return",
    );
    await refundSucceeded(refund.refund_id);
    // Paid, then refunded: the unit is not returned to the sale (D7).
    expect(await soldCount(itemId)).toBe(1);
  });

  it("serialises concurrent checkouts racing for the last sale unit", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 10_000);
    const { itemId } = await flashSale(v.owner, v.vendorId, p.variantId, 6000, 1);
    const a = await shopper();
    const b = await shopper();
    await addToCart(pool, a.customer, p.variantId, 1);
    await addToCart(pool, b.customer, p.variantId, 1);
    const results = await race(a, b, 6000);
    expect(results.first).toBe("ok");
    expect(results.second).toMatch(/Prices or shipping costs have changed/);
    expect(await soldCount(itemId)).toBe(1);
  });

  it("enforces the sale rules and who can manage sales", async () => {
    const v = await vendor();
    const other = await vendor();
    const p = await product(v.vendorId, 10_000);
    const theirs = await product(other.vendorId, 10_000);
    const sale = await asUser(
      pool,
      v.owner,
      (s) =>
        s.one<{ id: string }>(
          "select public.save_flash_sale(null, $1, 'Spring', null, now() + interval '1 hour', now() + interval '2 days') as id",
          [v.vendorId],
        ),
      true,
    );
    const setItems = (user: TestUser, list: unknown[]) =>
      asUser(
        pool,
        user,
        (s) => s.query("select public.set_flash_sale_items($1, $2)", [sale.id, JSON.stringify(list)]),
        true,
      );

    await expect(setItems(v.owner, [{ variant_id: p.variantId, sale_price_minor: 10_000 }])).rejects.toMatchObject({
      code: SQLSTATE.raiseException,
    });
    await expect(setItems(v.owner, [{ variant_id: theirs.variantId, sale_price_minor: 5000 }])).rejects.toThrow(
      "A product in this sale does not belong to your store.",
    );
    await expect(setItems(v.staff, [{ variant_id: p.variantId, sale_price_minor: 5000 }])).rejects.toMatchObject({
      code: SQLSTATE.noDataFound,
    });
    await setItems(v.owner, [{ variant_id: p.variantId, sale_price_minor: 5000, quantity_limit: 10 }]);

    // D10: the same variant cannot be in an overlapping sale.
    const overlapping = await asUser(
      pool,
      v.owner,
      (s) =>
        s.one<{ id: string }>(
          "select public.save_flash_sale(null, $1, 'Overlap', null, now() + interval '1 day', now() + interval '3 days') as id",
          [v.vendorId],
        ),
      true,
    );
    await expect(
      asUser(pool, v.owner, (s) =>
        s.query("select public.set_flash_sale_items($1, $2)", [
          overlapping.id,
          JSON.stringify([{ variant_id: p.variantId, sale_price_minor: 4000 }]),
        ]),
      ),
    ).rejects.toThrow("is in another flash sale at the same time");

    // Not live yet: invisible to shoppers, regular price in the catalog.
    expect(await asAnon(pool, (s) => s.rows("select id from public.flash_sales where id = $1", [sale.id]))).toEqual([]);
    // Nobody writes sales directly.
    await asUser(pool, v.owner, (s) =>
      s.denied("update public.flash_sale_items set sale_price_minor = 1 where flash_sale_id = $1", [sale.id]),
    );
    await asUser(pool, v.owner, (s) =>
      s.denied(
        "insert into public.flash_sales (vendor_id, name, starts_at, ends_at) values ($1, 'Direct', now(), now() + interval '1 day')",
        [v.vendorId],
      ),
    );

    // Once started, items and prices are locked; the sale can be ended early.
    await pool.query("update public.flash_sales set starts_at = now() - interval '1 minute' where id = $1", [sale.id]);
    expect(
      await asAnon(pool, (s) => s.rows("select id from public.flash_sales where id = $1", [sale.id])),
    ).toHaveLength(1);
    const variant = await asAnon(pool, (s) =>
      s.one<{ sale_price_minor: string; sale_limited: boolean }>(
        "select sale_price_minor, sale_limited from public.product_variant_availability where variant_id = $1",
        [p.variantId],
      ),
    );
    expect(variant).toEqual({ sale_price_minor: "5000", sale_limited: true });
    const listing = await asAnon(pool, (s) =>
      s.one<{ flash_min_price_minor: string }>(
        "select flash_min_price_minor from public.product_listings where id = $1",
        [p.productId],
      ),
    );
    expect(listing.flash_min_price_minor).toBe("5000");
    await expect(setItems(v.owner, [{ variant_id: p.variantId, sale_price_minor: 4000 }])).rejects.toThrow(
      "The sale has started, so its items and prices can no longer change.",
    );
    await asUser(pool, v.owner, (s) => s.query("select public.end_flash_sale($1)", [sale.id]), true);
    expect(await asAnon(pool, (s) => s.rows("select id from public.flash_sales where id = $1", [sale.id]))).toEqual([]);
  });

  it("lets an administrator disable a sale with a reason", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 10_000);
    const { saleId } = await flashSale(v.owner, v.vendorId, p.variantId, 6000);
    await asUser(pool, v.owner, (s) => s.denied("select public.admin_disable_flash_sale($1, 'No')", [saleId]));
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.admin_disable_flash_sale($1, 'Price misleading')", [saleId]),
      true,
    );
    const { customer } = await shopper();
    await addToCart(pool, customer, p.variantId, 1);
    const line = await asUser(pool, customer, (s) =>
      s.one<{ unit_price_minor: string }>("select unit_price_minor from public.cart_lines()"),
    );
    expect(line.unit_price_minor).toBe("10000");
    const audit = await pool.query(
      "select 1 from public.audit_logs where action = 'flash_sale.disabled_by_admin' and entity_id = $1",
      [saleId],
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("refunds of discounted items", () => {
  it("returns what was paid per unit, adding up exactly to the line's paid total", async () => {
    const v = await vendor({ commissionBps: 1000 });
    const p = await product(v.vendorId, 3333);
    const coupon = await saveCoupon(admin, null, { type: "fixed_amount", value: 1000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 3);
    await apply(customer, coupon.code);
    const orderId = await placeOrder(pool, customer, addressId);
    await pay(customer, orderId);
    const vo = await vendorOrderOf(orderId, v.vendorId);
    const [item] = await items(orderId);
    expect(item.total_minor).toBe(8999); // 3 × 33.33 − 10.00

    const amounts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const refund = await requestRefund(vo.id, [{ order_item_id: item.id, quantity: 1 }], "return");
      amounts.push(Number(refund.amount_minor));
      await refundSucceeded(refund.refund_id);
    }
    expect(amounts).toEqual([2999, 3000, 3000]);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(8999);
    const losses = (await platformLedger(orderId)).filter((e) => e.entry_type === "refund_loss");
    expect(losses.reduce((sum, e) => sum + Number(e.amount_minor), 0)).toBe(-8999);
  });

  it("refunds a received return at the discounted amount", async () => {
    const v = await vendor();
    const p = await product(v.vendorId, 5000);
    const coupon = await saveCoupon(v.owner, v.vendorId, { type: "percentage", value: 2000 });
    const { customer, addressId } = await shopper();
    await addToCart(pool, customer, p.variantId, 2);
    await apply(customer, coupon.code);
    const orderId = await placeOrder(pool, customer, addressId);
    await pay(customer, orderId);
    const vo = await vendorOrderOf(orderId, v.vendorId);
    await pool.query(
      "update public.vendor_orders set status = 'delivered', shipped_at = now() - interval '3 days', delivered_at = now() - interval '1 day' where id = $1",
      [vo.id],
    );
    const [item] = await items(orderId);
    const ret = await asUser(
      pool,
      customer,
      (s) =>
        s.one<{ id: string }>("select public.create_return_request($1, $2) as id", [
          vo.id,
          JSON.stringify([{ order_item_id: item.id, quantity: 1, reason: "Too big" }]),
        ]),
      true,
    );
    await asUser(
      pool,
      v.owner,
      (s) => s.query("select public.approve_return_request($1, 'Send to the studio, 1 Rue X, Paris')", [ret.id]),
      true,
    );
    await asUser(pool, v.owner, (s) => s.query("select public.mark_return_received($1, true)", [ret.id]), true);
    const refund = await asUser(
      pool,
      admin,
      (s) => s.one<{ amount_minor: string }>("select * from public.request_return_refund($1)", [ret.id]),
      true,
    );
    expect(refund.amount_minor).toBe("4000"); // 50.00 − 20%
  });

  it("recovers Luxora's funded share when vendors repay refunds (net of commission)", async () => {
    await setSetting("refunds.vendor_liability", "net_of_commission");
    try {
      const v = await vendor({ commissionBps: 1000 });
      const p = await product(v.vendorId, 10_000);
      const coupon = await saveCoupon(admin, null, { type: "percentage", value: 1000 });
      const { customer, addressId } = await shopper();
      await addToCart(pool, customer, p.variantId, 1);
      await apply(customer, coupon.code);
      const orderId = await placeOrder(pool, customer, addressId);
      await pay(customer, orderId);
      const vo = await vendorOrderOf(orderId, v.vendorId);
      const [item] = await items(orderId);
      const refund = await requestRefund(vo.id, [{ order_item_id: item.id, quantity: 1 }], "return");
      expect(refund.amount_minor).toBe("9000");
      await refundSucceeded(refund.refund_id);

      const vendorEntries = await pool.query<{ entry_type: string; amount_minor: string }>(
        "select entry_type, amount_minor from public.vendor_ledger_entries where vendor_order_id = $1 order by id",
        [vo.id],
      );
      expect(vendorEntries.rows).toEqual([
        { entry_type: "order_earning", amount_minor: "9000" },
        { entry_type: "refund_debit", amount_minor: "-9000" },
      ]);
      const ledger = await platformLedger(orderId);
      expect(ledger).toEqual([
        { entry_type: "commission_earned", amount_minor: "1000" },
        { entry_type: "promotion_cost", amount_minor: "-1000" },
        { entry_type: "commission_reversed", amount_minor: "-1000" },
        { entry_type: "promotion_cost_reversed", amount_minor: "1000" },
      ]);
      // Luxora's result on a fully refunded order is zero.
      expect(ledger.reduce((sum, e) => sum + Number(e.amount_minor), 0)).toBe(0);
    } finally {
      await setSetting("refunds.vendor_liability", "none");
    }
  });
});

// -----------------------------------------------------------------------------
// Concurrency helpers: two API sessions on separate connections.
// -----------------------------------------------------------------------------
async function openApiClient(user: TestUser): Promise<pg.PoolClient> {
  const client = await pool.connect();
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: user.userId, role: "authenticated", email: user.email }),
  ]);
  return client;
}

/** Runs place_order on an API connection; returns "ok" or the error message (transaction left open). */
async function callPlaceOrder(client: pg.PoolClient, addressId: string, expected: number | null = null) {
  try {
    await client.query("select public.place_order($1, $1, $2, $3)", [addressId, randomUUID(), expected]);
    return "ok";
  } catch (error) {
    return (error as Error).message;
  }
}

/**
 * Two shoppers check out at the same time: the first places its order and
 * holds its locks; the second starts while the first is still open (and
 * waits), then the first commits.
 */
async function race(
  first: { customer: TestUser; addressId: string },
  second: { customer: TestUser; addressId: string },
  expected: number | null = null,
) {
  const a = await openApiClient(first.customer);
  const b = await openApiClient(second.customer);
  try {
    const firstResult = await callPlaceOrder(a, first.addressId, expected);
    const secondPromise = callPlaceOrder(b, second.addressId, expected);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await a.query("commit");
    const secondResult = await secondPromise;
    await b.query(secondResult === "ok" ? "commit" : "rollback");
    return { first: firstResult, second: secondResult };
  } finally {
    await a.query("rollback").catch(() => undefined);
    await b.query("rollback").catch(() => undefined);
    a.release();
    b.release();
  }
}
