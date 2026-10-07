import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
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

async function saveZone(name: string, countries: string[], zoneId: string | null = null, active = true) {
  return asUser(
    pool,
    admin,
    (s) =>
      s
        .one<{ id: string }>(
          "select public.admin_save_shipping_zone(p_zone_id => $1, p_name => $2, p_is_active => $3, p_countries => $4) as id",
          [zoneId, name, active, countries],
        )
        .then((r) => r.id),
    true,
  );
}

async function vendorWithRate(zoneId: string, rate: { first: number; additional: number; freeOver?: number | null }) {
  const owner = await createUser(pool);
  const { vendorId, storeId } = await createApprovedVendor(pool, owner, { freeTestShipping: false });
  await pool.query(
    `insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor, additional_item_minor, free_shipping_threshold_minor, min_delivery_days, max_delivery_days)
     values ($1, $2, $3, $4, $5, 5, 9)`,
    [vendorId, zoneId, rate.first, rate.additional, rate.freeOver ?? null],
  );
  return { owner, vendorId, storeId };
}

async function customerWithAddress(country: string) {
  const user = await createUser(pool);
  const { rows } = await pool.query<{ id: string }>(
    `insert into public.addresses (profile_id, full_name, line1, city, postal_code, country_code)
     values ($1, 'Test Customer', '1 Test Street', 'Testville', '10001', $2) returning id`,
    [user.profileId, country],
  );
  return { user, addressId: rows[0].id };
}

async function addToCart(user: TestUser, variantId: string, quantity: number) {
  await asUser(pool, user, (s) => s.query("select public.add_to_cart($1, $2)", [variantId, quantity]), true);
}

async function quote(user: TestUser, addressId: string) {
  return asUser(pool, user, (s) =>
    s.rows<{
      vendor_id: string;
      shippable: boolean;
      shipping_minor: string;
      reason: string | null;
      zone_name: string | null;
    }>("select vendor_id, shippable, shipping_minor, reason, zone_name from public.checkout_shipping_quote($1)", [
      addressId,
    ]),
  );
}

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
});

afterAll(() => pool.end());

describe("shipping zones", () => {
  it("are managed only by admins through admin_save_shipping_zone", async () => {
    const customer = await createUser(pool);
    await asUser(pool, customer, (s) => s.denied("select public.admin_save_shipping_zone('Sneaky', array['US'])"));
    await asUser(pool, customer, (s) => s.denied("insert into public.shipping_zones (name) values ('Sneaky')"));

    const zone = await saveZone(`North America ${randomUUID().slice(0, 4)}`, ["us", "CA", "US"]);
    const { rows } = await pool.query<{ country_code: string }>(
      "select country_code from public.shipping_zone_countries where zone_id = $1 order by 1",
      [zone],
    );
    expect(rows.map((r) => r.country_code)).toEqual(["CA", "US"]);

    // Updating replaces the country list.
    await saveZone(`North America ${randomUUID().slice(0, 4)}`, ["US", "MX"], zone);
    const after = await pool.query<{ country_code: string }>(
      "select country_code from public.shipping_zone_countries where zone_id = $1 order by 1",
      [zone],
    );
    expect(after.rows.map((r) => r.country_code)).toEqual(["MX", "US"]);
  });

  it("keeps each country in one zone and zone names unique", async () => {
    const name = `Oceania ${randomUUID().slice(0, 4)}`;
    await saveZone(name, ["AU"]);
    await asUser(pool, admin, async (s) => {
      const taken = await s.fails(
        SQLSTATE.raiseException,
        "select public.admin_save_shipping_zone($1, array['AU','NZ'])",
        [`Pacific ${randomUUID().slice(0, 4)}`],
      );
      expect(taken.message).toBe("Already in another zone: AU. Remove them from that zone first.");
      const duplicate = await s.fails(
        SQLSTATE.raiseException,
        "select public.admin_save_shipping_zone($1, array['FJ'])",
        [name.toUpperCase()],
      );
      expect(duplicate.message).toContain("already exists");
    });
  });

  it("shows only active zones publicly and cannot delete zones vendors use", async () => {
    const hidden = await saveZone(`Hidden ${randomUUID().slice(0, 4)}`, ["IS"], null, false);
    const visible = await asAnon(pool, (s) => s.rows("select id from public.shipping_zones where id = $1", [hidden]));
    expect(visible).toEqual([]);
    const used = await saveZone(`Used ${randomUUID().slice(0, 4)}`, ["NO"]);
    await vendorWithRate(used, { first: 1000, additional: 0 });
    await asUser(pool, admin, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "delete from public.shipping_zones where id = $1", [used]);
      expect(error.message).toContain("Deactivate it instead");
      expect((await s.query("delete from public.shipping_zones where id = $1", [hidden])).rowCount).toBe(1);
    });
  });
});

describe("vendor shipping rates", () => {
  it("are managed by the vendor's owners and managers only", async () => {
    const zone = await saveZone(`Rates ${randomUUID().slice(0, 4)}`, ["SG"]);
    const { owner, vendorId } = await vendorWithRate(zone, { first: 1500, additional: 500 });
    const staff = await createUser(pool);
    await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
      vendorId,
      staff.profileId,
    ]);
    const outsider = await createUser(pool);
    const otherZone = await saveZone(`Rates2 ${randomUUID().slice(0, 4)}`, ["MY"]);

    await asUser(pool, owner, async (s) => {
      const updated = await s.query(
        "update public.vendor_shipping_rates set first_item_minor = 1800 where vendor_id = $1",
        [vendorId],
      );
      expect(updated.rowCount).toBe(1);
      await s.query(
        "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor) values ($1, $2, 2000)",
        [vendorId, otherZone],
      );
    });
    await asUser(pool, staff, async (s) => {
      expect(await s.rows("select 1 from public.vendor_shipping_rates where vendor_id = $1", [vendorId])).toHaveLength(
        1,
      );
      await s.denied(
        "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor) values ($1, $2, 1)",
        [vendorId, otherZone],
      );
    });
    await asUser(pool, outsider, async (s) => {
      expect(await s.rows("select 1 from public.vendor_shipping_rates where vendor_id = $1", [vendorId])).toEqual([]);
      expect(
        (await s.query("update public.vendor_shipping_rates set first_item_minor = 1 where vendor_id = $1", [vendorId]))
          .rowCount,
      ).toBe(0);
    });
  });

  it("must exist before a vendor can publish their store", async () => {
    const owner = await createUser(pool);
    const { vendorId, storeId } = await createApprovedVendor(pool, owner, { freeTestShipping: false });
    await pool.query("update public.stores set status = 'draft' where id = $1", [storeId]);
    await asUser(pool, owner, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "update public.stores set status = 'published' where id = $1",
        [storeId],
      );
      expect(error.message).toBe("Set up shipping for at least one zone before publishing your store.");
    });
    const zone = await saveZone(`Publish ${randomUUID().slice(0, 4)}`, ["KR"]);
    await pool.query(
      "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor) values ($1, $2, 900)",
      [vendorId, zone],
    );
    await asUser(pool, owner, async (s) => {
      expect((await s.query("update public.stores set status = 'published' where id = $1", [storeId])).rowCount).toBe(
        1,
      );
    });
  });
});

describe("shipping calculation", () => {
  it("charges first item plus each additional item, per vendor", async () => {
    const zone = await saveZone(`Calc ${randomUUID().slice(0, 4)}`, ["JP"]);
    const a = await vendorWithRate(zone, { first: 1500, additional: 400 });
    const b = await vendorWithRate(zone, { first: 2500, additional: 1000 });
    const pa = await createActiveProduct(pool, a.vendorId, { priceMinor: 5_000, stock: 10 });
    const pb = await createActiveProduct(pool, b.vendorId, { priceMinor: 7_000, stock: 10 });
    const { user, addressId } = await customerWithAddress("JP");
    await addToCart(user, pa.variantId, 3);
    await addToCart(user, pb.variantId, 1);

    const lines = Object.fromEntries((await quote(user, addressId)).map((q) => [q.vendor_id, q]));
    expect(lines[a.vendorId]).toMatchObject({ shippable: true, shipping_minor: "2300", reason: null }); // 1500 + 2 × 400
    expect(lines[b.vendorId]).toMatchObject({ shippable: true, shipping_minor: "2500" });
  });

  it("applies the free-shipping threshold on the vendor's merchandise subtotal", async () => {
    const zone = await saveZone(`Free ${randomUUID().slice(0, 4)}`, ["TH"]);
    const v = await vendorWithRate(zone, { first: 1500, additional: 500, freeOver: 10_000 });
    const product = await createActiveProduct(pool, v.vendorId, { priceMinor: 5_000, stock: 10 });
    const { user, addressId } = await customerWithAddress("TH");
    await addToCart(user, product.variantId, 1);
    expect((await quote(user, addressId))[0].shipping_minor).toBe("1500");
    await addToCart(user, product.variantId, 1); // subtotal 10 000 reaches the threshold
    expect((await quote(user, addressId))[0].shipping_minor).toBe("0");
  });

  it("does not charge shipping for items that need none", async () => {
    const zone = await saveZone(`Digital ${randomUUID().slice(0, 4)}`, ["VN"]);
    const v = await vendorWithRate(zone, { first: 1500, additional: 500 });
    const shipped = await createActiveProduct(pool, v.vendorId, { stock: 10 });
    const digital = await createActiveProduct(pool, v.vendorId, { stock: 10 });
    await pool.query("update public.products set requires_shipping = false where id = $1", [digital.productId]);
    const { user, addressId } = await customerWithAddress("VN");
    await addToCart(user, digital.variantId, 2);
    expect((await quote(user, addressId))[0].shipping_minor).toBe("0");
    await addToCart(user, shipped.variantId, 1);
    expect((await quote(user, addressId))[0].shipping_minor).toBe("1500");
  });

  it("explains why a destination cannot be served, and protects other customers' addresses", async () => {
    const zone = await saveZone(`Partial ${randomUUID().slice(0, 4)}`, ["PH"]);
    const ships = await vendorWithRate(zone, { first: 1000, additional: 0 });
    const ownerNoRate = await createUser(pool);
    const { vendorId: noRate } = await createApprovedVendor(pool, ownerNoRate, { freeTestShipping: false });
    const p1 = await createActiveProduct(pool, ships.vendorId, { stock: 5 });
    const p2 = await createActiveProduct(pool, noRate, { stock: 5 });

    const ph = await customerWithAddress("PH");
    await addToCart(ph.user, p1.variantId, 1);
    await addToCart(ph.user, p2.variantId, 1);
    const reasons = Object.fromEntries((await quote(ph.user, ph.addressId)).map((q) => [q.vendor_id, q.reason]));
    expect(reasons).toEqual({ [ships.vendorId]: null, [noRate]: "vendor_does_not_ship" });

    const nowhere = await customerWithAddress("AQ");
    await addToCart(nowhere.user, p1.variantId, 1);
    expect((await quote(nowhere.user, nowhere.addressId))[0]).toMatchObject({
      shippable: false,
      reason: "country_not_served",
      zone_name: null,
    });

    await asUser(pool, nowhere.user, (s) =>
      s.fails(SQLSTATE.raiseException, "select * from public.checkout_shipping_quote($1)", [ph.addressId]),
    );
  });
});

describe("place_order with shipping", () => {
  it("charges shipping per vendor order, keeps commission on merchandise and passes shipping to the vendor", async () => {
    const zone = await saveZone(`Order ${randomUUID().slice(0, 4)}`, ["GB"]);
    const a = await vendorWithRate(zone, { first: 1500, additional: 400 });
    const b = await vendorWithRate(zone, { first: 2500, additional: 0 });
    const pa = await createActiveProduct(pool, a.vendorId, { priceMinor: 10_000, stock: 10 });
    const pb = await createActiveProduct(pool, b.vendorId, { priceMinor: 20_000, stock: 10 });
    const { user, addressId } = await customerWithAddress("GB");
    await addToCart(user, pa.variantId, 2);
    await addToCart(user, pb.variantId, 1);

    // Subtotal 40 000 + shipping (1 900 + 2 500) = 44 400. A total without shipping is stale.
    await asUser(pool, user, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2, 40000)", [addressId, randomUUID()]),
    );
    const orderId = await asUser(
      pool,
      user,
      (s) => s.one<{ id: string }>("select public.place_order($1, $1, $2, 44400) as id", [addressId, randomUUID()]),
      true,
    ).then((r) => r.id);

    const order = (
      await pool.query(
        "select subtotal_minor, shipping_minor, tax_minor, total_minor from public.orders where id = $1",
        [orderId],
      )
    ).rows[0];
    expect(order).toEqual({ subtotal_minor: "40000", shipping_minor: "4400", tax_minor: "0", total_minor: "44400" });

    const vendorOrders = Object.fromEntries(
      (
        await pool.query(
          "select vendor_id, subtotal_minor, shipping_minor, total_minor, commission_minor, vendor_earnings_minor from public.vendor_orders where order_id = $1",
          [orderId],
        )
      ).rows.map((vo) => [vo.vendor_id, vo]),
    );
    // Default platform commission is 15 % of merchandise only.
    expect(vendorOrders[a.vendorId]).toMatchObject({
      subtotal_minor: "20000",
      shipping_minor: "1900",
      total_minor: "21900",
      commission_minor: "3000",
      vendor_earnings_minor: "18900",
    });
    expect(vendorOrders[b.vendorId]).toMatchObject({
      subtotal_minor: "20000",
      shipping_minor: "2500",
      total_minor: "22500",
      commission_minor: "3000",
      vendor_earnings_minor: "19500",
    });

    // Later rate changes never touch the placed order.
    await pool.query("update public.vendor_shipping_rates set first_item_minor = 99999 where vendor_id = $1", [
      a.vendorId,
    ]);
    const unchanged = (
      await pool.query(
        "select shipping_minor, total_minor from public.vendor_orders where order_id = $1 and vendor_id = $2",
        [orderId, a.vendorId],
      )
    ).rows[0];
    expect(unchanged).toEqual({ shipping_minor: "1900", total_minor: "21900" });
  });

  it("blocks checkout to unserved countries and for vendors that do not ship there", async () => {
    const zone = await saveZone(`Block ${randomUUID().slice(0, 4)}`, ["DE"]);
    const ships = await vendorWithRate(zone, { first: 1000, additional: 0 });
    const ownerNoRate = await createUser(pool);
    const { vendorId: noRate } = await createApprovedVendor(pool, ownerNoRate, { freeTestShipping: false });
    const p1 = await createActiveProduct(pool, ships.vendorId, { stock: 5 });
    const p2 = await createActiveProduct(pool, noRate, { stock: 5 });

    const unserved = await customerWithAddress("ZW");
    await addToCart(unserved.user, p1.variantId, 1);
    await asUser(pool, unserved.user, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        unserved.addressId,
        randomUUID(),
      ]);
      expect(error.message).toBe("Luxora does not ship to the selected address yet.");
    });

    const mixed = await customerWithAddress("DE");
    await addToCart(mixed.user, p1.variantId, 1);
    await addToCart(mixed.user, p2.variantId, 1);
    await asUser(pool, mixed.user, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.place_order($1, $1, $2)", [
        mixed.addressId,
        randomUUID(),
      ]);
      expect(error.message).toMatch(/^".+" does not ship to the selected address\./);
    });
    // Nothing was reserved by the failed attempts.
    const { rows } = await pool.query("select reserved_quantity from public.inventory where variant_id = $1", [
      p1.variantId,
    ]);
    expect(rows[0].reserved_quantity).toBe(0);
  });
});
