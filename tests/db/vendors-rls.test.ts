import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createApprovedVendor, createPool, createUser, type TestUser } from "./harness";

const pool = createPool();
let applicant: TestUser;
let stranger: TestUser;
let admin: TestUser;
let owner: TestUser;
let vendorId: string;

beforeAll(async () => {
  applicant = await createUser(pool, { fullName: "Applicant" });
  stranger = await createUser(pool, { fullName: "Stranger" });
  admin = await createUser(pool, { role: "admin" });
  owner = await createUser(pool, { fullName: "Owner" });
  ({ vendorId } = await createApprovedVendor(pool, owner, { slug: "atelier-nord" }));
});

afterAll(() => pool.end());

describe("vendor applications", () => {
  const description = "An independent atelier producing small-batch outerwear in Copenhagen.";

  it("lets a customer submit an application for themselves only", async () => {
    await asUser(pool, applicant, async (s) => {
      await s.query(
        `insert into public.vendor_applications (profile_id, business_name, business_email, description, terms_version)
         values (public.current_profile_id(), 'Atelier Nord', 'hello@atelier.test', $1, 'test-terms-v1')`,
        [description],
      );
      const row = await s.one("select status, reviewed_by from public.vendor_applications");
      expect(row).toEqual({ status: "submitted", reviewed_by: null });

      await s.denied(
        `insert into public.vendor_applications (profile_id, business_name, business_email, description, terms_version)
           values ($1, 'Fake', 'fake@x.test', $2, 'test-terms-v1')`,
        [stranger.profileId, description],
      );
      await s.denied(
        `insert into public.vendor_applications (profile_id, business_name, business_email, description, status, terms_version)
           values (public.current_profile_id(), 'Self Approved', 'a@x.test', $1, 'approved', 'test-terms-v1')`,
        [description],
      );
    });
  });

  it("hides applications from other customers and shows them to admins", async () => {
    await asUser(
      pool,
      applicant,
      (s) =>
        s.query(
          `insert into public.vendor_applications (profile_id, business_name, business_email, description, terms_version)
           values (public.current_profile_id(), 'Atelier Nord', 'hello@atelier.test', $1, 'test-terms-v1')`,
          [description],
        ),
      true,
    );
    const strangerRows = await asUser(pool, stranger, (s) => s.rows("select id from public.vendor_applications"));
    expect(strangerRows).toEqual([]);
    const adminRows = await asUser(pool, admin, (s) =>
      s.rows("select business_name from public.vendor_applications where profile_id = $1", [applicant.profileId]),
    );
    expect(adminRows).toEqual([{ business_name: "Atelier Nord" }]);
  });

  it("lets an admin review the application", async () => {
    await asUser(pool, admin, async (s) => {
      const result = await s.query(
        `update public.vendor_applications
            set status = 'under_review', reviewed_by = public.current_profile_id(), reviewed_at = now()
          where profile_id = $1`,
        [applicant.profileId],
      );
      expect(result.rowCount).toBe(1);
    });
  });
});

describe("vendors and stores", () => {
  it("shows approved vendors and published stores to anonymous visitors", async () => {
    const rows = await asAnon(pool, (s) =>
      s.rows(
        "select v.slug, st.status from public.vendors v join public.stores st on st.vendor_id = v.id where v.id = $1",
        [vendorId],
      ),
    );
    expect(rows).toEqual([{ slug: "atelier-nord", status: "published" }]);
  });

  it("hides pending vendors from the public but not from admins", async () => {
    await pool.query(
      `insert into public.vendors (slug, legal_name, display_name, contact_email, status)
       values ('pending-house', 'Pending House Ltd', 'Pending House', 'p@h.test', 'pending')`,
    );
    const scoped = "select slug from public.vendors where slug in ('atelier-nord', 'pending-house') order by slug";
    const anonRows = await asAnon(pool, (s) => s.rows<{ slug: string }>(scoped));
    expect(anonRows.map((r) => r.slug)).toEqual(["atelier-nord"]);
    const adminRows = await asUser(pool, admin, (s) => s.rows<{ slug: string }>(scoped));
    expect(adminRows.map((r) => r.slug)).toEqual(["atelier-nord", "pending-house"]);
  });

  it("lets the owner edit presentation fields but not status or commission", async () => {
    await asUser(pool, owner, async (s) => {
      const ok = await s.query("update public.vendors set display_name = 'Atelier Nord Studio' where id = $1", [
        vendorId,
      ]);
      expect(ok.rowCount).toBe(1);
      await s.denied("update public.vendors set status = 'suspended' where id = $1", [vendorId]);
    });
    await asUser(pool, owner, async (s) => {
      await s.denied("update public.vendors set commission_rate_bps = 0 where id = $1", [vendorId]);
    });
  });

  it("lets an admin change vendor status", async () => {
    await asUser(pool, admin, async (s) => {
      const result = await s.query(
        "update public.vendors set status = 'suspended', suspended_at = now(), suspension_reason = 'test' where id = $1",
        [vendorId],
      );
      expect(result.rowCount).toBe(1);
    });
  });

  it("prevents strangers from editing a vendor or its store", async () => {
    await asUser(pool, stranger, async (s) => {
      const vendor = await s.query("update public.vendors set display_name = 'Hijacked' where id = $1", [vendorId]);
      expect(vendor.rowCount).toBe(0);
      const store = await s.query("update public.stores set name = 'Hijacked' where vendor_id = $1", [vendorId]);
      expect(store.rowCount).toBe(0);
    });
  });

  it("lets the owner manage team members and enforces a single owner", async () => {
    const staff = await createUser(pool, { fullName: "Staff" });
    await asUser(pool, owner, async (s) => {
      await s.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
        vendorId,
        staff.profileId,
      ]);
      const members = await s.rows<{ role: string }>(
        "select role from public.vendor_users where vendor_id = $1 order by role",
        [vendorId],
      );
      expect(members.map((m) => m.role)).toEqual(["owner", "staff"]);
      await expect(
        s.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'owner')", [
          vendorId,
          stranger.profileId,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });
});
