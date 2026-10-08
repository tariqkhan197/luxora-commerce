import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `supabase db push` runs migrations without the `extensions` schema on the
 * search path, so every object provided by an extension installed there must
 * be schema-qualified (e.g. `extensions.citext`). This guard fails fast,
 * without a database, if a migration reintroduces an unqualified reference.
 */
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

// Types, operator classes and functions provided by citext, pg_trgm and pgcrypto.
const EXTENSION_OBJECTS = [
  "citext",
  "gin_trgm_ops",
  "gist_trgm_ops",
  "similarity",
  "word_similarity",
  "crypt",
  "gen_salt",
  "digest",
  "hmac",
  "pgp_sym_encrypt",
  "pgp_sym_decrypt",
];

function unqualifiedReferences(sql: string): string[] {
  const findings: string[] = [];
  // Split on CRLF too: on a Windows checkout (core.autocrlf) every line ends in "\r", which `.` does not
  // match, so the comment stripping below would miss and comments would be flagged.
  sql.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/--.*$/, "");
    if (/^\s*create extension/i.test(line)) return;
    for (const name of EXTENSION_OBJECTS) {
      const pattern = new RegExp(`(?<![\\w.])${name}\\b(?!["'])`, "i");
      if (pattern.test(line)) findings.push(`line ${index + 1}: ${rawLine.trim()}`);
    }
  });
  return findings;
}

describe("migration extension qualification", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));

  it("finds the migrations", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s schema-qualifies every extension object", (file) => {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    expect(unqualifiedReferences(sql)).toEqual([]);
  });

  it("detects an unqualified reference", () => {
    expect(unqualifiedReferences("  email citext not null,")).toHaveLength(1);
    expect(unqualifiedReferences("create index i on t using gin (name gin_trgm_ops);")).toHaveLength(1);
    expect(unqualifiedReferences("  email extensions.citext not null,")).toEqual([]);
    expect(unqualifiedReferences('create extension if not exists "citext" with schema extensions;')).toEqual([]);
    expect(unqualifiedReferences("-- citext is case-insensitive")).toEqual([]);
    // Windows line endings: comments are still ignored, real references still found.
    expect(unqualifiedReferences("-- citext is case-insensitive\r\nselect 1;\r\n")).toEqual([]);
    expect(unqualifiedReferences("select 1;\r\n  email citext not null,\r\n")).toEqual([
      "line 2: email citext not null,",
    ]);
  });
});
