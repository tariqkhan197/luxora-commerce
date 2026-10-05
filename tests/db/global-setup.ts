/**
 * Vitest global setup for the `db` project.
 * Recreates the test database and applies the Supabase shim + all migrations so
 * every run starts from the exact schema a fresh Supabase project would have.
 */
import pg from "pg";
import { applyMigrations } from "../../scripts/db/apply-migrations.mjs";
import { TEST_DATABASE_URL } from "./harness";

export default async function setup() {
  const target = new URL(TEST_DATABASE_URL);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${adminUrl.host}. ` +
        `Start PostgreSQL and/or set TEST_DATABASE_URL. Original error: ${(error as Error).message}`,
    );
  }
  try {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [dbName],
    );
    const quoted = `"${dbName.replaceAll('"', '""')}"`;
    await admin.query(`drop database if exists ${quoted}`);
    await admin.query(`create database ${quoted}`);
  } finally {
    await admin.end();
  }

  await applyMigrations({ url: TEST_DATABASE_URL, shim: true, quiet: true });
}
