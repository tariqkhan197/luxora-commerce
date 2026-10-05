import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createPool, createUser, expectSqlError, SQLSTATE, type TestUser } from "./harness";

const pool = createPool();
let alice: TestUser;
let bob: TestUser;
let admin: TestUser;
let superAdmin: TestUser;

beforeAll(async () => {
  alice = await createUser(pool, { fullName: "Alice" });
  bob = await createUser(pool, { fullName: "Bob" });
  admin = await createUser(pool, { role: "admin", fullName: "Admin" });
  superAdmin = await createUser(pool, { role: "super_admin", fullName: "Super" });
});

afterAll(() => pool.end());

describe("profiles", () => {
  it("creates a profile automatically when an auth user is created", async () => {
    const { rows } = await pool.query("select full_name, role, status from public.profiles where user_id = $1", [
      alice.userId,
    ]);
    expect(rows).toEqual([{ full_name: "Alice", role: "customer", status: "active" }]);
  });

  it("lets a customer read only their own profile", async () => {
    const rows = await asUser(pool, alice, (s) => s.rows("select user_id from public.profiles"));
    expect(rows).toEqual([{ user_id: alice.userId }]);
  });

  it("lets a customer update their own contact details", async () => {
    await asUser(pool, alice, async (s) => {
      await s.query("update public.profiles set full_name = 'Alice Updated', phone = '+1 555 010 2030'");
      const row = await s.one("select full_name, phone from public.profiles");
      expect(row).toEqual({ full_name: "Alice Updated", phone: "+1 555 010 2030" });
    });
  });

  it("blocks a customer from escalating their own role or status", async () => {
    await asUser(pool, alice, async (s) => {
      await s.denied("update public.profiles set role = 'admin'");
    });
    await asUser(pool, alice, async (s) => {
      await s.denied("update public.profiles set status = 'suspended'");
    });
  });

  it("blocks a customer from updating someone else's profile (zero rows affected)", async () => {
    await asUser(pool, alice, async (s) => {
      const result = await s.query("update public.profiles set full_name = 'Hacked' where user_id = $1", [bob.userId]);
      expect(result.rowCount).toBe(0);
    });
    const { rows } = await pool.query("select full_name from public.profiles where user_id = $1", [bob.userId]);
    expect(rows[0].full_name).toBe("Bob");
  });

  it("rejects malformed phone numbers", async () => {
    await asUser(pool, alice, async (s) => {
      await s.fails(SQLSTATE.checkViolation, "update public.profiles set phone = 'not-a-phone'");
    });
  });

  it("lets an admin read every profile", async () => {
    const rows = await asUser(pool, admin, (s) => s.rows("select count(*)::int as n from public.profiles"));
    expect(rows[0].n).toBeGreaterThanOrEqual(4);
  });

  it("lets an admin suspend a customer but not promote to admin", async () => {
    await asUser(pool, admin, async (s) => {
      const result = await s.query("update public.profiles set status = 'suspended' where user_id = $1", [bob.userId]);
      expect(result.rowCount).toBe(1);
      await s.denied("update public.profiles set role = 'admin' where user_id = $1", [bob.userId]);
    });
  });

  it("lets a super admin promote to admin", async () => {
    await asUser(pool, superAdmin, async (s) => {
      const result = await s.query("update public.profiles set role = 'admin' where user_id = $1", [bob.userId]);
      expect(result.rowCount).toBe(1);
    });
  });

  it("denies anonymous access to profiles entirely", async () => {
    await asAnon(pool, async (s) => {
      await s.denied("select * from public.profiles");
    });
  });

  it("exposes only public platform settings to anonymous visitors", async () => {
    const rows = await asAnon(pool, (s) =>
      s.rows<{ key: string }>("select key from public.platform_settings order by key"),
    );
    expect(rows.map((r) => r.key)).toEqual(["platform.default_currency", "platform.name"]);
  });

  it("lets only super admins change platform settings", async () => {
    await asUser(pool, admin, async (s) => {
      const result = await s.query(
        "update public.platform_settings set value = '2000' where key = 'commission.default_bps'",
      );
      expect(result.rowCount).toBe(0);
    });
    await asUser(pool, superAdmin, async (s) => {
      const result = await s.query(
        "update public.platform_settings set value = '2000' where key = 'commission.default_bps'",
      );
      expect(result.rowCount).toBe(1);
    });
  });
});

describe("audit logs", () => {
  it("records the acting profile and role server-side", async () => {
    await asUser(pool, admin, async (s) => {
      await s.query("select public.log_audit_event('vendor.approved', 'vendor', 'v-1', '{\"note\":\"ok\"}')");
      const row = await s.one("select actor_id, actor_role, action, entity_id, metadata from public.audit_logs");
      expect(row).toEqual({
        actor_id: admin.profileId,
        actor_role: "admin",
        action: "vendor.approved",
        entity_id: "v-1",
        metadata: { note: "ok" },
      });
    });
  });

  it("is append-only even for the superuser", async () => {
    await pool.query("select public.log_audit_event('settings.changed', 'platform_settings', 'x')");
    await expectSqlError(pool.query("update public.audit_logs set action = 'tampered'"), SQLSTATE.restrictViolation);
    await expectSqlError(pool.query("delete from public.audit_logs"), SQLSTATE.restrictViolation);
  });

  it("is invisible to customers", async () => {
    const rows = await asUser(pool, alice, (s) => s.rows("select * from public.audit_logs"));
    expect(rows).toEqual([]);
  });

  it("rejects malformed action names", async () => {
    await expectSqlError(pool.query("select public.log_audit_event('BadAction', 'x')"), SQLSTATE.checkViolation);
  });
});
