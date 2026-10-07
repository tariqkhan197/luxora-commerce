import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAddress, addToCart, openCheckoutSession, placeOrder } from "./checkout-fixtures";
import {
  asAnon,
  asService,
  asUser,
  createActiveProduct,
  createApprovedVendor,
  createPool,
  createUser,
  SQLSTATE,
  type TestUser,
} from "./harness";

const pool = createPool();
let admin: TestUser;

beforeAll(async () => {
  admin = await createUser(pool, { role: "admin" });
});
afterAll(() => pool.end());

/**
 * A paid order of one product from one vendor (owner + staff), delivered
 * `deliveredDaysAgo` days ago (null = not delivered yet).
 */
async function purchase(options: { deliveredDaysAgo?: number | null; fullName?: string; paid?: boolean } = {}) {
  const customer = await createUser(pool, { fullName: options.fullName ?? "Jane Mary Doe" });
  const owner = await createUser(pool);
  const staff = await createUser(pool);
  const { vendorId } = await createApprovedVendor(pool, owner);
  await pool.query("insert into public.vendor_users (vendor_id, profile_id, role) values ($1, $2, 'staff')", [
    vendorId,
    staff.profileId,
  ]);
  const product = await createActiveProduct(pool, vendorId, { priceMinor: 5_000, stock: 10 });
  const addressId = await addAddress(pool, customer);
  await addToCart(pool, customer, product.variantId, 1);
  const orderId = await placeOrder(pool, customer, addressId);
  if (options.paid ?? true) {
    const session = await openCheckoutSession(pool, customer, orderId);
    const { rows } = await pool.query<{ total_minor: string }>("select total_minor from public.orders where id = $1", [
      orderId,
    ]);
    await asService(
      pool,
      (s) =>
        s.query("select * from public.confirm_order_payment($1, 'stripe', $2, $3, 'USD', 200, 0, $4, false)", [
          orderId,
          `pi_test_${randomUUID().slice(0, 12)}`,
          Number(rows[0].total_minor),
          session.sessionId,
        ]),
      true,
    );
  }
  const vo = await pool.query<{ id: string }>("select id from public.vendor_orders where order_id = $1", [orderId]);
  if (options.deliveredDaysAgo !== null) {
    await pool.query(
      "update public.vendor_orders set status = 'delivered', shipped_at = now() - interval '40 days', delivered_at = now() - make_interval(days => $2) where id = $1",
      [vo.rows[0].id, options.deliveredDaysAgo ?? 2],
    );
  }
  const item = await pool.query<{ id: string }>("select id from public.order_items where order_id = $1", [orderId]);
  return { customer, owner, staff, vendorId, orderId, itemId: item.rows[0].id, ...product };
}

type Purchase = Awaited<ReturnType<typeof purchase>>;

const submit = (
  p: Purchase,
  rating = 4,
  body = "Beautiful cut and the fabric feels great.",
  title: string | null = "Lovely",
) =>
  asUser(
    pool,
    p.customer,
    (s) => s.one<{ id: string }>("select public.submit_review($1, $2, $3, $4) as id", [p.itemId, rating, title, body]),
    true,
  ).then((r) => r.id);

const moderate = (reviewId: string, approve: boolean, reason: string | null = null) =>
  asUser(pool, admin, (s) => s.query("select public.moderate_review($1, $2, $3)", [reviewId, approve, reason]), true);

async function reviewRow(id: string) {
  const { rows } = await pool.query("select * from public.reviews where id = $1", [id]);
  return rows[0];
}

async function stats(productId: string) {
  const { rows } = await pool.query<{ review_count: number; rating_sum: number; rating_4: number; rating_5: number }>(
    "select review_count, rating_sum, rating_4, rating_5 from public.product_review_stats where product_id = $1",
    [productId],
  );
  return rows[0] ?? { review_count: 0, rating_sum: 0, rating_4: 0, rating_5: 0 };
}

const publicReviews = (productId: string) =>
  asAnon(pool, (s) => s.rows<{ id: string }>("select id from public.reviews where product_id = $1", [productId]));

describe("writing a review", () => {
  it("lets a verified buyer review a delivered product, hidden until approved", async () => {
    const p = await purchase();
    const eligible = await asUser(pool, p.customer, (s) =>
      s.rows("select * from public.review_eligibility($1)", [p.productId]),
    );
    expect(eligible).toEqual([
      expect.objectContaining({ order_item_id: p.itemId, product_id: p.productId, variant_title: "Default" }),
    ]);

    const id = await submit(p);
    expect(await reviewRow(id)).toMatchObject({
      status: "pending",
      rating: 4,
      title: "Lovely",
      vendor_id: p.vendorId,
      order_item_id: p.itemId,
      author_name: "Jane D.",
      purchased_variant: "Default",
    });
    expect(await publicReviews(p.productId)).toEqual([]);
    const own = await asUser(pool, p.customer, (s) =>
      s.rows("select id, status from public.reviews where product_id = $1", [p.productId]),
    );
    expect(own).toEqual([{ id, status: "pending" }]);
    const vendorView = await asUser(pool, p.owner, (s) =>
      s.rows("select id from public.reviews where product_id = $1", [p.productId]),
    );
    expect(vendorView).toEqual([]);
    expect(await stats(p.productId)).toMatchObject({ review_count: 0 });

    const after = await asUser(pool, p.customer, (s) => s.rows("select * from public.review_eligibility()"));
    expect(after).toEqual([]);
    const audit = await pool.query(
      "select 1 from public.audit_logs where action = 'review.submitted' and entity_id = $1",
      [id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("refuses undelivered items, a closed window, other customers and duplicates", async () => {
    const undelivered = await purchase({ deliveredDaysAgo: null });
    await asUser(pool, undelivered.customer, async (s) => {
      expect(await s.rows("select * from public.review_eligibility()")).toEqual([]);
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.submit_review($1, 5, null, 'Great quality overall')",
        [undelivered.itemId],
      );
      expect(error.message).toBe("You can review this item once it has been delivered.");
    });

    const late = await purchase({ deliveredDaysAgo: 31 });
    await asUser(pool, late.customer, async (s) => {
      expect(await s.rows("select * from public.review_eligibility()")).toEqual([]);
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.submit_review($1, 5, null, 'Great quality overall')",
        [late.itemId],
      );
      expect(error.message).toBe("The 30 day review window for this item has closed.");
    });
    const inWindow = await purchase({ deliveredDaysAgo: 29 });
    await submit(inWindow);

    const p = await purchase();
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.submit_review($1, 5, null, 'Great quality overall')", [p.itemId]),
    );
    await submit(p);
    await asUser(pool, p.customer, async (s) => {
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.submit_review($1, 3, null, 'Second opinion here')",
        [p.itemId],
      );
      expect(error.message).toBe("You have already reviewed this product. You can edit your review instead.");
    });
  });

  it("refuses unpaid orders and products no longer on sale", async () => {
    const unpaid = await purchase({ paid: false });
    await asUser(pool, unpaid.customer, async (s) => {
      expect(await s.rows("select * from public.review_eligibility()")).toEqual([]);
      const error = await s.fails(
        SQLSTATE.raiseException,
        "select public.submit_review($1, 5, null, 'Great quality overall')",
        [unpaid.itemId],
      );
      expect(error.message).toBe("Only paid orders can be reviewed.");
    });

    const archived = await purchase();
    await pool.query("update public.products set status = 'archived' where id = $1", [archived.productId]);
    await asUser(pool, archived.customer, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.submit_review($1, 5, null, 'Great quality overall')", [
        archived.itemId,
      ]),
    );
  });

  it("still allows reviews of refunded or returned purchases", async () => {
    const p = await purchase();
    await pool.query("update public.orders set payment_status = 'refunded', status = 'refunded' where id = $1", [
      p.orderId,
    ]);
    await submit(p, 2, "Did not fit, sent it back.");
  });

  it("validates rating, title and body", async () => {
    const p = await purchase();
    await asUser(pool, p.customer, async (s) => {
      const rating = await s.fails(
        SQLSTATE.raiseException,
        "select public.submit_review($1, 6, null, 'Great quality overall')",
        [p.itemId],
      );
      expect(rating.message).toBe("Choose a rating from 1 to 5 stars.");
      const body = await s.fails(SQLSTATE.raiseException, "select public.submit_review($1, 5, null, '  short  ')", [
        p.itemId,
      ]);
      expect(body.message).toBe("Tell other shoppers a little more (at least 10 characters).");
      await s.fails(SQLSTATE.raiseException, "select public.submit_review($1, 5, $2, 'Great quality overall')", [
        p.itemId,
        "x".repeat(121),
      ]);
    });
  });

  it("uses a neutral author name when the profile has no name", async () => {
    const p = await purchase({ fullName: "Cher" });
    const id = await submit(p);
    expect((await reviewRow(id)).author_name).toBe("Cher");
    const q = await purchase();
    await pool.query("update public.profiles set full_name = null where id = $1", [q.customer.profileId]);
    expect((await reviewRow(await submit(q))).author_name).toBe("Verified buyer");
  });
});

describe("direct table access", () => {
  it("denies every direct write for customers, vendors and visitors", async () => {
    const p = await purchase();
    const id = await submit(p);
    await asUser(pool, p.customer, async (s) => {
      await s.denied(
        "insert into public.reviews (product_id, vendor_id, customer_id, rating, body, author_name) values ($1, $2, $3, 5, 'Direct insert attempt', 'X')",
        [p.productId, p.vendorId, p.customer.profileId],
      );
      await s.denied("update public.reviews set status = 'approved' where id = $1", [id]);
      await s.denied("delete from public.reviews where id = $1", [id]);
      await s.denied("insert into public.review_images (review_id, storage_path) values ($1, 'x.jpg')", [id]);
      await s.denied("update public.product_review_stats set review_count = 99");
    });
    await asUser(pool, p.owner, (s) => s.denied("update public.reviews set vendor_reply = 'hi' where id = $1", [id]));
    await asUser(pool, admin, (s) => s.denied("update public.reviews set status = 'approved' where id = $1", [id]));
    await asAnon(pool, (s) => s.denied("delete from public.reviews where id = $1", [id]));
    expect((await reviewRow(id)).status).toBe("pending");
  });
});

describe("moderation", () => {
  it("publishes on approval, records reasons on rejection and keeps rating totals exact", async () => {
    const p = await purchase();
    const id = await submit(p, 4);

    await asUser(pool, p.owner, (s) => s.denied("select public.moderate_review($1, true, null)", [id]));
    await asUser(pool, p.customer, (s) => s.denied("select public.moderate_review($1, true, null)", [id]));
    await asUser(pool, admin, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.moderate_review($1, false, ' ')", [id]);
      expect(error.message).toBe("Give the customer a reason (at least 3 characters).");
    });

    await moderate(id, false, "Contains a personal phone number");
    expect(await reviewRow(id)).toMatchObject({
      status: "rejected",
      rejection_reason: "Contains a personal phone number",
      moderated_by: admin.profileId,
    });
    expect(await publicReviews(p.productId)).toEqual([]);

    await moderate(id, true);
    expect(await reviewRow(id)).toMatchObject({ status: "approved", rejection_reason: null });
    expect(await publicReviews(p.productId)).toEqual([{ id }]);
    expect(await stats(p.productId)).toMatchObject({ review_count: 1, rating_sum: 4, rating_4: 1 });
    const listing = await asAnon(pool, (s) =>
      s.one<{ review_count: number; rating_sum: number }>(
        "select review_count, rating_sum from public.product_listings where id = $1",
        [p.productId],
      ),
    );
    expect(listing).toEqual({ review_count: 1, rating_sum: 4 });
    const publicStats = await asAnon(pool, (s) =>
      s.rows("select review_count from public.product_review_stats where product_id = $1", [p.productId]),
    );
    expect(publicStats).toEqual([{ review_count: 1 }]);

    await asUser(pool, admin, (s) =>
      s.fails(SQLSTATE.raiseException, "select public.moderate_review($1, true, null)", [id]),
    );

    // Taking a published review down removes it from the totals.
    await moderate(id, false, "Off-topic");
    expect(await stats(p.productId)).toMatchObject({ review_count: 0, rating_sum: 0 });

    const actions = await pool.query<{ action: string }>(
      "select action from public.audit_logs where entity_type = 'review' and entity_id = $1 order by id",
      [id],
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      "review.submitted",
      "review.rejected",
      "review.approved",
      "review.rejected",
    ]);
  });

  it("sends an edited review back to moderation and out of the totals", async () => {
    const p = await purchase();
    const id = await submit(p, 5);
    await moderate(id, true);
    expect(await stats(p.productId)).toMatchObject({ review_count: 1, rating_5: 1 });

    // Saving identical content is a no-op.
    await asUser(
      pool,
      p.customer,
      (s) => s.query("select public.update_review($1, 5, 'Lovely', 'Beautiful cut and the fabric feels great.')", [id]),
      true,
    );
    expect((await reviewRow(id)).status).toBe("approved");

    await asUser(
      pool,
      p.customer,
      (s) => s.query("select public.update_review($1, 4, null, 'Still lovely, but it shrank a little.')", [id]),
      true,
    );
    expect(await reviewRow(id)).toMatchObject({ status: "pending", rating: 4, title: null });
    expect(await stats(p.productId)).toMatchObject({ review_count: 0, rating_sum: 0 });
    expect(await publicReviews(p.productId)).toEqual([]);

    await moderate(id, true);
    expect(await stats(p.productId)).toMatchObject({ review_count: 1, rating_sum: 4, rating_4: 1, rating_5: 0 });

    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.update_review($1, 1, null, 'Not my review at all')", [id]),
    );
  });

  it("lets the author delete their review, which updates the totals", async () => {
    const p = await purchase();
    const id = await submit(p, 5);
    await moderate(id, true);
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) => s.fails(SQLSTATE.noDataFound, "select * from public.delete_review($1)", [id]));
    await asUser(pool, p.owner, (s) => s.fails(SQLSTATE.noDataFound, "select * from public.delete_review($1)", [id]));

    await asUser(pool, p.customer, (s) => s.query("select * from public.delete_review($1)", [id]), true);
    expect(await reviewRow(id)).toBeUndefined();
    expect(await stats(p.productId)).toMatchObject({ review_count: 0 });
    // The purchase can be reviewed again while the window is open.
    const eligible = await asUser(pool, p.customer, (s) => s.rows("select * from public.review_eligibility()"));
    expect(eligible).toHaveLength(1);
  });
});

describe("vendor replies", () => {
  it("lets the vendor owner or manager reply once a review is published", async () => {
    const p = await purchase();
    const id = await submit(p);
    await asUser(pool, p.owner, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.reply_to_review($1, 'Thank you!')", [id]),
    );
    await moderate(id, true);

    await asUser(pool, p.staff, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.reply_to_review($1, 'Thank you!')", [id]),
    );
    const otherOwner = await createUser(pool);
    await createApprovedVendor(pool, otherOwner);
    await asUser(pool, otherOwner, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.reply_to_review($1, 'Thank you!')", [id]),
    );
    await asUser(pool, p.owner, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.reply_to_review($1, ' ')", [id]);
      expect(error.message).toBe("Write a reply (at least 2 characters).");
    });

    await asUser(pool, p.owner, (s) => s.query("select public.reply_to_review($1, ' Thank you, Jane! ')", [id]), true);
    const published = await asAnon(pool, (s) =>
      s.one<{ vendor_reply: string; vendor_replied_at: Date | null }>(
        "select vendor_reply, vendor_replied_at from public.reviews where id = $1",
        [id],
      ),
    );
    expect(published.vendor_reply).toBe("Thank you, Jane!");
    expect(published.vendor_replied_at).not.toBeNull();

    // Edit: still one reply.
    await asUser(pool, p.owner, (s) => s.query("select public.reply_to_review($1, 'Thanks again!')", [id]), true);
    expect((await reviewRow(id)).vendor_reply).toBe("Thanks again!");
  });

  it("lets an administrator remove a reply, with an audit entry", async () => {
    const p = await purchase();
    const id = await submit(p);
    await moderate(id, true);
    await asUser(pool, p.owner, (s) => s.query("select public.reply_to_review($1, 'Thank you!')", [id]), true);
    await asUser(pool, p.customer, (s) => s.fails(SQLSTATE.noDataFound, "select public.remove_review_reply($1)", [id]));
    await asUser(pool, admin, (s) => s.query("select public.remove_review_reply($1)", [id]), true);
    expect(await reviewRow(id)).toMatchObject({ vendor_reply: null, vendor_replied_at: null });
    const audit = await pool.query<{ metadata: { by_admin: boolean } }>(
      "select metadata from public.audit_logs where action = 'review.reply_removed' and entity_id = $1",
      [id],
    );
    expect(audit.rows).toEqual([{ metadata: expect.objectContaining({ by_admin: true }) }]);
    await asUser(pool, admin, (s) => s.fails(SQLSTATE.raiseException, "select public.remove_review_reply($1)", [id]));
  });
});

describe("review photos", () => {
  const upload = (user: TestUser, path: string) =>
    asUser(
      pool,
      user,
      (s) => s.query("insert into storage.objects (bucket_id, name) values ('review-images', $1)", [path]),
      true,
    );
  const attach = (user: TestUser, reviewId: string, path: string) =>
    asUser(
      pool,
      user,
      (s) => s.one<{ id: string }>("select public.attach_review_image($1, $2) as id", [reviewId, path]),
      true,
    ).then((r) => r.id);

  it("accepts up to four uploaded photos under the author's own review", async () => {
    const p = await purchase();
    const id = await submit(p);
    const base = `${p.customer.profileId}/${id}`;

    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.denied("insert into storage.objects (bucket_id, name) values ('review-images', $1)", [`${base}/a.jpg`]),
    );
    await asUser(pool, p.customer, (s) =>
      s.denied("insert into storage.objects (bucket_id, name) values ('review-images', $1)", [
        `${p.customer.profileId}/${randomUUID()}/a.jpg`,
      ]),
    );
    await asUser(pool, p.customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.attach_review_image($1, $2)", [
        id,
        `${base}/missing.jpg`,
      ]);
      expect(error.message).toBe("Upload the photo before adding it to your review.");
      await s.fails(SQLSTATE.raiseException, "select public.attach_review_image($1, $2)", [id, "elsewhere/a.jpg"]);
    });

    for (const name of ["a.jpg", "b.png", "c.webp", "d.jpg", "e.jpg"]) {
      await upload(p.customer, `${base}/${name}`);
    }
    for (const name of ["a.jpg", "b.png", "c.webp", "d.jpg"]) {
      await attach(p.customer, id, `${base}/${name}`);
    }
    await asUser(pool, p.customer, async (s) => {
      const error = await s.fails(SQLSTATE.raiseException, "select public.attach_review_image($1, $2)", [
        id,
        `${base}/e.jpg`,
      ]);
      expect(error.message).toBe("You can add up to 4 photos to a review.");
      const own = await s.rows("select position from public.review_images where review_id = $1 order by position", [
        id,
      ]);
      expect(own).toEqual([{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3 }]);
    });
  });

  it("hides photos until the review is published and re-moderates new photos", async () => {
    const p = await purchase();
    const id = await submit(p);
    const path = `${p.customer.profileId}/${id}/one.jpg`;
    await upload(p.customer, path);
    const imageId = await attach(p.customer, id, path);

    const anonImages = () =>
      asAnon(pool, (s) => s.rows("select storage_path from public.review_images where review_id = $1", [id]));
    const anonObjects = () =>
      asAnon(pool, (s) =>
        s.rows("select name from storage.objects where bucket_id = 'review-images' and name = $1", [path]),
      );
    expect(await anonImages()).toEqual([]);
    expect(await anonObjects()).toEqual([]);

    await moderate(id, true);
    expect(await anonImages()).toEqual([{ storage_path: path }]);
    expect(await anonObjects()).toEqual([{ name: path }]);

    const second = `${p.customer.profileId}/${id}/two.jpg`;
    await upload(p.customer, second);
    await attach(p.customer, id, second);
    expect((await reviewRow(id)).status).toBe("pending");
    expect(await anonImages()).toEqual([]);

    // Removing a photo needs no moderation and returns the path for cleanup.
    const stranger = await createUser(pool);
    await asUser(pool, stranger, (s) =>
      s.fails(SQLSTATE.noDataFound, "select public.remove_review_image($1)", [imageId]),
    );
    const removed = await asUser(
      pool,
      p.customer,
      (s) => s.one<{ path: string }>("select public.remove_review_image($1) as path", [imageId]),
      true,
    );
    expect(removed.path).toBe(path);
  });

  it("returns photo paths on delete so the author can remove the files", async () => {
    const p = await purchase();
    const id = await submit(p);
    const path = `${p.customer.profileId}/${id}/one.jpg`;
    await upload(p.customer, path);
    await attach(p.customer, id, path);

    const paths = await asUser(
      pool,
      p.customer,
      (s) => s.rows<{ delete_review: string }>("select * from public.delete_review($1)", [id]),
      true,
    );
    expect(paths.map((r) => r.delete_review)).toEqual([path]);
    await asUser(
      pool,
      p.customer,
      async (s) => {
        const result = await s.query("delete from storage.objects where bucket_id = 'review-images' and name = $1", [
          path,
        ]);
        expect(result.rowCount).toBe(1);
      },
      true,
    );
  });
});
