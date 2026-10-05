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
  type TestUser,
} from "./harness";

const pool = createPool();
let owner: TestUser;
let otherOwner: TestUser;
let admin: TestUser;
let vendorId: string;
let otherVendorId: string;

beforeAll(async () => {
  owner = await createUser(pool);
  otherOwner = await createUser(pool);
  admin = await createUser(pool, { role: "admin" });
  ({ vendorId } = await createApprovedVendor(pool, owner));
  ({ vendorId: otherVendorId } = await createApprovedVendor(pool, otherOwner));
});

afterAll(() => pool.end());

describe("products", () => {
  it("lets a vendor create a draft product but not publish it directly", async () => {
    await asUser(pool, owner, async (s) => {
      const row = await s.one<{ id: string; status: string }>(
        `insert into public.products (vendor_id, slug, name) values ($1, 'wool-coat', 'Wool Coat') returning id, status`,
        [vendorId],
      );
      expect(row.status).toBe("draft");
      await s.query("update public.products set status = 'pending_review' where id = $1", [row.id]);
      await s.denied("update public.products set status = 'active' where id = $1", [row.id]);
    });
    await asUser(pool, owner, async (s) => {
      await s.denied(
        `insert into public.products (vendor_id, slug, name, status) values ($1, 'x-coat', 'X', 'active')`,
        [vendorId],
      );
    });
  });

  it("prevents a vendor from creating products for another vendor", async () => {
    await asUser(pool, owner, async (s) => {
      await s.denied(`insert into public.products (vendor_id, slug, name) values ($1, 'intruder', 'Intruder')`, [
        otherVendorId,
      ]);
    });
  });

  it("shows only active products of approved vendors to the public", async () => {
    await createActiveProduct(pool, vendorId, { slug: "silk-scarf" });
    await pool.query(
      `insert into public.products (vendor_id, slug, name, status) values ($1, 'hidden-draft', 'Hidden', 'draft')`,
      [vendorId],
    );
    // Scoped to this test's fixtures: other suites share the database.
    const scoped = "select slug from public.products where slug in ('silk-scarf', 'hidden-draft') order by slug";
    const anonRows = await asAnon(pool, (s) => s.rows<{ slug: string }>(scoped));
    expect(anonRows.map((r) => r.slug)).toEqual(["silk-scarf"]);
    const ownerRows = await asUser(pool, owner, (s) => s.rows<{ slug: string }>(scoped));
    expect(ownerRows.map((r) => r.slug)).toEqual(["hidden-draft", "silk-scarf"]);
    const otherRows = await asUser(pool, otherOwner, (s) => s.rows<{ slug: string }>(scoped));
    expect(otherRows.map((r) => r.slug)).toEqual(["silk-scarf"]);
  });

  it("lets an admin approve a product", async () => {
    await asUser(pool, admin, async (s) => {
      const result = await s.query(
        `update public.products set status = 'active', approved_at = now(), approved_by = public.current_profile_id(), published_at = now()
          where slug = 'hidden-draft'`,
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it("rejects invalid slugs and negative prices", async () => {
    await expectSqlError(
      pool.query(`insert into public.products (vendor_id, slug, name) values ($1, 'Bad Slug!', 'Bad')`, [vendorId]),
      SQLSTATE.checkViolation,
    );
    const { productId } = await createActiveProduct(pool, vendorId);
    await expectSqlError(
      pool.query(`insert into public.product_variants (product_id, sku, price_minor) values ($1, 'NEG-1', -1)`, [
        productId,
      ]),
      SQLSTATE.checkViolation,
    );
  });
});

describe("inventory", () => {
  it("vendor adjusts stock via adjust_inventory and a movement is recorded", async () => {
    const { variantId, inventoryId } = await createActiveProduct(pool, vendorId);
    await asUser(pool, owner, async (s) => {
      const row = await s.one<{ stock_quantity: number; available_quantity: number }>(
        "select stock_quantity, available_quantity from public.adjust_inventory($1, 25, 'restock', null, null, 'initial delivery')",
        [variantId],
      );
      expect(row).toMatchObject({ stock_quantity: 25, available_quantity: 25 });
      const movements = await s.rows(
        "select type, quantity_delta, quantity_after, created_by from public.inventory_movements where inventory_id = $1",
        [inventoryId],
      );
      expect(movements).toEqual([
        { type: "restock", quantity_delta: 25, quantity_after: 25, created_by: owner.profileId },
      ]);
    });
  });

  it("never lets stock go negative", async () => {
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 3 });
    await asUser(pool, owner, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.adjust_inventory($1, -4, 'damaged')", [variantId]);
    });
    await asUser(pool, owner, async (s) => {
      const row = await s.one<{ stock_quantity: number }>(
        "select stock_quantity from public.adjust_inventory($1, -3, 'damaged')",
        [variantId],
      );
      expect(row.stock_quantity).toBe(0);
    });
  });

  it("blocks direct updates to quantity columns even for admins", async () => {
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 5 });
    await asUser(pool, owner, async (s) => {
      await s.denied("update public.inventory set stock_quantity = 999 where variant_id = $1", [variantId]);
    });
    await asUser(pool, admin, async (s) => {
      await s.denied("update public.inventory set reserved_quantity = 0 where variant_id = $1", [variantId]);
    });
    await asUser(pool, owner, async (s) => {
      const ok = await s.query("update public.inventory set low_stock_threshold = 2 where variant_id = $1", [
        variantId,
      ]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it("prevents a vendor from adjusting another vendor's stock", async () => {
    const { variantId } = await createActiveProduct(pool, otherVendorId, { stock: 5 });
    await asUser(pool, owner, async (s) => {
      await s.denied("select public.adjust_inventory($1, 1, 'restock')", [variantId]);
    });
  });

  it("vendors cannot call reservation functions; the platform can", async () => {
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 10 });
    await asUser(pool, owner, async (s) => {
      await s.denied("select public.reserve_inventory($1, 1)", [variantId]);
    });
    await asService(pool, async (s) => {
      const reserved = await s.one<{ reserved_quantity: number; available_quantity: number }>(
        "select reserved_quantity, available_quantity from public.reserve_inventory($1, 4)",
        [variantId],
      );
      expect(reserved).toMatchObject({ reserved_quantity: 4, available_quantity: 6 });
      await s.fails(SQLSTATE.checkViolation, "select public.reserve_inventory($1, 7)", [variantId]);
    });
  });

  it("commits reservations into sales and keeps movements immutable", async () => {
    const { variantId, inventoryId } = await createActiveProduct(pool, vendorId, { stock: 10 });
    const orderRef = "00000000-0000-0000-0000-00000000aaaa";
    await asService(
      pool,
      async (s) => {
        await s.query("select public.reserve_inventory($1, 3)", [variantId]);
        const committed = await s.one<{ stock_quantity: number; reserved_quantity: number }>(
          "select stock_quantity, reserved_quantity from public.commit_reserved_inventory($1, 3, $2)",
          [variantId, orderRef],
        );
        expect(committed).toEqual({ stock_quantity: 7, reserved_quantity: 0 });
        await s.fails(SQLSTATE.checkViolation, "select public.commit_reserved_inventory($1, 1, $2)", [
          variantId,
          orderRef,
        ]);
      },
      true,
    );
    const { rows } = await pool.query(
      "select type, quantity_delta, reference_type, reference_id from public.inventory_movements where inventory_id = $1",
      [inventoryId],
    );
    expect(rows).toEqual([{ type: "sale", quantity_delta: -3, reference_type: "order", reference_id: orderRef }]);
    await expectSqlError(
      pool.query("delete from public.inventory_movements where inventory_id = $1", [inventoryId]),
      SQLSTATE.restrictViolation,
    );
  });

  it("releases reservations without touching stock", async () => {
    const { variantId } = await createActiveProduct(pool, vendorId, { stock: 5 });
    await asService(pool, async (s) => {
      await s.query("select public.reserve_inventory($1, 2)", [variantId]);
      const row = await s.one<{ stock_quantity: number; reserved_quantity: number }>(
        "select stock_quantity, reserved_quantity from public.release_inventory($1, 2)",
        [variantId],
      );
      expect(row).toEqual({ stock_quantity: 5, reserved_quantity: 0 });
    });
  });
});
