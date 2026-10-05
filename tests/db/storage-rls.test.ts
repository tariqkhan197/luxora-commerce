import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createApprovedVendor, createPool, createUser, type TestUser } from "./harness";

const pool = createPool();
let owner: TestUser;
let customer: TestUser;
let admin: TestUser;
let vendorId: string;
let otherVendorId: string;

beforeAll(async () => {
  owner = await createUser(pool);
  customer = await createUser(pool);
  admin = await createUser(pool, { role: "admin" });
  ({ vendorId } = await createApprovedVendor(pool, owner));
  ({ vendorId: otherVendorId } = await createApprovedVendor(pool, await createUser(pool)));
});

afterAll(() => pool.end());

describe("storage buckets", () => {
  it("creates all expected buckets with the right visibility", async () => {
    const { rows } = await pool.query<{ id: string; public: boolean }>(
      "select id, public from storage.buckets order by id",
    );
    expect(rows).toEqual([
      { id: "avatars", public: true },
      { id: "banners", public: true },
      { id: "product-images", public: true },
      { id: "review-images", public: true },
      { id: "vendor-covers", public: true },
      { id: "vendor-documents", public: false },
      { id: "vendor-logos", public: true },
    ]);
  });

  it("lets vendor members upload only under their own vendor folder", async () => {
    await asUser(pool, owner, async (s) => {
      await s.query("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [
        `${vendorId}/p1/front.jpg`,
      ]);
      await s.denied("insert into storage.objects (bucket_id, name) values ('product-images', $1)", [
        `${otherVendorId}/p1/front.jpg`,
      ]);
    });
    await asUser(pool, owner, async (s) => {
      await s.denied("insert into storage.objects (bucket_id, name) values ('banners', 'hero.jpg')");
    });
  });

  it("lets users manage their own avatar folder only", async () => {
    await asUser(pool, customer, async (s) => {
      await s.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [
        `${customer.profileId}/me.png`,
      ]);
      await s.denied("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [
        `${owner.profileId}/me.png`,
      ]);
    });
  });

  it("keeps vendor documents private to the applicant and admins", async () => {
    await pool.query("insert into storage.objects (bucket_id, name) values ('vendor-documents', $1)", [
      `${customer.profileId}/id.pdf`,
    ]);
    const anon = await asAnon(pool, (s) =>
      s.rows("select name from storage.objects where bucket_id = 'vendor-documents'"),
    );
    expect(anon).toEqual([]);
    const other = await asUser(pool, owner, (s) =>
      s.rows("select name from storage.objects where bucket_id = 'vendor-documents'"),
    );
    expect(other).toEqual([]);
    const self = await asUser(pool, customer, (s) =>
      s.rows("select name from storage.objects where bucket_id = 'vendor-documents'"),
    );
    expect(self).toHaveLength(1);
    const adminRows = await asUser(pool, admin, (s) =>
      s.rows("select name from storage.objects where bucket_id = 'vendor-documents'"),
    );
    expect(adminRows).toHaveLength(1);
  });

  it("serves public bucket objects to anonymous visitors", async () => {
    await pool.query("insert into storage.objects (bucket_id, name) values ('banners', 'spring.jpg')");
    const rows = await asAnon(pool, (s) => s.rows("select name from storage.objects where bucket_id = 'banners'"));
    expect(rows).toEqual([{ name: "spring.jpg" }]);
  });
});
