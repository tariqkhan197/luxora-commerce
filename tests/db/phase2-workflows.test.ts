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
let applicant: TestUser;
let secondApplicant: TestUser;
let customer: TestUser;
let admin: TestUser;
let vendorOwner: TestUser;
let vendorId: string;
const description = "An independent atelier producing small-batch outerwear in Copenhagen.";

async function submitApplication(user: TestUser, businessName: string) {
  return asUser(
    pool,
    user,
    (s) =>
      s.one<{ id: string }>(
        `insert into public.vendor_applications (profile_id, business_name, business_email, description)
         values (public.current_profile_id(), $1, $2, $3) returning id`,
        [businessName, `${businessName.toLowerCase().replace(/\s+/g, "")}@test.luxora.local`, description],
      ),
    true,
  );
}

beforeAll(async () => {
  applicant = await createUser(pool, { fullName: "Applicant" });
  secondApplicant = await createUser(pool, { fullName: "Second" });
  customer = await createUser(pool);
  admin = await createUser(pool, { role: "admin" });
  vendorOwner = await createUser(pool);
  ({ vendorId } = await createApprovedVendor(pool, vendorOwner, { slug: "maison-verte" }));
});

afterAll(() => pool.end());

describe("approve_vendor_application", () => {
  it("creates the vendor, owner membership and draft store atomically and audits it", async () => {
    const application = await submitApplication(applicant, "Atelier Nord");
    const newVendorId = await asUser(
      pool,
      admin,
      async (s) => {
        const row = await s.one<{ id: string }>(
          "select public.approve_vendor_application($1, 'atelier-nord-p2', 1200) as id",
          [application.id],
        );
        return row.id;
      },
      true,
    );

    const vendor = await pool.query(
      "select slug, status, commission_rate_bps, approved_by, contact_email from public.vendors where id = $1",
      [newVendorId],
    );
    expect(vendor.rows[0]).toEqual({
      slug: "atelier-nord-p2",
      status: "approved",
      commission_rate_bps: 1200,
      approved_by: admin.profileId,
      contact_email: "ateliernord@test.luxora.local",
    });

    const membership = await pool.query(
      "select role from public.vendor_users where vendor_id = $1 and profile_id = $2",
      [newVendorId, applicant.profileId],
    );
    expect(membership.rows).toEqual([{ role: "owner" }]);

    const store = await pool.query("select slug, name, status from public.stores where vendor_id = $1", [newVendorId]);
    expect(store.rows).toEqual([{ slug: "atelier-nord-p2", name: "Atelier Nord", status: "draft" }]);

    const profile = await pool.query("select role from public.profiles where id = $1", [applicant.profileId]);
    expect(profile.rows[0].role).toBe("vendor");

    const app = await pool.query(
      "select status, vendor_id, reviewed_by from public.vendor_applications where id = $1",
      [application.id],
    );
    expect(app.rows[0]).toEqual({ status: "approved", vendor_id: newVendorId, reviewed_by: admin.profileId });

    const audit = await pool.query(
      "select actor_id, metadata from public.audit_logs where action = 'vendor.approved' and entity_id = $1",
      [newVendorId],
    );
    expect(audit.rows[0].actor_id).toBe(admin.profileId);
    expect(audit.rows[0].metadata.slug).toBe("atelier-nord-p2");
  });

  it("is refused for non-admins and leaves no partial state", async () => {
    const application = await submitApplication(secondApplicant, "Second Studio");
    await asUser(pool, secondApplicant, async (s) => {
      await s.denied("select public.approve_vendor_application($1, 'second-studio')", [application.id]);
    });
    await asUser(pool, customer, async (s) => {
      await s.denied("select public.approve_vendor_application($1, 'second-studio')", [application.id]);
    });
    const vendors = await pool.query("select 1 from public.vendors where slug = 'second-studio'");
    expect(vendors.rowCount).toBe(0);
  });

  it("rejects slugs that are taken or malformed", async () => {
    const { rows } = await pool.query(
      "select id from public.vendor_applications where profile_id = $1 and status = 'submitted'",
      [secondApplicant.profileId],
    );
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.uniqueViolation, "select public.approve_vendor_application($1, 'maison-verte')", [
        rows[0].id,
      ]);
      await s.fails(SQLSTATE.checkViolation, "select public.approve_vendor_application($1, 'Bad Slug')", [rows[0].id]);
    });
  });

  it("cannot approve an application twice", async () => {
    const { rows } = await pool.query(
      "select id from public.vendor_applications where profile_id = $1 and status = 'approved'",
      [applicant.profileId],
    );
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.approve_vendor_application($1, 'atelier-nord-p2-again')", [
        rows[0].id,
      ]);
    });
  });
});

describe("reject_vendor_application", () => {
  it("records the reason and reviewer, and requires a reason", async () => {
    const { rows } = await pool.query(
      "select id from public.vendor_applications where profile_id = $1 and status = 'submitted'",
      [secondApplicant.profileId],
    );
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.reject_vendor_application($1, '')", [rows[0].id]);
    });
    await asUser(
      pool,
      admin,
      (s) => s.query("select public.reject_vendor_application($1, 'Insufficient brand information')", [rows[0].id]),
      true,
    );
    const app = await pool.query(
      "select status, rejection_reason, reviewed_by from public.vendor_applications where id = $1",
      [rows[0].id],
    );
    expect(app.rows[0]).toEqual({
      status: "rejected",
      rejection_reason: "Insufficient brand information",
      reviewed_by: admin.profileId,
    });
    const audit = await pool.query(
      "select 1 from public.audit_logs where action = 'vendor.application_rejected' and entity_id = $1",
      [rows[0].id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("lets a rejected applicant apply again", async () => {
    const again = await submitApplication(secondApplicant, "Second Studio Reborn");
    expect(again.id).toBeTruthy();
  });
});

describe("set_vendor_status", () => {
  it("suspends and reinstates with an audit trail; non-admins are refused", async () => {
    await asUser(pool, vendorOwner, async (s) => {
      await s.denied("select public.set_vendor_status($1, 'suspended', 'test')", [vendorId]);
    });
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.set_vendor_status($1, 'suspended', null)", [vendorId]);
      const suspended = await s.one<{ status: string; suspension_reason: string }>(
        "select status, suspension_reason from public.set_vendor_status($1, 'suspended', 'Policy breach')",
        [vendorId],
      );
      expect(suspended).toEqual({ status: "suspended", suspension_reason: "Policy breach" });
      const reinstated = await s.one<{ status: string; suspension_reason: string | null }>(
        "select status, suspension_reason from public.set_vendor_status($1, 'approved')",
        [vendorId],
      );
      expect(reinstated).toEqual({ status: "approved", suspension_reason: null });
      const audits = await s.rows(
        "select 1 from public.audit_logs where action = 'vendor.status_changed' and entity_id = $1",
        [vendorId],
      );
      expect(audits).toHaveLength(2);
    });
  });
});

describe("moderate_product", () => {
  async function createPendingProduct(withVariant = true) {
    const slug = `pending-${Math.random().toString(36).slice(2, 8)}`;
    const product = await pool.query<{ id: string }>(
      "insert into public.products (vendor_id, slug, name, status) values ($1, $2, $3, 'pending_review') returning id",
      [vendorId, slug, slug],
    );
    if (withVariant) {
      await pool.query(
        "insert into public.product_variants (product_id, sku, price_minor, is_default) values ($1, $2, 5000, true)",
        [product.rows[0].id, `SKU-${slug.toUpperCase()}`],
      );
    }
    return product.rows[0].id;
  }

  it("approves pending products with at least one active variant", async () => {
    const productId = await createPendingProduct();
    await asUser(pool, admin, async (s) => {
      const row = await s.one<{ status: string; approved_by: string; published_at: string | null }>(
        "select status, approved_by, published_at from public.moderate_product($1, true)",
        [productId],
      );
      expect(row.status).toBe("active");
      expect(row.approved_by).toBe(admin.profileId);
      expect(row.published_at).not.toBeNull();
      const audit = await s.rows(
        "select 1 from public.audit_logs where action = 'product.approved' and entity_id = $1",
        [productId],
      );
      expect(audit).toHaveLength(1);
    });
  });

  it("refuses to approve a product without variants", async () => {
    const productId = await createPendingProduct(false);
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.moderate_product($1, true)", [productId]);
    });
  });

  it("rejects with a mandatory reason and only moderates pending products", async () => {
    const productId = await createPendingProduct();
    await asUser(pool, admin, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "select public.moderate_product($1, false)", [productId]);
      const row = await s.one<{ status: string; rejection_reason: string }>(
        "select status, rejection_reason from public.moderate_product($1, false, 'Photos do not meet guidelines')",
        [productId],
      );
      expect(row).toEqual({ status: "rejected", rejection_reason: "Photos do not meet guidelines" });
      await s.fails(SQLSTATE.checkViolation, "select public.moderate_product($1, true)", [productId]);
    });
  });

  it("is refused for vendors", async () => {
    const productId = await createPendingProduct();
    await asUser(pool, vendorOwner, async (s) => {
      await s.denied("select public.moderate_product($1, true)", [productId]);
    });
  });

  it("lets the vendor unpublish an active product back to draft", async () => {
    const { productId } = await createActiveProduct(pool, vendorId);
    await asUser(pool, vendorOwner, async (s) => {
      const row = await s.one<{ status: string }>("select status from public.unpublish_product($1)", [productId]);
      expect(row.status).toBe("draft");
    });
    const other = await createUser(pool);
    const { productId: otherProduct } = await createActiveProduct(pool, vendorId);
    await asUser(pool, other, async (s) => {
      await s.denied("select public.unpublish_product($1)", [otherProduct]);
    });
  });
});

describe("public catalog views", () => {
  it("lists only active products of approved vendors with price range, image and stock flag", async () => {
    const { productId, variantId } = await createActiveProduct(pool, vendorId, {
      slug: "listed-coat",
      priceMinor: 12_000,
      stock: 3,
    });
    await pool.query(
      "insert into public.product_variants (product_id, sku, title, price_minor) values ($1, 'LISTED-COAT-XL', 'XL', 15000)",
      [productId],
    );
    await pool.query(
      "insert into public.product_images (product_id, storage_path, is_primary, position) values ($1, $2, true, 0), ($1, $3, false, 1)",
      [productId, `${vendorId}/${productId}/front.jpg`, `${vendorId}/${productId}/back.jpg`],
    );
    await pool.query(
      "insert into public.products (vendor_id, slug, name, status) values ($1, 'draft-coat', 'Draft Coat', 'draft')",
      [vendorId],
    );

    const rows = await asAnon(pool, (s) =>
      s.rows<{
        slug: string;
        min_price_minor: string;
        max_price_minor: string;
        primary_image_path: string;
        in_stock: boolean;
        store_slug: string;
      }>(
        "select slug, min_price_minor, max_price_minor, primary_image_path, in_stock, store_slug from public.product_listings where slug in ('listed-coat', 'draft-coat')",
      ),
    );
    expect(rows).toEqual([
      {
        slug: "listed-coat",
        min_price_minor: "12000",
        max_price_minor: "15000",
        primary_image_path: `${vendorId}/${productId}/front.jpg`,
        in_stock: true,
        store_slug: "maison-verte",
      },
    ]);

    // Exhaust stock → flag flips, quantity is never exposed.
    await pool.query("select public.adjust_inventory($1, -3, 'damaged')", [variantId]);
    const after = await asAnon(pool, (s) =>
      s.rows<{ in_stock: boolean }>("select in_stock from public.product_listings where slug = 'listed-coat'"),
    );
    expect(after[0].in_stock).toBe(false);
    const availability = await asAnon(pool, (s) =>
      s.rows<{ sku: string; in_stock: boolean; is_low_stock: boolean }>(
        "select sku, in_stock, is_low_stock from public.product_variant_availability where product_id = $1 order by sku",
        [productId],
      ),
    );
    expect(availability.map((v) => v.sku)).toEqual(["LISTED-COAT-XL", "SKU-LISTED-COAT"]);
    expect(availability[1].in_stock).toBe(false);
    expect(availability[0].in_stock).toBe(false); // no inventory row → treated as unavailable
    const columns = await pool.query(
      "select column_name from information_schema.columns where table_name = 'product_variant_availability' and column_name like '%quantity%'",
    );
    expect(columns.rowCount).toBe(0);
  });

  it("hides products of suspended vendors", async () => {
    const owner = await createUser(pool);
    const { vendorId: suspendedVendor } = await createApprovedVendor(pool, owner);
    await createActiveProduct(pool, suspendedVendor, { slug: "suspended-item", stock: 1 });
    await pool.query("update public.vendors set status = 'suspended' where id = $1", [suspendedVendor]);
    const rows = await asAnon(pool, (s) =>
      s.rows("select slug from public.product_listings where slug = 'suspended-item'"),
    );
    expect(rows).toEqual([]);
  });

  it("supports prefix full-text search", async () => {
    await createActiveProduct(pool, vendorId, { slug: "cashmere-scarf-search", stock: 1 });
    await pool.query(
      "update public.products set name = 'Cashmere Travel Scarf', tags = array['winter','gift'] where slug = 'cashmere-scarf-search'",
    );
    const hits = await asAnon(pool, (s) =>
      s.rows<{ slug: string }>(
        "select slug from public.product_listings where search_vector @@ to_tsquery('simple', $1)",
        ["'cashm':* & 'gift':*"],
      ),
    );
    expect(hits.map((h) => h.slug)).toContain("cashmere-scarf-search");
    const miss = await asAnon(pool, (s) =>
      s.rows("select slug from public.product_listings where search_vector @@ to_tsquery('simple', $1)", [
        "'velvet':*",
      ]),
    );
    expect(miss.find((m) => (m as { slug: string }).slug === "cashmere-scarf-search")).toBeUndefined();
  });
});

describe("catalog deletes and inventory history", () => {
  it("allows deleting a variant without history but blocks one with stock movements", async () => {
    const { productId, variantId } = await createActiveProduct(pool, vendorId, { stock: 0 });
    await pool.query("update public.products set status = 'draft' where id = $1", [productId]);
    const clean = await pool.query<{ id: string }>(
      "insert into public.product_variants (product_id, sku, title, price_minor) values ($1, $2, 'Spare', 1000) returning id",
      [productId, `SPARE-${productId.slice(0, 8)}`],
    );
    await pool.query("insert into public.inventory (variant_id) values ($1)", [clean.rows[0].id]);

    await asUser(pool, vendorOwner, async (s) => {
      const removed = await s.query("delete from public.product_variants where id = $1", [clean.rows[0].id]);
      expect(removed.rowCount).toBe(1);
    });

    await pool.query("select public.adjust_inventory($1, 5, 'restock')", [variantId]);
    await asUser(pool, vendorOwner, async (s) => {
      await s.fails(SQLSTATE.restrictViolation, "delete from public.product_variants where id = $1", [variantId]);
    });
    const still = await pool.query(
      "select 1 from public.inventory_movements m join public.inventory i on i.id = m.inventory_id where i.variant_id = $1",
      [variantId],
    );
    expect(still.rowCount).toBe(1);
  });

  it("lets a vendor create the inventory record for its own new variant only", async () => {
    const { productId } = await createActiveProduct(pool, vendorId);
    const variant = await pool.query<{ id: string }>(
      "insert into public.product_variants (product_id, sku, price_minor) values ($1, $2, 2500) returning id",
      [productId, `NEWINV-${productId.slice(0, 8)}`],
    );
    const stranger = await createUser(pool);
    await asUser(pool, stranger, async (s) => {
      await s.denied("insert into public.inventory (variant_id, vendor_id) values ($1, $2)", [
        variant.rows[0].id,
        vendorId,
      ]);
    });
    await asUser(pool, vendorOwner, async (s) => {
      // vendor_id supplied by the client is overwritten by the inventory_sync_vendor trigger.
      const row = await s.one<{ vendor_id: string; stock_quantity: number }>(
        "insert into public.inventory (variant_id, vendor_id) values ($1, $2) returning vendor_id, stock_quantity",
        [variant.rows[0].id, vendorId],
      );
      expect(row).toEqual({ vendor_id: vendorId, stock_quantity: 0 });
      await s.denied("insert into public.inventory (variant_id, stock_quantity) values ($1, 50)", [variant.rows[0].id]);
    });
  });
});
