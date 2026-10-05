import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createApprovedVendor, createPool, createUser, SQLSTATE, type TestUser } from "./harness";

/**
 * Regression tests for running migrations on Supabase, where extensions live in
 * the `extensions` schema. The global setup already applies every migration
 * with `extensions` OFF the search path; these tests check the resulting schema
 * keeps the case-insensitive behaviour the design relies on.
 */
const pool = createPool();
let admin: TestUser;
let owner: TestUser;
let vendorId: string;

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
  owner = await createUser(pool);
  ({ vendorId } = await createApprovedVendor(pool, owner, { slug: "ext-schema-house" }));
});

afterAll(() => pool.end());

describe("extension objects", () => {
  it("installs citext, pg_trgm and pgcrypto in the extensions schema", async () => {
    const { rows } = await pool.query<{ extname: string; schema: string }>(
      `select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname in ('citext', 'pg_trgm', 'pgcrypto') order by e.extname`,
    );
    expect(rows).toEqual([
      { extname: "citext", schema: "extensions" },
      { extname: "pg_trgm", schema: "extensions" },
      { extname: "pgcrypto", schema: "extensions" },
    ]);
  });

  it("types every email/code column as extensions.citext", async () => {
    const { rows } = await pool.query<{ column: string; type_schema: string }>(
      `select table_name || '.' || column_name as column, udt_schema as type_schema
       from information_schema.columns where table_schema = 'public' and udt_name = 'citext' order by 1`,
    );
    expect(rows).toEqual([
      { column: "coupons.code", type_schema: "extensions" },
      { column: "orders.customer_email", type_schema: "extensions" },
      { column: "vendor_applications.business_email", type_schema: "extensions" },
      { column: "vendors.contact_email", type_schema: "extensions" },
    ]);
  });

  it("builds the product name trigram index with the extensions operator class", async () => {
    const { rows } = await pool.query<{ opclass: string; schema: string }>(
      `select opc.opcname as opclass, n.nspname as schema
       from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_opclass opc on opc.oid = i.indclass[0]
       join pg_namespace n on n.oid = opc.opcnamespace
       where c.relname = 'products_name_trgm_idx'`,
    );
    expect(rows).toEqual([{ opclass: "gin_trgm_ops", schema: "extensions" }]);
  });
});

describe("case-insensitive behaviour is preserved", () => {
  it("matches vendor contact emails regardless of case", async () => {
    const { rows } = await pool.query("select id from public.vendors where contact_email = $1", [
      "EXT-SCHEMA-HOUSE@VENDOR.LUXORA.LOCAL",
    ]);
    expect(rows).toEqual([{ id: vendorId }]);
  });

  it("still validates email format with the check constraint", async () => {
    await expect(
      pool.query(
        "insert into public.vendors (slug, legal_name, display_name, contact_email) values ('bad-email-house', 'Bad Ltd', 'Bad', 'not-an-email')",
      ),
    ).rejects.toMatchObject({ code: SQLSTATE.checkViolation });
  });

  it("treats coupon codes as unique case-insensitively", async () => {
    await asUser(pool, admin, async (s) => {
      await s.query(
        "insert into public.coupons (code, scope, name, discount_type, discount_value) values ('WELCOME10', 'platform', 'Welcome', 'percentage', 1000)",
      );
      await s.fails(
        SQLSTATE.uniqueViolation,
        "insert into public.coupons (code, scope, name, discount_type, discount_value) values ('welcome10', 'platform', 'Duplicate', 'percentage', 1000)",
      );
      const found = await s.rows("select code from public.coupons where code = 'Welcome10'");
      expect(found).toEqual([{ code: "WELCOME10" }]);
    });
  });
});
