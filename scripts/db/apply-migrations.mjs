#!/usr/bin/env node
/**
 * Applies the SQL migrations in supabase/migrations (in filename order) to a
 * PostgreSQL database. Used by the test harness and by `npm run db:reset:local`.
 *
 * Usage:
 *   node scripts/db/apply-migrations.mjs --url postgres://... [--shim] [--recreate] [--seed-dev]
 *
 *   --url        connection string (falls back to $DATABASE_URL)
 *   --shim       apply tests/db/supabase-shim.sql first (plain Postgres only, never on Supabase)
 *   --recreate   drop and recreate the target database before applying (local only)
 *   --seed-dev   apply supabase/seeds/dev/*.sql after the migrations
 *
 * For hosted Supabase projects prefer the Supabase CLI (`supabase db push`).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

async function readSqlFiles(dir) {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(files.map(async (file) => ({ file, sql: await readFile(path.join(dir, file), "utf8") })));
}

async function recreateDatabase(targetUrl) {
  const target = new URL(targetUrl);
  const dbName = target.pathname.replace(/^\//, "");
  if (!dbName) throw new Error("Connection string has no database name");
  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [dbName],
    );
    await admin.query(`drop database if exists "${dbName.replaceAll('"', '""')}"`);
    await admin.query(`create database "${dbName.replaceAll('"', '""')}"`);
  } finally {
    await admin.end();
  }
}

/** Search path used while applying migrations: deliberately excludes `extensions`. */
export const MIGRATION_SEARCH_PATH = "public";

export async function applyMigrations({ url: connectionString, shim = false, seedDev = false, quiet = false }) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const log = quiet ? () => {} : (msg) => console.log(msg);
  try {
    if (shim) {
      log("→ supabase-shim.sql");
      await client.query(await readFile(path.join(root, "tests/db/supabase-shim.sql"), "utf8"));
    }
    for (const { file, sql } of await readSqlFiles(path.join(root, "supabase/migrations"))) {
      log(`→ ${file}`);
      // `supabase db push` does not put the `extensions` schema on the search path, so
      // migrations must schema-qualify extension objects (extensions.citext, …).
      // Apply each file the same way so an unqualified reference fails here first.
      await client.query(`set search_path to ${MIGRATION_SEARCH_PATH}`);
      await client.query(sql);
    }
    if (seedDev) {
      for (const { file, sql } of await readSqlFiles(path.join(root, "supabase/seeds/dev"))) {
        log(`→ seed ${file}`);
        await client.query(sql);
      }
    }
  } finally {
    await client.end();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const url = option("--url") ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing --url or DATABASE_URL");
    process.exit(1);
  }
  try {
    if (flag("--recreate")) {
      console.log("→ recreating database");
      await recreateDatabase(url);
    }
    await applyMigrations({ url, shim: flag("--shim"), seedDev: flag("--seed-dev") });
    console.log("✓ migrations applied");
  } catch (error) {
    console.error("✗ migration failed");
    console.error(error);
    process.exit(1);
  }
}
