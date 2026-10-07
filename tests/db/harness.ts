/**
 * Shared helpers for database tests.
 *
 * Tests run as the `postgres` superuser to create fixtures, then open
 * "sessions" that mimic how Supabase executes API requests:
 *   SET LOCAL ROLE anon|authenticated|service_role
 *   SELECT set_config('request.jwt.claims', '{"sub": "<auth user id>"}', true)
 * which is exactly what auth.uid() reads in Supabase. Everything inside a
 * session runs in a transaction that is rolled back afterwards unless the
 * session is opened with `{ commit: true }`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/luxora_test";

export type ApiRole = "anon" | "authenticated" | "service_role";
export type UserRole = "customer" | "vendor" | "admin" | "super_admin";

export interface TestUser {
  userId: string;
  profileId: string;
  email: string;
}

export interface Session {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<T>>;
  one<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<T>;
  rows<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<T[]>;
  /** Asserts the statement fails with the given SQLSTATE, using a savepoint so the session stays usable. */
  fails(code: string, text: string, values?: unknown[]): Promise<pg.DatabaseError>;
  /** Asserts the statement is rejected by RLS or a privilege check (SQLSTATE 42501). */
  denied(text: string, values?: unknown[]): Promise<pg.DatabaseError>;
}

export function createPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
}

export async function createUser(
  pool: pg.Pool,
  options: { role?: UserRole; fullName?: string; email?: string } = {},
): Promise<TestUser> {
  const userId = randomUUID();
  const email = options.email ?? `${userId.slice(0, 8)}@test.luxora.local`;
  await pool.query(
    `insert into auth.users (id, email, raw_user_meta_data)
     values ($1, $2, jsonb_build_object('full_name', $3::text))`,
    [userId, email, options.fullName ?? "Test User"],
  );
  if (options.role && options.role !== "customer") {
    await pool.query("update public.profiles set role = $1 where user_id = $2", [options.role, userId]);
  }
  const { rows } = await pool.query<{ id: string }>("select id from public.profiles where user_id = $1", [userId]);
  return { userId, profileId: rows[0].id, email };
}

interface SessionOptions {
  role: ApiRole;
  user?: TestUser;
  commit?: boolean;
}

/**
 * Runs `fn` inside a transaction that impersonates a Supabase API request.
 */
export async function withSession<T>(
  pool: pg.Pool,
  options: SessionOptions,
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${options.role}`);
    // PostgREST always sets JWT claims for API roles; the service role is
    // represented by a `role: service_role` claim.
    const claims =
      options.role === "service_role"
        ? { role: "service_role" }
        : options.user
          ? { sub: options.user.userId, role: options.role, email: options.user.email }
          : { role: options.role };
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    let savepoint = 0;
    const session: Session = {
      query: (text, values) => client.query(text, values),
      fails: async (code, text, values) => {
        const name = `sp_${++savepoint}`;
        await client.query(`savepoint ${name}`);
        try {
          await client.query(text, values);
        } catch (error) {
          await client.query(`rollback to savepoint ${name}`);
          if (isPgError(error) && error.code === code) return error;
          const detail = isPgError(error) ? `${error.code}: ${error.message}` : String(error);
          throw new Error(`expected SQLSTATE ${code}, got ${detail}`);
        }
        await client.query(`release savepoint ${name}`);
        throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
      },
      denied: (text, values) => session.fails(SQLSTATE.insufficientPrivilege, text, values),
      one: async (text, values) => {
        const result = await client.query(text, values);
        if (result.rowCount !== 1) {
          throw new Error(`expected exactly one row, got ${result.rowCount}`);
        }
        return result.rows[0];
      },
      rows: async (text, values) => (await client.query(text, values)).rows,
    };
    const result = await fn(session);
    await client.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const asUser = <T>(pool: pg.Pool, user: TestUser, fn: (s: Session) => Promise<T>, commit = false) =>
  withSession(pool, { role: "authenticated", user, commit }, fn);

export const asAnon = <T>(pool: pg.Pool, fn: (s: Session) => Promise<T>) => withSession(pool, { role: "anon" }, fn);

export const asService = <T>(pool: pg.Pool, fn: (s: Session) => Promise<T>, commit = false) =>
  withSession(pool, { role: "service_role", commit }, fn);

/** Vendor Terms version used by test applications (Release 4a requires one). */
export const TEST_TERMS_VERSION = "test-terms-v1";

/** PostgreSQL SQLSTATE codes we assert on. */
export const SQLSTATE = {
  insufficientPrivilege: "42501",
  checkViolation: "23514",
  uniqueViolation: "23505",
  restrictViolation: "23001",
  noDataFound: "P0002",
  /** Business-rule error raised by our functions with a user-safe message. */
  raiseException: "P0001",
} as const;

export function isPgError(error: unknown): error is pg.DatabaseError {
  return error instanceof pg.DatabaseError;
}

/**
 * Asserts that a promise rejects with a given SQLSTATE and returns the error.
 */
export async function expectSqlError(promise: Promise<unknown>, code: string): Promise<pg.DatabaseError> {
  try {
    await promise;
  } catch (error) {
    if (isPgError(error) && error.code === code) return error;
    const detail = isPgError(error) ? `${error.code}: ${error.message}` : String(error);
    throw new Error(`expected SQLSTATE ${code}, got ${detail}`);
  }
  throw new Error(`expected SQLSTATE ${code}, but the statement succeeded`);
}

/** RLS denials surface as 42501 for both policy violations and missing grants. */
export const expectDenied = (promise: Promise<unknown>) => expectSqlError(promise, SQLSTATE.insufficientPrivilege);

/** Country used by test addresses; the shared test zone ships there for free. */
export const TEST_SHIPPING_COUNTRY = "FR";

/**
 * Ensures the shared test shipping zone (France only) exists and returns its id.
 * Release 4a requires every vendor in a bag to ship to the destination.
 */
export async function ensureTestShippingZone(pool: pg.Pool): Promise<string> {
  await pool.query("insert into public.shipping_zones (name) values ('Test zone') on conflict do nothing");
  const { rows } = await pool.query<{ id: string }>(
    "select id from public.shipping_zones where lower(name) = 'test zone'",
  );
  await pool.query(
    "insert into public.shipping_zone_countries (country_code, zone_id) values ($1, $2) on conflict do nothing",
    [TEST_SHIPPING_COUNTRY, rows[0].id],
  );
  return rows[0].id;
}

/** Creates an approved vendor owned by `owner` with a published store. Runs as superuser. */
export async function createApprovedVendor(
  pool: pg.Pool,
  owner: TestUser,
  options: { commissionBps?: number | null; slug?: string; freeTestShipping?: boolean } = {},
): Promise<{ vendorId: string; storeId: string }> {
  const slug = options.slug ?? `vendor-${randomUUID().slice(0, 8)}`;
  const vendor = await pool.query<{ id: string }>(
    `insert into public.vendors (slug, legal_name, display_name, contact_email, status, commission_rate_bps, approved_at)
     values ($1, $2, $3, $4, 'approved', $5, now()) returning id`,
    [slug, `${slug} Ltd`, slug, `${slug}@vendor.luxora.local`, options.commissionBps ?? null],
  );
  const vendorId = vendor.rows[0].id;
  await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'owner')", [
    vendorId,
    owner.profileId,
  ]);
  await pool.query("update public.profiles set role = 'vendor' where id = $1", [owner.profileId]);
  const store = await pool.query<{ id: string }>(
    `insert into public.stores (vendor_id, slug, name, status, published_at)
     values ($1, $2, $3, 'published', now()) returning id`,
    [vendorId, slug, slug],
  );
  if (options.freeTestShipping ?? true) {
    const zoneId = await ensureTestShippingZone(pool);
    await pool.query(
      "insert into public.vendor_shipping_rates (vendor_id, zone_id, first_item_minor, additional_item_minor) values ($1, $2, 0, 0)",
      [vendorId, zoneId],
    );
  }
  return { vendorId, storeId: store.rows[0].id };
}

/** Creates an active product with one default variant and an inventory row. Runs as superuser. */
export async function createActiveProduct(
  pool: pg.Pool,
  vendorId: string,
  options: { priceMinor?: number; stock?: number; categoryId?: string | null; slug?: string } = {},
): Promise<{ productId: string; variantId: string; inventoryId: string }> {
  const slug = options.slug ?? `product-${randomUUID().slice(0, 8)}`;
  const product = await pool.query<{ id: string }>(
    `insert into public.products (vendor_id, category_id, slug, name, status, published_at, approved_at)
     values ($1, $2, $3, $4, 'active', now(), now()) returning id`,
    [vendorId, options.categoryId ?? null, slug, slug],
  );
  const productId = product.rows[0].id;
  const variant = await pool.query<{ id: string }>(
    `insert into public.product_variants (product_id, sku, title, price_minor, is_default)
     values ($1, $2, 'Default', $3, true) returning id`,
    [productId, `SKU-${slug.toUpperCase()}`, options.priceMinor ?? 10_000],
  );
  const variantId = variant.rows[0].id;
  const inventory = await pool.query<{ id: string }>(
    `insert into public.inventory (variant_id, stock_quantity) values ($1, $2) returning id`,
    [variantId, options.stock ?? 0],
  );
  return { productId, variantId, inventoryId: inventory.rows[0].id };
}
