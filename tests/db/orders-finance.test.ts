import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  SQLSTATE,
  type Session,
  type TestUser,
} from "./harness";

const pool = createPool();
let customer: TestUser;
let otherCustomer: TestUser;
let ownerA: TestUser;
let ownerB: TestUser;
let admin: TestUser;
let vendorA: string;
let vendorB: string;
let variantA: string;
let variantB: string;
let orderId: string;
let vendorOrderA: string;
let vendorOrderB: string;

const address = {
  full_name: "Test Customer",
  line1: "1 Rue de Rivoli",
  city: "Paris",
  postal_code: "75001",
  country_code: "FR",
};

/**
 * Creates a two-vendor order the way the server-side checkout will:
 * one parent order, one vendor order per vendor, items linked to both.
 */
async function createMultiVendorOrder(s: Session) {
  const rateA = 1500; // from platform default
  const rateB = 1000; // vendor B override
  const subtotalA = 2 * 12_000;
  const subtotalB = 1 * 30_000;
  const commissionA = Math.floor((subtotalA * rateA + 5000) / 10000);
  const commissionB = Math.floor((subtotalB * rateB + 5000) / 10000);

  const order = await s.one<{ id: string; order_number: string }>(
    `insert into public.orders (customer_id, currency, subtotal_minor, shipping_minor, total_minor, customer_email, shipping_address, billing_address)
     values ($1, 'USD', $2, 1000, $3, $4, $5, $5) returning id, order_number`,
    [customer.profileId, subtotalA + subtotalB, subtotalA + subtotalB + 1000, customer.email, JSON.stringify(address)],
  );
  const voA = await s.one<{ id: string }>(
    // Vendor order A is paid ('confirmed') so the fulfilment test can ship it.
    `insert into public.vendor_orders (order_id, vendor_id, vendor_order_number, status, currency, subtotal_minor, shipping_minor, total_minor,
        commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor)
     values ($1, $2, $3, 'confirmed', 'USD', $4, 1000, $5, $6, $7, 0, $8) returning id`,
    [
      order.id,
      vendorA,
      `${order.order_number}-A`,
      subtotalA,
      subtotalA + 1000,
      rateA,
      commissionA,
      subtotalA + 1000 - commissionA,
    ],
  );
  const voB = await s.one<{ id: string }>(
    `insert into public.vendor_orders (order_id, vendor_id, vendor_order_number, currency, subtotal_minor, total_minor,
        commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor)
     values ($1, $2, $3, 'USD', $4, $4, $5, $6, 0, $7) returning id`,
    [order.id, vendorB, `${order.order_number}-B`, subtotalB, rateB, commissionB, subtotalB - commissionB],
  );
  await s.query(
    `insert into public.order_items (order_id, vendor_order_id, vendor_id, variant_id, product_name, variant_title, sku, quantity, unit_price_minor, total_minor)
     values ($1, $2, $3, $4, 'Coat', 'Default', 'SKU-A', 2, 12000, 24000),
            ($1, $5, $6, $7, 'Bag', 'Default', 'SKU-B', 1, 30000, 30000)`,
    [order.id, voA.id, vendorA, variantA, voB.id, vendorB, variantB],
  );
  await s.query(
    `insert into public.payments (order_id, provider, provider_payment_id, status, currency, amount_minor, fee_minor)
     values ($1, 'stripe', $2, 'paid', 'USD', $3, 1870)`,
    [order.id, `pi_${randomUUID()}`, subtotalA + subtotalB + 1000],
  );
  return { orderId: order.id, voA: voA.id, voB: voB.id };
}

beforeAll(async () => {
  customer = await createUser(pool);
  otherCustomer = await createUser(pool);
  ownerA = await createUser(pool);
  ownerB = await createUser(pool);
  admin = await createUser(pool, { role: "admin" });
  ({ vendorId: vendorA } = await createApprovedVendor(pool, ownerA));
  ({ vendorId: vendorB } = await createApprovedVendor(pool, ownerB, { commissionBps: 1000 }));
  ({ variantId: variantA } = await createActiveProduct(pool, vendorA, { priceMinor: 12_000, stock: 10 }));
  ({ variantId: variantB } = await createActiveProduct(pool, vendorB, { priceMinor: 30_000, stock: 10 }));
  ({ orderId, voA: vendorOrderA, voB: vendorOrderB } = await asService(pool, createMultiVendorOrder, true));
});

afterAll(() => pool.end());

describe("multi-vendor order model", () => {
  it("creates one parent order with one vendor order per vendor", async () => {
    const { rows } = await pool.query(
      "select count(*)::int as vendor_orders, sum(total_minor)::bigint as sum_total from public.vendor_orders where order_id = $1",
      [orderId],
    );
    expect(rows[0].vendor_orders).toBe(2);
    const order = await pool.query("select total_minor, order_number from public.orders where id = $1", [orderId]);
    expect(Number(rows[0].sum_total)).toBe(Number(order.rows[0].total_minor));
    expect(order.rows[0].order_number).toMatch(/^LX-\d{6}-\d{6}$/);
  });

  it("enforces financial invariants with check constraints", async () => {
    await asService(pool, async (s) => {
      await s.fails(
        SQLSTATE.checkViolation,
        `insert into public.orders (customer_id, currency, subtotal_minor, total_minor, customer_email, shipping_address, billing_address)
           values ($1, 'USD', 1000, 999, $2, '{}', '{}')`,
        [customer.profileId, customer.email],
      );
    });
    await asService(pool, async (s) => {
      await s.fails(
        SQLSTATE.checkViolation,
        `insert into public.vendor_orders (order_id, vendor_id, vendor_order_number, currency, subtotal_minor, total_minor,
              commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor)
           values ($1, $2, 'bad-earnings', 'USD', 1000, 1000, 1000, 100, 0, 999)`,
        [orderId, vendorA],
      );
    });
  });

  it("rejects an order item whose vendor order belongs to a different order or vendor", async () => {
    await asService(pool, async (s) => {
      await s.fails(
        SQLSTATE.checkViolation,
        `insert into public.order_items (order_id, vendor_order_id, vendor_id, product_name, variant_title, sku, quantity, unit_price_minor, total_minor)
           values ($1, $2, $3, 'X', 'X', 'X', 1, 100, 100)`,
        [orderId, vendorOrderA, vendorB],
      );
    });
  });

  it("lets the customer see their order, all vendor orders, items and payment", async () => {
    await asUser(pool, customer, async (s) => {
      const orders = await s.rows("select id from public.orders");
      expect(orders).toEqual([{ id: orderId }]);
      const vendorOrders = await s.rows("select id from public.vendor_orders order by vendor_order_number");
      expect(vendorOrders).toHaveLength(2);
      const items = await s.rows("select sku from public.order_items order by sku");
      expect(items).toEqual([{ sku: "SKU-A" }, { sku: "SKU-B" }]);
      const payments = await s.rows("select status from public.payments");
      expect(payments).toEqual([{ status: "paid" }]);
    });
  });

  it("hides the order from other customers", async () => {
    await asUser(pool, otherCustomer, async (s) => {
      expect(await s.rows("select id from public.orders")).toEqual([]);
      expect(await s.rows("select id from public.order_items")).toEqual([]);
    });
  });

  it("shows each vendor only their own vendor order and items, never payments", async () => {
    await asUser(pool, ownerA, async (s) => {
      const vendorOrders = await s.rows("select id from public.vendor_orders");
      expect(vendorOrders).toEqual([{ id: vendorOrderA }]);
      const items = await s.rows("select sku from public.order_items");
      expect(items).toEqual([{ sku: "SKU-A" }]);
      // Phase 3: the parent order carries other vendors' totals, so vendors cannot read it.
      const parent = await s.rows("select id, customer_email from public.orders");
      expect(parent).toEqual([]);
      expect(await s.rows("select * from public.payments")).toEqual([]);
    });
    await asUser(pool, ownerB, async (s) => {
      const vendorOrders = await s.rows("select id from public.vendor_orders");
      expect(vendorOrders).toEqual([{ id: vendorOrderB }]);
    });
  });

  it("lets a vendor update fulfilment but not financial fields or disallowed statuses", async () => {
    await asUser(pool, ownerA, async (s) => {
      const ok = await s.query(
        "update public.vendor_orders set status = 'shipped', carrier = 'DHL', tracking_number = 'JD0001', shipped_at = now() where id = $1",
        [vendorOrderA],
      );
      expect(ok.rowCount).toBe(1);
      await s.denied("update public.vendor_orders set commission_minor = 0 where id = $1", [vendorOrderA]);
    });
    await asUser(pool, ownerA, async (s) => {
      await s.denied("update public.vendor_orders set status = 'refunded' where id = $1", [vendorOrderA]);
    });
    await asUser(pool, ownerA, async (s) => {
      const ok = await s.query("update public.order_items set fulfilled_quantity = 2 where vendor_order_id = $1", [
        vendorOrderA,
      ]);
      expect(ok.rowCount).toBe(1);
      await s.denied("update public.order_items set unit_price_minor = 1 where vendor_order_id = $1", [vendorOrderA]);
    });
  });

  it("gives admins full visibility and lets them record refunds", async () => {
    await asUser(pool, admin, async (s) => {
      expect(await s.rows("select id from public.vendor_orders where order_id = $1", [orderId])).toHaveLength(2);
      const payment = await s.one<{ id: string }>("select id from public.payments where order_id = $1", [orderId]);
      const refund = await s.one<{ status: string }>(
        `insert into public.refunds (order_id, vendor_order_id, payment_id, currency, amount_minor, commission_reversed_minor, vendor_debit_minor, reason, requested_by)
         values ($1, $2, $3, 'USD', 12000, 1800, 10200, 'Damaged on arrival', public.current_profile_id()) returning status`,
        [orderId, vendorOrderA, payment.id],
      );
      expect(refund.status).toBe("requested");
      await s.fails(
        SQLSTATE.checkViolation,
        `insert into public.refunds (order_id, vendor_order_id, payment_id, currency, amount_minor, commission_reversed_minor, vendor_debit_minor, reason)
           values ($1, $2, $3, 'USD', 100, 90, 20, 'Split exceeds amount')`,
        [orderId, vendorOrderA, payment.id],
      );
    });
  });

  it("lets a customer request a return on their own item only", async () => {
    await asUser(pool, customer, async (s) => {
      const item = await s.one<{ id: string }>("select id from public.order_items where sku = 'SKU-A'");
      const row = await s.one<{ status: string }>(
        `insert into public.returns (order_id, vendor_order_id, order_item_id, customer_id, vendor_id, quantity, reason)
         values ($1, $2, $3, public.current_profile_id(), $4, 1, 'Wrong size') returning status`,
        [orderId, vendorOrderA, item.id, vendorA],
      );
      expect(row.status).toBe("requested");
    });
    await asUser(pool, otherCustomer, async (s) => {
      const { rows } = await pool.query("select id from public.order_items where sku = 'SKU-A'");
      await s.denied(
        `insert into public.returns (order_id, vendor_order_id, order_item_id, customer_id, vendor_id, quantity, reason)
           values ($1, $2, $3, public.current_profile_id(), $4, 1, 'Not my order')`,
        [orderId, vendorOrderA, rows[0].id, vendorA],
      );
    });
  });
});

describe("commission resolution", () => {
  it("falls back to the platform default when no rule matches", async () => {
    const { rows } = await pool.query("select public.resolve_commission_rate_bps($1, null) as bps", [vendorA]);
    expect(rows[0].bps).toBe(1500);
  });

  it("prefers the vendor override column over the default", async () => {
    const { rows } = await pool.query("select public.resolve_commission_rate_bps($1, null) as bps", [vendorB]);
    expect(rows[0].bps).toBe(1000);
  });

  it("walks up the category tree for category rates", async () => {
    const parent = await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, commission_rate_bps) values ('women', 'Women', 1200) returning id",
    );
    const child = await pool.query<{ id: string }>(
      "insert into public.categories (parent_id, slug, name) values ($1, 'women-coats', 'Coats') returning id",
      [parent.rows[0].id],
    );
    const { rows } = await pool.query("select public.resolve_commission_rate_bps($1, $2) as bps", [
      vendorA,
      child.rows[0].id,
    ]);
    expect(rows[0].bps).toBe(1200);
  });

  it("prefers an active vendor rule over everything else", async () => {
    await pool.query(
      "insert into public.commission_rules (scope, vendor_id, rate_bps, name) values ('vendor', $1, 800, 'Launch partner rate')",
      [vendorB],
    );
    const { rows } = await pool.query("select public.resolve_commission_rate_bps($1, null) as bps", [vendorB]);
    expect(rows[0].bps).toBe(800);
  });

  it("uses an active global rule before the platform setting", async () => {
    await pool.query("insert into public.commission_rules (scope, rate_bps, name) values ('global', 1800, 'Standard')");
    const { rows } = await pool.query("select public.resolve_commission_rate_bps($1, null) as bps", [vendorA]);
    expect(rows[0].bps).toBe(1800);
    await pool.query("delete from public.commission_rules where scope = 'global'");
  });

  it("computes commission deterministically with round-half-up", async () => {
    const { rows } = await pool.query(
      `select public.calculate_commission_minor(10000, 1500) as a,
              public.calculate_commission_minor(999, 1500) as b,
              public.calculate_commission_minor(1, 5000) as c,
              public.calculate_commission_minor(0, 1500) as d`,
    );
    expect(rows[0]).toEqual({ a: "1500", b: "150", c: "1", d: "0" });
  });

  it("hides vendor-specific rules from other vendors", async () => {
    const rowsA = await asUser(pool, ownerA, (s) =>
      s.rows<{ scope: string }>("select scope from public.commission_rules"),
    );
    expect(rowsA.find((r) => r.scope === "vendor")).toBeUndefined();
    const rowsB = await asUser(pool, ownerB, (s) =>
      s.rows<{ scope: string }>("select scope from public.commission_rules"),
    );
    expect(rowsB.map((r) => r.scope)).toContain("vendor");
  });
});
