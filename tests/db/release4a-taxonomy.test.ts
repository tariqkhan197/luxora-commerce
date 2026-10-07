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
  TEST_TERMS_VERSION,
  type TestUser,
} from "./harness";

const pool = createPool();
let admin: TestUser;
let customer: TestUser;
let vendorOwner: TestUser;
let vendorId: string;

const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

async function adminInsertCategory(name: string, parentId: string | null = null) {
  return asUser(
    pool,
    admin,
    (s) =>
      s.one<{ id: string }>("insert into public.categories (slug, name, parent_id) values ($1, $2, $3) returning id", [
        slug(name.toLowerCase()),
        name,
        parentId,
      ]),
    true,
  ).then((row) => row.id);
}

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
  customer = await createUser(pool);
  vendorOwner = await createUser(pool);
  ({ vendorId } = await createApprovedVendor(pool, vendorOwner));
});

afterAll(() => pool.end());

describe("category management", () => {
  it("lets only admins create and edit categories", async () => {
    await asUser(pool, customer, (s) => s.denied("insert into public.categories (slug, name) values ('nope', 'Nope')"));
    await asUser(pool, vendorOwner, (s) =>
      s.denied("insert into public.categories (slug, name) values ('nope', 'Nope')"),
    );
    const id = await adminInsertCategory("Outerwear");
    await asUser(pool, vendorOwner, async (s) => {
      const result = await s.query("update public.categories set name = 'Hijacked' where id = $1", [id]);
      expect(result.rowCount).toBe(0);
    });
  });

  it("limits the tree to three levels and prevents cycles", async () => {
    const root = await adminInsertCategory("Women");
    const child = await adminInsertCategory("Coats", root);
    const grandchild = await adminInsertCategory("Parkas", child);
    await asUser(pool, admin, async (s) => {
      const tooDeep = await s.fails(
        SQLSTATE.raiseException,
        "insert into public.categories (slug, name, parent_id) values ($1, 'Too deep', $2)",
        [slug("deep"), grandchild],
      );
      expect(tooDeep.message).toBe("Categories can be at most 3 levels deep.");
      const cycle = await s.fails(
        SQLSTATE.raiseException,
        "update public.categories set parent_id = $1 where id = $2",
        [grandchild, root],
      );
      expect(cycle.message).toContain("cannot be placed inside itself");
    });
    // Moving a two-level subtree under a level-2 node would create a 4th level.
    const otherRoot = await adminInsertCategory("Men");
    const otherChild = await adminInsertCategory("Tailoring", otherRoot);
    await asUser(pool, admin, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "update public.categories set parent_id = $1 where id = $2",
        [otherChild, child],
      );
      expect(error.message).toContain("more than 3 levels deep");
    });
  });

  it("refuses to delete categories that are used, and deletes unused ones", async () => {
    const parent = await adminInsertCategory("Home");
    const child = await adminInsertCategory("Textiles", parent);
    const used = await adminInsertCategory("Ceramics");
    await createActiveProduct(pool, vendorId, { categoryId: used });
    await asUser(pool, admin, async (s) => {
      const withChildren = await s.fails(SQLSTATE.raiseException, "delete from public.categories where id = $1", [
        parent,
      ]);
      expect(withChildren.message).toContain("has subcategories");
      const withProducts = await s.fails(SQLSTATE.raiseException, "delete from public.categories where id = $1", [
        used,
      ]);
      expect(withProducts.message).toContain("Deactivate it instead");
      const deleted = await s.query("delete from public.categories where id = $1", [child]);
      expect(deleted.rowCount).toBe(1);
    });
  });

  it("deactivates a category together with its subcategories", async () => {
    const root = await adminInsertCategory("Beauty");
    const child = await adminInsertCategory("Skincare", root);
    const grandchild = await adminInsertCategory("Serums", child);

    await asUser(pool, customer, (s) => s.denied("select public.set_category_active($1, false)", [root]));
    const changed = await asUser(
      pool,
      admin,
      (s) => s.one<{ n: number }>("select public.set_category_active($1, false) as n", [root]),
      true,
    );
    expect(changed.n).toBe(3);

    const visible = await asAnon(pool, (s) =>
      s.rows("select id from public.categories where id = any($1::uuid[])", [[root, child, grandchild]]),
    );
    expect(visible).toEqual([]);
    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.set_category_active($1, true)", [child]),
    );
    await asUser(pool, admin, (s) => s.query("select public.set_category_active($1, true)", [root]), true);
    const reactivated = await asAnon(pool, (s) => s.rows("select id from public.categories where id = $1", [root]));
    expect(reactivated).toHaveLength(1);
  });

  it("audits category changes and commission changes with the acting admin", async () => {
    const id = await adminInsertCategory("Jewellery");
    await asUser(
      pool,
      admin,
      (s) =>
        s.query("update public.categories set commission_rate_bps = 1200, name = 'Fine Jewellery' where id = $1", [id]),
      true,
    );
    const { rows } = await pool.query<{ action: string; actor_id: string; metadata: Record<string, unknown> }>(
      "select action, actor_id, metadata from public.audit_logs where entity_id = $1 order by id",
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual(["category.created", "category.updated", "commission.changed"]);
    expect(rows.every((r) => r.actor_id === admin.profileId)).toBe(true);
    expect(rows[2].metadata).toEqual({ from_bps: null, to_bps: 1200 });
  });
});

describe("brand management", () => {
  it("lets only admins manage brands and refuses to delete used ones", async () => {
    await asUser(pool, vendorOwner, (s) =>
      s.denied("insert into public.brands (slug, name) values ('fake-brand', 'Fake')"),
    );
    const brand = await asUser(
      pool,
      admin,
      (s) =>
        s.one<{ id: string }>("insert into public.brands (slug, name) values ($1, 'Maison Libre') returning id", [
          slug("libre"),
        ]),
      true,
    );
    const { productId } = await createActiveProduct(pool, vendorId);
    await pool.query("update public.products set brand_id = $1 where id = $2", [brand.id, productId]);
    await asUser(pool, admin, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "delete from public.brands where id = $1", [brand.id]);
      expect(error.message).toContain("Deactivate it instead");
    });
    const unused = await asUser(
      pool,
      admin,
      (s) =>
        s.one<{ id: string }>("insert into public.brands (slug, name) values ($1, 'Unused') returning id", [
          slug("unused"),
        ]),
      true,
    );
    await asUser(pool, admin, async (s) => {
      expect((await s.query("delete from public.brands where id = $1", [unused.id])).rowCount).toBe(1);
    });
  });

  it("lets vendors use their own brand or an unowned brand, never another vendor's", async () => {
    const otherOwner = await createUser(pool);
    const { vendorId: otherVendor } = await createApprovedVendor(pool, otherOwner);
    const insertBrand = (name: string, owner: string | null, active = true) =>
      pool
        .query<{ id: string }>(
          "insert into public.brands (slug, name, owner_vendor_id, is_active) values ($1, $2, $3, $4) returning id",
          [slug(name), name, owner, active],
        )
        .then((r) => r.rows[0].id);
    const own = await insertBrand("own", vendorId);
    const unowned = await insertBrand("unowned", null);
    const foreign = await insertBrand("foreign", otherVendor);
    const inactive = await insertBrand("inactive", null, false);

    await asUser(pool, vendorOwner, async (s) => {
      for (const brandId of [own, unowned]) {
        await s.query("insert into public.products (vendor_id, slug, name, brand_id) values ($1, $2, 'Allowed', $3)", [
          vendorId,
          slug("ok"),
          brandId,
        ]);
      }
      const denied = await s.fails(
        SQLSTATE.raiseException,
        "insert into public.products (vendor_id, slug, name, brand_id) values ($1, $2, 'Copy', $3)",
        [vendorId, slug("copy"), foreign],
      );
      expect(denied.message).toContain("your own brand");
      await s.fails(
        SQLSTATE.raiseException,
        "insert into public.products (vendor_id, slug, name, brand_id) values ($1, $2, 'Old', $3)",
        [vendorId, slug("old"), inactive],
      );
    });
  });
});

describe("catalog assets storage", () => {
  it("is publicly readable and writable only by admins", async () => {
    await asUser(
      pool,
      admin,
      (s) => s.query("insert into storage.objects (bucket_id, name) values ('catalog-assets', 'brands/b1/logo.png')"),
      true,
    );
    await asUser(pool, vendorOwner, (s) =>
      s.denied("insert into storage.objects (bucket_id, name) values ('catalog-assets', 'brands/b2/logo.png')"),
    );
    const rows = await asAnon(pool, (s) =>
      s.rows("select name from storage.objects where bucket_id = 'catalog-assets'"),
    );
    expect(rows).toEqual([{ name: "brands/b1/logo.png" }]);
  });
});

describe("vendor approval and terms acceptance", () => {
  async function apply(user: TestUser, terms: string | null, acceptedAt: string | null = null) {
    return asUser(
      pool,
      user,
      (s) =>
        s.one<{ id: string; terms_accepted_at: string | null }>(
          `insert into public.vendor_applications (profile_id, business_name, business_email, description, terms_version, terms_accepted_at)
           values (public.current_profile_id(), 'Studio Kalam', 'hello@kalam.test', 'Hand-loomed textiles from Lahore, made in small batches.', $1, $2)
           returning id, terms_accepted_at`,
          [terms, acceptedAt],
        ),
      true,
    );
  }

  it("requires accepted Vendor Terms and stamps the acceptance time in the database", async () => {
    const applicant = await createUser(pool);
    await asUser(pool, applicant, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        `insert into public.vendor_applications (profile_id, business_name, business_email, description)
         values (public.current_profile_id(), 'No Terms', 'x@y.test', 'An application that skips the vendor terms entirely.')`,
      );
      expect(error.message).toBe("You must accept the Vendor Terms to apply.");
    });
    const backdated = await apply(applicant, TEST_TERMS_VERSION, "2001-01-01T00:00:00Z");
    expect(new Date(backdated.terms_accepted_at!).getFullYear()).toBeGreaterThan(2020);
    await asUser(
      pool,
      applicant,
      (s) =>
        s.query("update public.vendor_applications set terms_accepted_at = '2001-01-01' where id = $1", [backdated.id]),
      true,
    );
    const { rows } = await pool.query(
      "select terms_version, terms_accepted_at from public.vendor_applications where id = $1",
      [backdated.id],
    );
    expect(rows[0].terms_version).toBe(TEST_TERMS_VERSION);
    expect(new Date(rows[0].terms_accepted_at).getFullYear()).toBeGreaterThan(2020);
  });

  it("creates a brand owned by the vendor on approval, avoiding slug clashes", async () => {
    const applicant = await createUser(pool);
    const application = await apply(applicant, TEST_TERMS_VERSION);
    const vendorSlug = slug("kalam");
    await pool.query("insert into public.brands (slug, name) values ($1, 'Existing brand')", [vendorSlug]);
    const newVendorId = await asUser(
      pool,
      admin,
      (s) =>
        s
          .one<{ id: string }>("select public.approve_vendor_application($1, $2) as id", [application.id, vendorSlug])
          .then((r) => r.id),
      true,
    );
    const { rows } = await pool.query<{ slug: string; name: string; owner_vendor_id: string }>(
      "select slug, name, owner_vendor_id from public.brands where owner_vendor_id = $1",
      [newVendorId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Studio Kalam");
    expect(rows[0].slug).toMatch(new RegExp(`^${vendorSlug}-[0-9a-f]{6}$`));
  });
});
