import { afterAll, describe, expect, it } from "vitest";
import { addAddress, addToCart, newVendor, openCheckoutSession, placeOrder } from "./checkout-fixtures";
import { asService, createActiveProduct, createPool, createUser, expectSqlError, SQLSTATE } from "./harness";

const pool = createPool();
afterAll(() => pool.end());

describe("Stripe Tax readiness (disabled)", () => {
  it("keeps tax collection off", async () => {
    const { rows } = await pool.query(
      "select value from public.platform_settings where key = 'tax.collection_enabled'",
    );
    expect(rows[0].value).toBe(false);
  });

  it("validates tax codes and snapshots the product's or category's code on order items", async () => {
    const { vendorId } = await newVendor(pool);
    const parent = await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, tax_code) values ('tax-parent-' || substr(md5(random()::text), 1, 6), 'Tax parent', 'txcd_30011000') returning id",
    );
    const child = await pool.query<{ id: string }>(
      "insert into public.categories (slug, name, parent_id) values ('tax-child-' || substr(md5(random()::text), 1, 6), 'Tax child', $1) returning id",
      [parent.rows[0].id],
    );
    const product = await createActiveProduct(pool, vendorId, { stock: 5, categoryId: child.rows[0].id });
    await expectSqlError(
      pool.query("update public.products set tax_code = 'not-a-code' where id = $1", [product.productId]),
      SQLSTATE.checkViolation,
    );

    const customer = await createUser(pool);
    const addressId = await addAddress(pool, customer);
    await addToCart(pool, customer, product.variantId, 1);
    const orderId = await placeOrder(pool, customer, addressId);
    const item = await pool.query("select tax_code, tax_minor from public.order_items where order_id = $1", [orderId]);
    expect(item.rows[0]).toEqual({ tax_code: "txcd_30011000", tax_minor: "0" });

    // A payment that carries tax is refused while tax collection is disabled.
    const session = await openCheckoutSession(pool, customer, orderId);
    await asService(pool, (s) =>
      s.fails(
        SQLSTATE.checkViolation,
        "select * from public.confirm_order_payment($1, 'stripe', 'pi_test_tax1', 10100, 'USD', 0, 100, $2, false)",
        [orderId, session.sessionId],
      ),
    );
  });
});
