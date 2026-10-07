import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  expectSqlError,
  SQLSTATE,
  TEST_DATABASE_URL,
  withSession,
  type TestUser,
} from "./harness";

const pool = createPool();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
async function addAddress(user: TestUser, overrides: Partial<{ type: string; fullName: string; city: string }> = {}) {
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.addresses (profile_id, type, full_name, line1, city, postal_code, country_code)
     values ($1, $2, $3, '12 Rue Saint-Honoré', $4, '75001', 'FR') returning id`,
    [user.profileId, overrides.type ?? "both", overrides.fullName ?? "Test Customer", overrides.city ?? "Paris"],
  );
  return rows[0].id;
}

async function addToCart(user: TestUser, variantId: string, quantity = 1) {
  return asUser(
    pool,
    user,
    (s) => s.one<{ qty: number }>("select public.add_to_cart($1, $2) as qty", [variantId, quantity]),
    true,
  );
}

async function placeOrder(
  user: TestUser,
  addressId: string,
  options: { token?: string; expectedTotal?: number | null; note?: string } = {},
) {
  const row = await asUser(
    pool,
    user,
    (s) =>
      s.one<{ id: string }>("select public.place_order($1, $1, $2, $3, $4) as id", [
        addressId,
        options.token ?? randomUUID(),
        options.expectedTotal ?? null,
        options.note ?? null,
      ]),
    true,
  );
  return row.id;
}

async function inventoryOf(variantId: string) {
  const { rows } = await pool.query<{ stock_quantity: number; reserved_quantity: number; available_quantity: number }>(
    "select stock_quantity, reserved_quantity, available_quantity from public.inventory where variant_id = $1",
    [variantId],
  );
  return rows[0];
}

async function newVendor(commissionBps: number) {
  const owner = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner, { commissionBps });
  return { owner, vendorId };
}

afterAll(() => pool.end());

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
describe("cart", () => {
  let customer: TestUser;
  let vendorId: string;

  beforeAll(async () => {
    customer = await createUser(pool);
    ({ vendorId } = await newVendor(1000));
  });

  it("prices items from the database and never accepts client prices", async () => {
    const { variantId } = await createActiveProduct(pool, vendorId, { priceMinor: 4_500, stock: 10 });
    expect((await addToCart(customer, variantId, 2)).qty).toBe(2);
    expect((await addToCart(customer, variantId, 1)).qty).toBe(3);

    await asUser(pool, customer, async (s) => {
      const lines = await s.rows<{
        unit_price_minor: string;
        line_total_minor: string;
        quantity: number;
        purchasable: boolean;
      }>(
        "select unit_price_minor, line_total_minor, quantity, purchasable from public.cart_lines() where variant_id = $1",
        [variantId],
      );
      expect(lines).toEqual([{ unit_price_minor: "4500", line_total_minor: "13500", quantity: 3, purchasable: true }]);

      // Direct writes are revoked: prices cannot be injected.
      const cart = await s.one<{ id: string }>("select id from public.carts where status = 'active'");
      await s.denied(
        "insert into public.cart_items (cart_id, variant_id, quantity, unit_price_minor) values ($1, $2, 1, 1)",
        [cart.id, variantId],
      );
      await s.denied("update public.cart_items set unit_price_minor = 1");
      await s.denied("update public.carts set currency = 'EUR'");
    });
  });

  it("re-prices lines when the catalog price changes", async () => {
    const shopper = await createUser(pool);
    const { variantId } = await createActiveProduct(pool, vendorId, { priceMinor: 10_000, stock: 5 });
    await addToCart(shopper, variantId, 1);
    await pool.query("update public.product_variants set price_minor = 12_500 where id = $1", [variantId]);
    const lines = await asUser(pool, shopper, (s) =>
      s.rows<{ unit_price_minor: string; added_price_minor: string }>(
        "select unit_price_minor, added_price_minor from public.cart_lines() where variant_id = $1",
        [variantId],
      ),
    );
    expect(lines).toEqual([{ unit_price_minor: "12500", added_price_minor: "10000" }]);
  });

  it("refuses inactive products, inactive variants and suspended vendors", async () => {
    const shopper = await createUser(pool);
    const draft = await createActiveProduct(pool, vendorId, { stock: 5 });
    await pool.query("update public.products set status = 'draft' where id = $1", [draft.productId]);
    const inactiveVariant = await createActiveProduct(pool, vendorId, { stock: 5 });
    await pool.query("update public.product_variants set is_active = false where id = $1", [inactiveVariant.variantId]);
    const { vendorId: suspendedVendor } = await newVendor(1000);
    const suspended = await createActiveProduct(pool, suspendedVendor, { stock: 5 });
    await pool.query("update public.vendors set status = 'suspended' where id = $1", [suspendedVendor]);

    await asUser(pool, shopper, async (s) => {
      for (const variantId of [draft.variantId, inactiveVariant.variantId, suspended.variantId]) {
        const error = await s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 1)", [variantId]);
        expect(error.message).toBe("This item is no longer available.");
      }
    });
  });

  it("enforces stock, quantity limits and a single currency per bag", async () => {
    const shopper = await createUser(pool);
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 2 });
    const unlimited = await createActiveProduct(pool, vendorId, { stock: 500 });
    const euro = await createActiveProduct(pool, vendorId, { stock: 5 });
    // Phase 4b: products can only be priced in the platform currency…
    await expectSqlError(
      pool.query("update public.products set currency = 'EUR' where id = $1", [euro.productId]),
      SQLSTATE.raiseException,
    );
    // …so simulate a legacy non-USD product to keep testing the bag's own guard.
    await pool.query("alter table public.products disable trigger products_enforce_platform_currency");
    try {
      await pool.query("update public.products set currency = 'EUR' where id = $1", [euro.productId]);
    } finally {
      await pool.query("alter table public.products enable trigger products_enforce_platform_currency");
    }

    await asUser(pool, shopper, async (s) => {
      const tooMany = await s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 3)", [variantId]);
      expect(tooMany.message).toMatch(/^Only 2 of ".+" available\.$/);
      await s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 100)", [unlimited.variantId]);
      await s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 0)", [variantId]);
      await s.query("select public.add_to_cart($1, 2)", [variantId]);
      const mixed = await s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 1)", [euro.variantId]);
      expect(mixed.message).toContain("priced in USD");
    });
  });

  it("updates quantities, removes items and clears the bag", async () => {
    const shopper = await createUser(pool);
    const a = await createActiveProduct(pool, vendorId, { stock: 10 });
    const b = await createActiveProduct(pool, vendorId, { stock: 10 });
    await addToCart(shopper, a.variantId, 1);
    await addToCart(shopper, b.variantId, 1);

    await asUser(
      pool,
      shopper,
      async (s) => {
        const [lineA] = await s.rows<{ cart_item_id: string }>(
          "select cart_item_id from public.cart_lines() where variant_id = $1",
          [a.variantId],
        );
        await s.query("select public.set_cart_item_quantity($1, 4)", [lineA.cart_item_id]);
        await s.fails(SQLSTATE.raiseException, "select public.set_cart_item_quantity($1, 11)", [lineA.cart_item_id]);
        const [lineB] = await s.rows<{ cart_item_id: string }>(
          "select cart_item_id from public.cart_lines() where variant_id = $1",
          [b.variantId],
        );
        await s.query("select public.remove_cart_item($1)", [lineB.cart_item_id]);
        const lines = await s.rows<{ variant_id: string; quantity: number }>(
          "select variant_id, quantity from public.cart_lines()",
        );
        expect(lines).toEqual([{ variant_id: a.variantId, quantity: 4 }]);
        await s.query("select public.clear_cart()");
        expect(await s.rows("select 1 from public.cart_lines()")).toEqual([]);
      },
      true,
    );
  });

  it("isolates carts between customers", async () => {
    const owner = await createUser(pool);
    const intruder = await createUser(pool);
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 10 });
    await addToCart(owner, variantId, 1);
    const [line] = await asUser(pool, owner, (s) =>
      s.rows<{ cart_item_id: string }>("select cart_item_id from public.cart_lines()"),
    );

    await asUser(pool, intruder, async (s) => {
      expect(await s.rows("select 1 from public.cart_lines()")).toEqual([]);
      expect(await s.rows("select 1 from public.cart_items")).toEqual([]);
      expect(await s.rows("select 1 from public.carts where profile_id = $1", [owner.profileId])).toEqual([]);
      await s.fails(SQLSTATE.noDataFound, "select public.set_cart_item_quantity($1, 5)", [line.cart_item_id]);
      await s.query("select public.remove_cart_item($1)", [line.cart_item_id]);
    });
    const still = await asUser(pool, owner, (s) => s.rows("select 1 from public.cart_lines()"));
    expect(still).toHaveLength(1);
    await asAnon(pool, async (s) => {
      await s.denied("select public.add_to_cart($1, 1)", [variantId]);
    });
  });
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------
describe("addresses", () => {
  it("are visible and editable only by their owner (and readable by admins)", async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);
    const admin = await createUser(pool, { role: "admin" });
    const addressId = await addAddress(owner);

    await asUser(pool, other, async (s) => {
      expect(await s.rows("select 1 from public.addresses where id = $1", [addressId])).toEqual([]);
      const result = await s.query("update public.addresses set city = 'Hacked' where id = $1", [addressId]);
      expect(result.rowCount).toBe(0);
      await s.denied(
        `insert into public.addresses (profile_id, full_name, line1, city, postal_code, country_code)
         values ($1, 'X', 'Y', 'Z', '1', 'FR')`,
        [owner.profileId],
      );
    });
    await asUser(pool, owner, async (s) => {
      const result = await s.query("update public.addresses set city = 'Lyon' where id = $1", [addressId]);
      expect(result.rowCount).toBe(1);
    });
    const adminRows = await asUser(pool, admin, (s) =>
      s.rows("select 1 from public.addresses where id = $1", [addressId]),
    );
    expect(adminRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
describe("place_order", () => {
  it("splits a multi-vendor bag into vendor orders priced from the database", async () => {
    const customer = await createUser(pool);
    const { vendorId: vendorA } = await newVendor(1000);
    const { vendorId: vendorB } = await newVendor(2000);
    const a = await createActiveProduct(pool, vendorA, { priceMinor: 12_345, stock: 10 });
    const b = await createActiveProduct(pool, vendorB, { priceMinor: 9_999, stock: 10 });
    const addressId = await addAddress(customer);
    await addToCart(customer, a.variantId, 2);
    await addToCart(customer, b.variantId, 1);

    const token = randomUUID();
    const orderId = await placeOrder(customer, addressId, { token, expectedTotal: 34_689, note: "Gift wrap please" });

    const order = (
      await pool.query(
        "select status, payment_status, currency, subtotal_minor, total_minor, customer_email, customer_note, shipping_address, reservation_expires_at from public.orders where id = $1",
        [orderId],
      )
    ).rows[0];
    expect(order).toMatchObject({
      status: "pending",
      payment_status: "pending",
      currency: "USD",
      subtotal_minor: "34689",
      total_minor: "34689",
      customer_email: customer.email,
      customer_note: "Gift wrap please",
      shipping_address: {
        full_name: "Test Customer",
        line1: "12 Rue Saint-Honoré",
        city: "Paris",
        postal_code: "75001",
        country_code: "FR",
      },
    });
    expect(order.reservation_expires_at).not.toBeNull();

    const vendorOrders = (
      await pool.query(
        `select vendor_id, status, subtotal_minor, total_minor, commission_minor, payment_fee_minor, vendor_earnings_minor, shipping_address->>'city' as city
         from public.vendor_orders where order_id = $1 order by vendor_order_number`,
        [orderId],
      )
    ).rows;
    const byVendor = Object.fromEntries(vendorOrders.map((vo) => [vo.vendor_id, vo]));
    // A: 2 × 12 345 = 24 690; 10 % → 2 469 (2 469.0). B: 9 999; 20 % → 2 000 (1 999.8 rounds half up).
    expect(byVendor[vendorA]).toMatchObject({
      status: "pending",
      total_minor: "24690",
      commission_minor: "2469",
      payment_fee_minor: "0",
      vendor_earnings_minor: "22221",
      city: "Paris",
    });
    expect(byVendor[vendorB]).toMatchObject({
      status: "pending",
      total_minor: "9999",
      commission_minor: "2000",
      vendor_earnings_minor: "7999",
    });
    expect(vendorOrders.reduce((sum, vo) => sum + Number(vo.total_minor), 0)).toBe(34_689);

    const items = (
      await pool.query(
        "select vendor_id, quantity, unit_price_minor, total_minor, commission_rate_bps, commission_minor from public.order_items where order_id = $1 order by unit_price_minor desc",
        [orderId],
      )
    ).rows;
    expect(items).toEqual([
      {
        vendor_id: vendorA,
        quantity: 2,
        unit_price_minor: "12345",
        total_minor: "24690",
        commission_rate_bps: 1000,
        commission_minor: "2469",
      },
      {
        vendor_id: vendorB,
        quantity: 1,
        unit_price_minor: "9999",
        total_minor: "9999",
        commission_rate_bps: 2000,
        commission_minor: "2000",
      },
    ]);

    // Stock is reserved, not sold.
    expect(await inventoryOf(a.variantId)).toEqual({ stock_quantity: 10, reserved_quantity: 2, available_quantity: 8 });
    expect(await inventoryOf(b.variantId)).toEqual({ stock_quantity: 10, reserved_quantity: 1, available_quantity: 9 });

    // The bag is converted; the same token replays to the same order.
    expect(await asUser(pool, customer, (s) => s.rows("select 1 from public.cart_lines()"))).toEqual([]);
    expect(await placeOrder(customer, addressId, { token })).toBe(orderId);
    const count = await pool.query("select count(*)::int as n from public.orders where customer_id = $1", [
      customer.profileId,
    ]);
    expect(count.rows[0].n).toBe(1);
  });

  it("rejects a stale client total and uses current database prices", async () => {
    const customer = await createUser(pool);
    const { vendorId } = await newVendor(1000);
    const { variantId } = await createActiveProduct(pool, vendorId, { priceMinor: 5_000, stock: 5 });
    const addressId = await addAddress(customer);
    await addToCart(customer, variantId, 1);
    await pool.query("update public.product_variants set price_minor = 6_000 where id = $1", [variantId]);

    await asUser(pool, customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2, 5000)", [
        addressId,
        randomUUID(),
      ]);
      expect(error.message).toContain("Prices or shipping costs have changed");
    });
    const orderId = await placeOrder(customer, addressId, { expectedTotal: 6_000 });
    const { rows } = await pool.query("select total_minor from public.orders where id = $1", [orderId]);
    expect(rows[0].total_minor).toBe("6000");
  });

  it("keeps historical order prices when the catalog changes, and locks financial snapshots", async () => {
    const customer = await createUser(pool);
    const admin = await createUser(pool, { role: "admin" });
    const { vendorId, owner } = await newVendor(1000);
    const { variantId, productId } = await createActiveProduct(pool, vendorId, { priceMinor: 20_000, stock: 5 });
    const addressId = await addAddress(customer);
    await addToCart(customer, variantId, 1);
    const orderId = await placeOrder(customer, addressId);

    await pool.query("update public.product_variants set price_minor = 99_000, title = 'Renamed' where id = $1", [
      variantId,
    ]);
    await pool.query("update public.products set name = 'Renamed product' where id = $1", [productId]);
    await pool.query("update public.addresses set city = 'Berlin' where id = $1", [addressId]);

    const item = (
      await pool.query(
        "select unit_price_minor, total_minor, variant_title, product_name from public.order_items where order_id = $1",
        [orderId],
      )
    ).rows[0];
    expect(item.unit_price_minor).toBe("20000");
    expect(item.total_minor).toBe("20000");
    expect(item.variant_title).toBe("Default");
    expect(item.product_name).not.toBe("Renamed product");
    const order = (
      await pool.query("select total_minor, shipping_address->>'city' as city from public.orders where id = $1", [
        orderId,
      ])
    ).rows[0];
    expect(order).toEqual({ total_minor: "20000", city: "Paris" });

    // Nobody on the API side can rewrite money: not the vendor, not an admin, not the service role.
    await asUser(pool, owner, async (s) => {
      await s.denied("update public.order_items set unit_price_minor = 1 where order_id = $1", [orderId]);
      await s.denied("update public.vendor_orders set commission_minor = 0 where order_id = $1", [orderId]);
    });
    await asUser(pool, admin, async (s) => {
      await s.denied("update public.orders set total_minor = 1, subtotal_minor = 1 where id = $1", [orderId]);
    });
    await asService(pool, async (s) => {
      await s.denied("update public.orders set total_minor = 1, subtotal_minor = 1 where id = $1", [orderId]);
      await s.denied("update public.order_items set unit_price_minor = 1, total_minor = 1 where order_id = $1", [
        orderId,
      ]);
      await s.denied(
        "update public.vendor_orders set payment_fee_minor = 5, vendor_earnings_minor = vendor_earnings_minor - 5 where order_id = $1",
        [orderId],
      );
    });
  });

  it("refuses products that became unavailable after being added", async () => {
    const customer = await createUser(pool);
    const { vendorId } = await newVendor(1000);
    const live = await createActiveProduct(pool, vendorId, { stock: 5 });
    const pulled = await createActiveProduct(pool, vendorId, { stock: 5 });
    const addressId = await addAddress(customer);
    await addToCart(customer, live.variantId, 1);
    await addToCart(customer, pulled.variantId, 1);
    await pool.query("update public.products set status = 'archived' where id = $1", [pulled.productId]);

    await asUser(pool, customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        addressId,
        randomUUID(),
      ]);
      expect(error.message).toContain("is no longer available");
    });
    expect((await inventoryOf(live.variantId)).reserved_quantity).toBe(0);
    const orders = await pool.query("select 1 from public.orders where customer_id = $1", [customer.profileId]);
    expect(orders.rowCount).toBe(0);
  });

  it("rejects checkout beyond available stock without reserving anything", async () => {
    const customer = await createUser(pool);
    const { vendorId } = await newVendor(1000);
    const a = await createActiveProduct(pool, vendorId, { stock: 5 });
    const b = await createActiveProduct(pool, vendorId, { stock: 3 });
    const addressId = await addAddress(customer);
    await addToCart(customer, a.variantId, 2);
    await addToCart(customer, b.variantId, 3);
    await pool.query("select public.adjust_inventory($1, -2, 'damaged')", [b.variantId]);

    await asUser(pool, customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        addressId,
        randomUUID(),
      ]);
      expect(error.message).toMatch(/^Only 1 of ".+" left in stock/);
    });
    expect(await inventoryOf(a.variantId)).toMatchObject({ reserved_quantity: 0 });
    expect(await inventoryOf(b.variantId)).toEqual({ stock_quantity: 1, reserved_quantity: 0, available_quantity: 1 });
  });

  it("rejects addresses that belong to someone else or have the wrong type", async () => {
    const customer = await createUser(pool);
    const stranger = await createUser(pool);
    const { vendorId } = await newVendor(1000);
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 5 });
    await addToCart(customer, variantId, 1);
    const strangersAddress = await addAddress(stranger);
    const billingOnly = await addAddress(customer, { type: "billing" });
    await asUser(pool, customer, async (s) => {
      await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [strangersAddress, randomUUID()]);
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        billingOnly,
        randomUUID(),
      ]);
      expect(error.message).toBe("Choose a valid shipping address.");
    });
  });

  it("never oversells under concurrent checkouts", async () => {
    const { vendorId } = await newVendor(1000);
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 3 });
    const buyers = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const user = await createUser(pool);
        const addressId = await addAddress(user);
        await addToCart(user, variantId, 1);
        return { user, addressId };
      }),
    );

    const racePool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 8 });
    try {
      const results = await Promise.allSettled(
        buyers.map(({ user, addressId }) =>
          withSession(racePool, { role: "authenticated", user, commit: true }, (s) =>
            s.one<{ id: string }>("select public.place_order($1, $1, $2) as id", [addressId, randomUUID()]),
          ),
        ),
      );
      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(succeeded).toHaveLength(3);
      expect(failed).toHaveLength(5);
      for (const failure of failed) {
        expect((failure.reason as pg.DatabaseError).code).toBe(SQLSTATE.raiseException);
      }
    } finally {
      await racePool.end();
    }
    expect(await inventoryOf(variantId)).toEqual({ stock_quantity: 3, reserved_quantity: 3, available_quantity: 0 });
  });
});

// ---------------------------------------------------------------------------
// Expiry, cancellation and payment confirmation
// ---------------------------------------------------------------------------
describe("reservation lifecycle", () => {
  async function pendingOrder(stock = 5, quantity = 2) {
    const customer = await createUser(pool);
    const { vendorId, owner } = await newVendor(1000);
    const product = await createActiveProduct(pool, vendorId, { priceMinor: 10_000, stock });
    const addressId = await addAddress(customer);
    await addToCart(customer, product.variantId, quantity);
    const orderId = await placeOrder(customer, addressId);
    return { customer, owner, vendorId, orderId, addressId, ...product };
  }

  it("releases stock when an unpaid checkout expires, exactly once", async () => {
    const { orderId, variantId } = await pendingOrder();
    expect((await inventoryOf(variantId)).reserved_quantity).toBe(2);
    await pool.query("update public.orders set reservation_expires_at = now() - interval '1 minute' where id = $1", [
      orderId,
    ]);

    const first = await asService(
      pool,
      (s) => s.one<{ n: number }>("select public.expire_stale_checkouts() as n"),
      true,
    );
    expect(first.n).toBeGreaterThanOrEqual(1);
    const second = await asService(
      pool,
      (s) => s.one<{ n: number }>("select public.expire_stale_checkouts(array[$1]::uuid[]) as n", [variantId]),
      true,
    );
    expect(second.n).toBe(0);

    expect(await inventoryOf(variantId)).toEqual({ stock_quantity: 5, reserved_quantity: 0, available_quantity: 5 });
    const order = (
      await pool.query("select status, payment_status, cancellation_reason from public.orders where id = $1", [orderId])
    ).rows[0];
    expect(order).toEqual({
      status: "cancelled",
      payment_status: "expired",
      cancellation_reason: "checkout_expired",
    });
    const vendorOrders = await pool.query("select status from public.vendor_orders where order_id = $1", [orderId]);
    expect(vendorOrders.rows).toEqual([{ status: "cancelled" }]);
  });

  it("lets a new checkout reclaim stock held by an expired one", async () => {
    const { orderId, variantId } = await pendingOrder(2, 2);
    await pool.query("update public.orders set reservation_expires_at = now() - interval '1 minute' where id = $1", [
      orderId,
    ]);
    const nextBuyer = await createUser(pool);
    const addressId = await addAddress(nextBuyer);
    // add_to_cart sees no available stock until the stale reservation is released…
    await asUser(pool, nextBuyer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.add_to_cart($1, 1)", [variantId]),
    );
    await asService(pool, (s) => s.query("select public.expire_stale_checkouts()"), true);
    await addToCart(nextBuyer, variantId, 2);
    // …and place_order also expires stale reservations for the items it touches.
    const { orderId: second } = { orderId: await placeOrder(nextBuyer, addressId) };
    expect(second).toBeTruthy();
    expect(await inventoryOf(variantId)).toEqual({ stock_quantity: 2, reserved_quantity: 2, available_quantity: 0 });
  });

  it("lets the customer cancel their own pending order, not someone else's", async () => {
    const { orderId, variantId } = await pendingOrder();
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.cancel_pending_order($1)", [orderId]),
    );
    const { rows: owners } = await pool.query<{ customer_id: string }>(
      "select customer_id from public.orders where id = $1",
      [orderId],
    );
    const { rows: users } = await pool.query<{ user_id: string; id: string }>(
      "select user_id, id from public.profiles where id = $1",
      [owners[0].customer_id],
    );
    const customer: TestUser = { userId: users[0].user_id, profileId: users[0].id, email: "" };
    await asUser(pool, customer, (s) => s.query("select public.cancel_pending_order($1)", [orderId]), true);
    expect(await inventoryOf(variantId)).toMatchObject({ reserved_quantity: 0, stock_quantity: 5 });
    await asUser(pool, customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.cancel_pending_order($1)", [orderId]),
    );
  });

  it("commits stock and records the payment only through confirm_order_payment", async () => {
    const { orderId, variantId, customer } = await pendingOrder(5, 2);

    // Browsers cannot confirm payments.
    await asUser(pool, customer, (s) =>
      s.denied("select public.confirm_order_payment($1, 'stripe', 'pi_123', 20000, 'USD', 0)", [orderId]),
    );
    // The amount must match the order exactly.
    await asService(pool, (s) =>
      s.fails(SQLSTATE.checkViolation, "select public.confirm_order_payment($1, 'stripe', 'pi_123', 19999, 'USD', 0)", [
        orderId,
      ]),
    );

    await asService(
      pool,
      (s) => s.query("select public.confirm_order_payment($1, 'stripe', 'pi_test_ok', 20000, 'USD', 611)", [orderId]),
      true,
    );

    expect(await inventoryOf(variantId)).toEqual({ stock_quantity: 3, reserved_quantity: 0, available_quantity: 3 });
    const order = (
      await pool.query("select status, payment_status, reservation_expires_at from public.orders where id = $1", [
        orderId,
      ])
    ).rows[0];
    expect(order).toEqual({ status: "confirmed", payment_status: "paid", reservation_expires_at: null });
    const vendorOrder = (
      await pool.query(
        "select status, total_minor, commission_minor, payment_fee_minor, vendor_earnings_minor from public.vendor_orders where order_id = $1",
        [orderId],
      )
    ).rows[0];
    // Phase 4b: the platform bears processing fees, so vendor earnings are untouched.
    expect(vendorOrder).toEqual({
      status: "confirmed",
      total_minor: "20000",
      commission_minor: "2000",
      payment_fee_minor: "0",
      vendor_earnings_minor: "18000",
    });
    const transactions = (
      await pool.query(
        "select t.type, t.amount_minor from public.payment_transactions t join public.payments p on p.id = t.payment_id where p.order_id = $1 order by t.id",
        [orderId],
      )
    ).rows;
    expect(transactions).toEqual([
      { type: "capture", amount_minor: "20000" },
      { type: "fee", amount_minor: "-611" },
    ]);
    const movements = (
      await pool.query(
        "select m.type, m.quantity_delta, m.reference_id from public.inventory_movements m join public.inventory i on i.id = m.inventory_id where i.variant_id = $1",
        [variantId],
      )
    ).rows;
    expect(movements).toEqual([{ type: "sale", quantity_delta: -2, reference_id: orderId }]);

    // Replaying the same payment is a no-op; a second, different payment for the
    // same order is recorded for refund and never commits stock twice.
    const replay = await asService(
      pool,
      (s) =>
        s.one<{ outcome: string }>(
          "select outcome from public.confirm_order_payment($1, 'stripe', 'pi_test_ok', 20000, 'USD', 611)",
          [orderId],
        ),
      true,
    );
    expect(replay.outcome).toBe("duplicate");
    const second = await asService(
      pool,
      (s) =>
        s.one<{ outcome: string }>(
          "select outcome from public.confirm_order_payment($1, 'stripe', 'pi_test_again', 20000, 'USD', 0)",
          [orderId],
        ),
      true,
    );
    expect(second.outcome).toBe("refund_required");
    expect(await inventoryOf(variantId)).toEqual({ stock_quantity: 3, reserved_quantity: 0, available_quantity: 3 });
  });

  it("allocates the payment fee across vendor orders when vendors bear fees", async () => {
    await pool.query("update public.platform_settings set value = '\"vendor\"' where key = 'payments.fee_bearer'");
    try {
      await feeSplitScenario();
    } finally {
      await pool.query("update public.platform_settings set value = '\"platform\"' where key = 'payments.fee_bearer'");
    }
  });

  async function feeSplitScenario() {
    const customer = await createUser(pool);
    const vendors = await Promise.all([newVendor(1000), newVendor(1000), newVendor(1000)]);
    const addressId = await addAddress(customer);
    for (const { vendorId } of vendors) {
      const { variantId } = await createActiveProduct(pool, vendorId, { priceMinor: 3_333, stock: 5 });
      await addToCart(customer, variantId, 1);
    }
    const orderId = await placeOrder(customer, addressId);
    await asService(
      pool,
      (s) => s.query("select public.confirm_order_payment($1, 'stripe', 'pi_split', 9999, 'USD', 100)", [orderId]),
      true,
    );
    const fees = (
      await pool.query<{ payment_fee_minor: string }>(
        "select payment_fee_minor from public.vendor_orders where order_id = $1 order by vendor_order_number",
        [orderId],
      )
    ).rows.map((r) => Number(r.payment_fee_minor));
    expect(fees).toEqual([34, 33, 33]);
    const earnings = await pool.query(
      "select bool_and(vendor_earnings_minor = total_minor - commission_minor - payment_fee_minor) as ok from public.vendor_orders where order_id = $1",
      [orderId],
    );
    expect(earnings.rows[0].ok).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Order visibility and fulfilment
// ---------------------------------------------------------------------------
describe("order visibility and vendor fulfilment", () => {
  let customer: TestUser;
  let otherCustomer: TestUser;
  let admin: TestUser;
  let ownerA: TestUser;
  let ownerB: TestUser;
  let vendorA: string;
  let vendorB: string;
  let orderId: string;

  beforeAll(async () => {
    customer = await createUser(pool);
    otherCustomer = await createUser(pool);
    admin = await createUser(pool, { role: "admin" });
    ({ owner: ownerA, vendorId: vendorA } = await newVendor(1000));
    ({ owner: ownerB, vendorId: vendorB } = await newVendor(1000));
    const a = await createActiveProduct(pool, vendorA, { priceMinor: 1_000, stock: 5 });
    const b = await createActiveProduct(pool, vendorB, { priceMinor: 2_000, stock: 5 });
    const addressId = await addAddress(customer);
    await addToCart(customer, a.variantId, 1);
    await addToCart(customer, b.variantId, 1);
    orderId = await placeOrder(customer, addressId);
  });

  it("shows customers only their own orders", async () => {
    const own = await asUser(pool, customer, (s) => s.rows("select id from public.orders where id = $1", [orderId]));
    expect(own).toHaveLength(1);
    await asUser(pool, otherCustomer, async (s) => {
      expect(await s.rows("select 1 from public.orders where id = $1", [orderId])).toEqual([]);
      expect(await s.rows("select 1 from public.vendor_orders where order_id = $1", [orderId])).toEqual([]);
      expect(await s.rows("select 1 from public.order_items where order_id = $1", [orderId])).toEqual([]);
      await s.fails(SQLSTATE.noDataFound, "select public.cancel_pending_order($1)", [orderId]);
    });
  });

  it("shows each vendor only its own vendor order and items, never the parent order", async () => {
    await asUser(pool, ownerA, async (s) => {
      const vendorOrders = await s.rows<{ vendor_id: string }>(
        "select vendor_id from public.vendor_orders where order_id = $1",
        [orderId],
      );
      expect(vendorOrders).toEqual([{ vendor_id: vendorA }]);
      const items = await s.rows<{ vendor_id: string }>(
        "select vendor_id from public.order_items where order_id = $1",
        [orderId],
      );
      expect(items).toEqual([{ vendor_id: vendorA }]);
      expect(await s.rows("select 1 from public.orders where id = $1", [orderId])).toEqual([]);
      const shipTo = await s.one<{ city: string }>(
        "select shipping_address->>'city' as city from public.vendor_orders where order_id = $1",
        [orderId],
      );
      expect(shipTo.city).toBe("Paris");
    });
    await asUser(pool, ownerB, async (s) => {
      const vendorOrders = await s.rows<{ vendor_id: string }>(
        "select vendor_id from public.vendor_orders where order_id = $1",
        [orderId],
      );
      expect(vendorOrders).toEqual([{ vendor_id: vendorB }]);
    });
  });

  it("gives admins the whole picture", async () => {
    await asUser(pool, admin, async (s) => {
      expect(await s.rows("select 1 from public.orders where id = $1", [orderId])).toHaveLength(1);
      expect(await s.rows("select 1 from public.vendor_orders where order_id = $1", [orderId])).toHaveLength(2);
    });
  });

  it("blocks fulfilment until payment, then allows only forward transitions", async () => {
    await asUser(pool, ownerA, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "update public.vendor_orders set status = 'shipped' where order_id = $1",
        [orderId],
      );
      expect(error.message).toBe("This order is awaiting payment and cannot be fulfilled yet.");
    });

    await asService(
      pool,
      (s) => s.query("select public.confirm_order_payment($1, 'manual', 'manual-ref-1', 3000, 'USD', 0)", [orderId]),
      true,
    );

    await asUser(
      pool,
      ownerA,
      async (s) => {
        await s.query("update public.vendor_orders set status = 'processing' where order_id = $1", [orderId]);
        await s.query(
          "update public.vendor_orders set status = 'shipped', carrier = 'DHL', tracking_number = 'JD014600' where order_id = $1",
          [orderId],
        );
        const shipped = await s.one<{ shipped_at: string | null }>(
          "select shipped_at from public.vendor_orders where order_id = $1",
          [orderId],
        );
        expect(shipped.shipped_at).not.toBeNull();
        await s.fails(
          SQLSTATE.raiseException,
          "update public.vendor_orders set status = 'processing' where order_id = $1",
          [orderId],
        );
      },
      true,
    );
    // Vendor B's order is untouched by vendor A.
    const statuses = (
      await pool.query("select vendor_id, status from public.vendor_orders where order_id = $1", [orderId])
    ).rows;
    expect(Object.fromEntries(statuses.map((r) => [r.vendor_id, r.status]))).toEqual({
      [vendorA]: "shipped",
      [vendorB]: "confirmed",
    });
    await asUser(pool, ownerA, async (s) => {
      const result = await s.query("update public.vendor_orders set carrier = 'Hijack' where vendor_id = $1", [
        vendorB,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });
});
