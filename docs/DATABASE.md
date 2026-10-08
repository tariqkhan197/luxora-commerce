# Luxora — Database

PostgreSQL (Supabase). Migrations in `supabase/migrations/`, applied in filename order. All tables are in
`public`, all have RLS enabled, and the API roles have explicit, minimal grants.

## Conventions

| Concern      | Convention                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys | `uuid` (`gen_random_uuid()`); append-only logs use `bigint identity`                                                                                                                                                                            |
| Money        | `bigint` **minor units** (`*_minor`) + `currency char(3)`; domain `money_minor` ≥ 0                                                                                                                                                             |
| Rates        | `integer` **basis points** (`*_bps`, 10000 = 100 %); domain `basis_points`                                                                                                                                                                      |
| Slugs        | domain `slug_text`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–120 chars                                                                                                                                                                                   |
| Timestamps   | `timestamptz`; `updated_at` maintained by `set_updated_at()` trigger                                                                                                                                                                            |
| Statuses     | PostgreSQL enums (extend with `alter type … add value` in a migration)                                                                                                                                                                          |
| Snapshots    | Orders copy product names, SKUs, prices and addresses at purchase time                                                                                                                                                                          |
| Extensions   | `pgcrypto`, `citext`, `pg_trgm` in schema `extensions`. Always schema-qualify their objects in migrations (`extensions.citext`, `extensions.gin_trgm_ops`, `extensions.crypt`): `supabase db push` does not put `extensions` on the search path |

## Migrations

| File                                         | Contents                                                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_foundation_extensions_enums`           | Extensions, all enums, domains, `set_updated_at()`                                                                                                                                                                      |
| `0002_identity_security`                     | `roles`, `profiles`, auth trigger, RLS helpers, `platform_settings`, `audit_logs` + `log_audit_event()`                                                                                                                 |
| `0003_vendors`                               | `vendors`, `vendor_users`, `vendor_applications`, `stores`, membership helpers, locked-column trigger                                                                                                                   |
| `0004_catalog_inventory`                     | `categories`, `brands`, `products`, `product_variants`, `product_images`, `collections`, `collection_products`, `inventory`, `inventory_movements`, safe inventory functions                                            |
| `0005_customer_data`                         | `addresses`, `carts`, `cart_items`, `wishlists`, `wishlist_items`                                                                                                                                                       |
| `0006_orders_payments`                       | `orders`, `vendor_orders`, `order_items`, `payments`, `payment_transactions`, `returns`, `refunds`, order number generator                                                                                              |
| `0007_reviews_promotions`                    | `reviews`, `review_images`, `coupons`, `coupon_usages`, `flash_sales`, `flash_sale_items`                                                                                                                               |
| `0008_finance_monetization`                  | `commission_rules`, `commissions`, `payouts`, `payout_items`, `subscription_plans`, `vendor_subscriptions`, `featured_products`, `featured_brands`, `resolve_commission_rate_bps()`, `calculate_commission_minor()`     |
| `0009_engagement_content_analytics`          | `loyalty_accounts`, `loyalty_transactions`, `notifications`, `content_sections`, `banners`, `analytics_events`                                                                                                          |
| `0010_storage`                               | Buckets and `storage.objects` policies                                                                                                                                                                                  |
| `0011_grants`                                | Explicit privileges for `anon`, `authenticated`, `service_role`                                                                                                                                                         |
| `0012_phase2_vendor_catalog_workflows`       | `products.search_vector`, vendor review and product moderation functions, `product_listings` and `product_variant_availability` views                                                                                   |
| `20261006000013_phase3_cart_checkout_orders` | Cart functions, shared stock helpers, `place_order()`, expiry and cancellation, `confirm_order_payment()`, immutable order financials, vendor fulfilment rules, tightened grants                                        |
| `20261007000014_admin_taxonomy`              | `catalog-assets` bucket, category depth/cycle limits, delete guards for used categories/brands, `set_category_active()`, taxonomy audit trigger, brand usage rule, vendor brand created on approval                     |
| `20261007000015_shipping_zones_rates`        | `shipping_zones`, `shipping_zone_countries`, `vendor_shipping_rates`, `admin_save_shipping_zone()`, publish gate, `checkout_shipping_quote()`, `place_order()` charging shipping                                        |
| `20261007000016_legal_acceptance`            | `vendor_applications.terms_version` / `terms_accepted_at`, recorded by the database on submission                                                                                                                       |
| `20261008000017_payment_enums`               | `payment_status` values `processing` / `expired`, payment attempt and webhook event types (separate so new enum values commit before use)                                                                               |
| `20261008000018_stripe_payments`             | `payment_attempts`, `payment_customers`, `payment_webhook_events`, attempt/session functions, idempotent `confirm_order_payment` v2, payment-aware expiry and cancellation, restore cart, currency and 100-line guards  |
| `20261008000019_refunds_ledgers`             | `refund_items`, `vendor_ledger_entries`, `platform_ledger_entries`, `payment_disputes`, refund/dispute/payout functions, `vendor_balances`, finance tables read-only for API roles                                      |
| `20261008000020_tax_readiness`               | Tax codes on products, categories and order items (snapshot), `orders.tax_calculation_ref`; tax collection stays disabled                                                                                               |
| `20261009000021_returns_rma`                 | `return_requests` + `return_request_items` (RMA per vendor order), customer/vendor/admin return functions, return refunds through `request_refund`, legacy `returns` table made read-only                               |
| `20261010000022_reviews`                     | Verified-purchase reviews with pre-moderation, photos, vendor replies; `product_review_stats` totals; review writes function-only; `product_listings` gains `review_count`/`rating_sum`; review photo storage policies  |
| `20261011000023_promotion_enums`             | `promotion_cost` / `promotion_cost_reversed` ledger types, `coupon_usage_status`                                                                                                                                        |
| `20261011000024_promotions`                  | Coupons and flash sales: flash prices in `cart_lines()` and catalog views, code evaluation and allocation, funding columns on orders, reservations, refunds of paid amounts, management functions, function-only writes |

## Entity relationships

```
auth.users 1─1 profiles ──< vendor_users >── vendors 1─1 stores
                 │                              │
                 │                              ├──< products ──< product_variants 1─1 inventory ──< inventory_movements
                 │                              │        │              └──< product_images
                 │                              │        ├── category (tree) / brand
                 │                              │        └──< collection_products >── collections
                 │                              ├──< vendor_orders ──< order_items
                 │                              ├──< commissions, payouts ──< payout_items, vendor_subscriptions ── subscription_plans
                 │                              └──< coupons (vendor scope), flash_sales (vendor scope), featured_products
                 ├──< addresses, carts ──< cart_items, wishlists ──< wishlist_items
                 ├──< orders ──< vendor_orders ; orders ──< payments ──< payment_transactions
                 │        └──< refunds, returns, coupon_usages
                 ├──< reviews ──< review_images
                 ├── loyalty_accounts ──< loyalty_transactions
                 ├──< notifications, vendor_applications
                 └── audit_logs.actor_id, analytics_events.profile_id
```

### Why `order_items` carries both `order_id` and `vendor_order_id`

The brief listed `order_items` and `vendor_order_items`. Duplicating item rows per vendor order would
create two sources of truth for quantities and prices. Instead each item references its parent order **and**
its vendor order; a trigger verifies both agree on order and vendor. Customer, vendor and admin views are
then simple filters on one table.

## Financial model

```
orders.total_minor         = subtotal − discount + shipping + tax                (CHECK)
vendor_orders.total_minor  = subtotal − discount + shipping + tax                (CHECK)
vendor_orders.vendor_earnings_minor = total − commission − payment_fee           (CHECK)
order_items.total_minor    = quantity × unit_price − discount + tax              (CHECK)
payouts.net_minor          = gross − commission − fees − refunds + adjustments   (CHECK)
refunds: commission_reversed + vendor_debit ≤ amount                             (CHECK)
```

- **Commission base** is the merchandise net (`subtotal − discount`) of the vendor order.
- **Commission amount** = `calculate_commission_minor(base, rate_bps)` = `(base × bps + 5000) ÷ 10000`
  (integer division = round half up). The TypeScript `applyBasisPoints` is identical and unit-tested
  against the same cases.
- **Payment fees** reported by the provider are allocated across vendor orders with largest-remainder
  allocation (`allocateProportionally`) so the parts sum exactly.
- **Tax** is recorded per order/vendor order/item and passed through to the vendor in this model;
  jurisdictions where the platform must remit tax are a Phase 4 setting.
- Every vendor order stores the **resolved rate** so historical figures never change when rules change.

### Commission resolution (`resolve_commission_rate_bps(vendor_id, category_id)`)

1. Active `commission_rules` row with `scope = 'vendor'`
2. `vendors.commission_rate_bps` override
3. Active `scope = 'category'` rule, walking up `categories.parent_id`
4. `categories.commission_rate_bps` on that path
5. Active `scope = 'global'` rule
6. `platform_settings['commission.default_bps']` (seeded at 1500 = 15 %)

## Inventory

`inventory` holds `stock_quantity`, `reserved_quantity` and a generated `available_quantity`, with CHECKs
that nothing is negative and `reserved ≤ stock`. API roles have **no UPDATE grant on the quantity
columns**; changes go through:

| Function                    | Caller         | Effect                                                                                                       |
| --------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `adjust_inventory`          | vendor / admin | `stock += delta` (restock, damaged, manual_adjustment, …) with row lock, non-negative check and movement row |
| `reserve_inventory`         | platform only  | `reserved += qty` if available (unless backorder allowed)                                                    |
| `release_inventory`         | platform only  | `reserved −= qty`                                                                                            |
| `commit_reserved_inventory` | platform only  | `stock −= qty`, `reserved −= qty`, movement `sale`                                                           |

Movements are immutable (`prevent_mutation` trigger).

## Row Level Security summary

| Table group                            | anon                       | customer (authenticated)    | vendor member                            | admin                           |
| -------------------------------------- | -------------------------- | --------------------------- | ---------------------------------------- | ------------------------------- |
| `profiles`                             | —                          | own row (not role/status)   | own row                                  | all; promote → super_admin only |
| `vendors`, `stores`                    | approved/published         | approved/published          | own (any status); edit presentation only | all                             |
| `vendor_applications`                  | —                          | own; insert as `submitted`  | —                                        | all                             |
| catalog (`products`, variants, images) | active of approved vendors | same                        | own in any status; cannot publish        | all                             |
| `inventory`, movements                 | —                          | —                           | own; quantities via functions only       | read; functions                 |
| `addresses`, carts, wishlists          | public wishlists           | own                         | own                                      | read                            |
| `orders`                               | —                          | own                         | orders containing their vendor orders    | read/update                     |
| `vendor_orders`, `order_items`         | —                          | own                         | own; fulfilment fields only              | read/update                     |
| `payments`, `payment_transactions`     | —                          | own payments                | **none**                                 | read                            |
| `returns`                              | —                          | own; request                | own vendor; review                       | all                             |
| `refunds`, `commissions`, `payouts`    | —                          | own refunds                 | own (read)                               | all                             |
| `coupons`, `coupon_usages`             | —                          | own usages; no codes        | own vendor (read); functions write       | read; functions write           |
| `flash_sales`, `flash_sale_items`      | live sales                 | live sales                  | own vendor (read); functions write       | read; functions write           |
| `reviews`, `review_images`             | approved                   | own (any status); functions | approved; reply via function             | read; moderate via function     |
| content, banners, plans, placements    | active                     | active                      | active (+ own placements)                | all                             |
| `audit_logs`, `analytics_events`       | —                          | —                           | own vendor events                        | read                            |
| `platform_settings`                    | public keys                | public keys                 | public keys                              | read; super_admin writes        |

## Storage buckets

| Bucket             | Public | Path convention                                | Writers                       |
| ------------------ | ------ | ---------------------------------------------- | ----------------------------- |
| `product-images`   | yes    | `<vendor_id>/<product_id>/<file>`              | vendor members, admins        |
| `vendor-logos`     | yes    | `<vendor_id>/<file>`                           | vendor members, admins        |
| `vendor-covers`    | yes    | `<vendor_id>/<file>`                           | vendor members, admins        |
| `vendor-documents` | **no** | `<profile_id>/<file>`                          | applicant; admins read        |
| `avatars`          | yes    | `<profile_id>/<file>`                          | owner, admins                 |
| `review-images`    | yes ¹  | `<profile_id>/<review_id>/<file>`              | author of that review, admins |
| `banners`          | yes    | `<file>`                                       | admins                        |
| `catalog-assets`   | yes    | `categories/<id>/<file>`, `brands/<id>/<file>` | admins (5 MB, raster images)  |

¹ Files are served by URL (random paths), but object rows can be listed only by the author, admins, or once the
photo belongs to a published review (Phase 6A).

## Workflow functions (Phase 2)

Multi-step administrative changes are `security definer` functions. They are atomic, re-check `is_admin()`
themselves and write the audit log.

| Function                                               | Effect                                                                                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approve_vendor_application(id, slug, commission_bps)` | Creates the approved vendor, owner membership and draft store, sets the applicant role to `vendor`, marks the application approved. Audit `vendor.approved` |
| `reject_vendor_application(id, reason)`                | Marks the application rejected with a reason. Audit `vendor.application_rejected`                                                                           |
| `set_vendor_status(vendor_id, status, reason)`         | Suspend, reinstate or close. Audit `vendor.status_changed`                                                                                                  |
| `moderate_product(product_id, approve, reason)`        | `pending_review` to `active` (requires an active variant) or `rejected`. Audit `product.approved` / `product.rejected`                                      |
| `unpublish_product(product_id)`                        | Vendor member or admin moves `active` back to `draft`                                                                                                       |

## Public catalog views

`product_listings` and `product_variant_availability` are owner views that bypass RLS, so their definitions
restrict rows to active products of approved vendors. `product_listings` adds the price range, primary image,
store, brand and category names, an `in_stock` flag, the `search_vector` used for prefix full-text search and
approved-review totals (`review_count`, `rating_sum`; Phase 6A).
`product_variant_availability` exposes variants with `in_stock` and `is_low_stock` flags only, never quantities.

## Cart, checkout and payment functions (Phase 3)

| Function                                                                                                   | Caller                              | Effect                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cart_lines()`                                                                                             | customer                            | The caller's active cart, priced from the catalog, with availability and a reason when a line cannot be bought                                                                |
| `add_to_cart(variant, qty)`, `set_cart_item_quantity(item, qty)`, `remove_cart_item(item)`, `clear_cart()` | customer                            | Only way to write cart rows. Validate product, vendor, variant, stock and single-currency bags; snapshot the current price                                                    |
| `place_order(shipping_id, billing_id, token, expected_total, note)`                                        | customer                            | Atomic checkout: re-price, lock inventory in variant order, reserve, create order + vendor orders + items with commission snapshots, convert cart. Idempotent per token       |
| `cancel_pending_order(order)`                                                                              | owner or admin                      | Releases reservations of an unpaid order and cancels it (admin cancellations audited)                                                                                         |
| `expire_stale_checkouts(variant_ids?)`                                                                     | service role, cron, `place_order()` | Cancels unpaid orders past `reservation_expires_at` and releases their stock exactly once (`for update skip locked`)                                                          |
| `confirm_order_payment(order, provider, ref, amount, currency, fee, payload)`                              | service role only                   | Verifies the amount, records the payment and transactions, commits reserved stock, allocates the provider fee across vendor orders (largest remainder) and confirms the order |

`reserve_inventory`, `release_inventory` and `commit_reserved_inventory` keep their Phase 1 privilege checks and now
delegate to internal helpers that checkout shares, so there is one implementation of each stock change.

### Phase 3 security changes

- `cart_items` and `carts` lost INSERT and UPDATE grants for `authenticated`; only the cart functions write them.
- `orders` lost UPDATE for `authenticated`. `vendor_orders` and `order_items` keep UPDATE only on fulfilment
  columns (status, carrier, tracking, timestamps, note; `fulfilled_quantity`).
- Triggers `*_lock_financials` make order prices, totals, commissions, fees and address snapshots immutable for
  `anon`, `authenticated` (admins included) and `service_role`. Only trusted functions running as their owner can
  change them (`in_trusted_context()`).
- The Phase 1 policy `orders_select_vendor` was dropped: a parent order holds other vendors' totals. Vendors read
  their `vendor_orders` row, which now carries a `shipping_address` snapshot for fulfilment.
- Vendor status changes must move forward from a paid order: `confirmed → processing → shipped → delivered`.
  Pending (unpaid) orders cannot be fulfilled.

## Taxonomy, shipping and consent (Release 4a)

**Categories and brands.** Categories nest at most three levels deep; `enforce_category_hierarchy` rejects
cycles and moves that would push a subtree past the limit. Categories with products or subcategories, and brands
with products, cannot be deleted (`prevent_delete_used_*`); they are deactivated instead.
`set_category_active(category, active)` (admin, security definer) deactivates a whole subtree and refuses to
activate a child of an inactive parent. `audit_catalog_taxonomy` logs `category.created|updated|deleted`,
`brand.created|updated|deleted` and `commission.changed` with the admin as actor.
`enforce_product_brand_usage` lets vendors use only their own brand or a brand with no owner.
`approve_vendor_application` now also creates a brand owned by the new vendor (slug clash → suffixed slug).

**Shipping.** `shipping_zones` and `shipping_zone_countries` (a country is in at most one zone) are admin-managed;
anyone can read active zones. `vendor_shipping_rates` (one per vendor and zone, USD minor units) are readable by
vendor members and writable by owners and managers. Production starts with no zones.

| Function                                                                               | Caller   | Effect                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin_save_shipping_zone(name, countries, is_active, position, description, zone_id)` | admin    | Creates or updates a zone and replaces its country list atomically; rejects duplicate names and countries already in another zone. Audit `shipping_zone.saved` |
| `checkout_shipping_quote(address)`                                                     | customer | Per-vendor shipping for the caller's bag to one of their own shipping addresses: amount, delivery estimate, or why it cannot ship                              |
| `cart_shipping_for_country(country)`                                                   | internal | The shared calculation: `0` if no line needs shipping or the vendor subtotal reaches the free threshold, else `first + additional × (units − 1)`               |
| `place_order(…)`                                                                       | customer | Now blocks unserved countries and vendors without a rate, and charges shipping per vendor order. `expected_total` includes shipping                            |

Vendor orders store `shipping_minor`; `total = subtotal + shipping`; commission is calculated on merchandise
only; `vendor_earnings = subtotal + shipping − commission − fees`. `tax_minor` stays `0` until Release 4b.
`require_shipping_before_publish` stops a vendor publishing its store without an active rate in an active zone.

**Consent.** `vendor_applications.terms_version` and `terms_accepted_at` are filled on submission by
`record_vendor_terms_acceptance`: the version is required and the timestamp is always the database's `now()`,
so it cannot be backdated by the client.

## Payments, refunds and ledgers (Phase 4b, test mode)

See `docs/PAYMENTS.md` for the flow, the policy settings and the activation checklist. The key rules:

- **Who calls what.**
  - Platform-only functions refuse `anon` and `authenticated` callers. They are
    `record_checkout_session`, `confirm_order_payment`, `expire_payment_attempt`, `fail_payment_attempt`,
    `mark_payment_processing`, `record_payment_fee`, `record_late_payment_refund`, `begin_webhook_event`,
    `finish_webhook_event`, `mark_refund_submitted`, `apply_provider_refund`, `fail_refund` and `record_dispute`.
  - Customers call `begin_payment_attempt`, `cancel_pending_order` and `restore_cart_from_order`.
  - Admins call `request_refund`, `record_vendor_payout`, `reverse_vendor_payout` and `adjust_vendor_balance`.
- **Live mode is refused in the database.** Provider-facing functions reject live-mode data unless
  `payments.live_mode_enabled` is true.
- **Idempotency.**
  - Payments are unique on (provider, provider_payment_id).
  - Sessions are unique on provider_session_id.
  - Webhook events are unique on their event id.
  - Refunds are unique on provider_refund_id, and Stripe calls use the Luxora refund id as the idempotency key.
- **Ledgers are append-only.**
  - `order_earning` is posted once per vendor order.
  - Availability is computed in `vendor_ledger_view`: delivery plus `payouts.hold_days_after_delivery`.
  - `vendor_balances` gives pending, available, paid-out and lifetime totals per vendor.
- **Finance tables are function-only.** `refunds`, `payouts`, `payout_items` and `commissions` are read-only for
  API roles, including admins.

## Returns (Phase 5)

`return_requests` (one per vendor-order parcel) and `return_request_items` are read-only for API roles. Every
transition is an audited security-definer function:

| Function                                           | Caller                      | Effect                                                                                    |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `return_eligibility(order)`                        | customer                    | Returnable quantity, window end and eligibility per item of their order                   |
| `create_return_request(vendor_order, items, note)` | customer                    | Paid, delivered, inside `returns.window_days`; quantities ≤ returnable; reason per item   |
| `cancel_return_request(id)`                        | customer                    | `requested`/`approved` → `cancelled`                                                      |
| `mark_return_shipped(id, carrier, tracking, url)`  | customer                    | `approved` → `in_transit`                                                                 |
| `approve_return_request(id, instructions)`         | vendor owner/manager, admin | `requested` → `approved` with the return address                                          |
| `reject_return_request(id, reason)`                | vendor owner/manager, admin | `requested` → `rejected`; after receipt admins only (close without refund)                |
| `mark_return_received(id, restock, notes)`         | vendor owner/manager, admin | `approved`/`in_transit` → `received`; optional restock via `adjust_inventory('return')`   |
| `request_return_refund(id, include_shipping)`      | admin                       | `received` → `completed`; calls `request_refund(..., 'return', ...)` and links the refund |

Returnable quantity = bought − units in active returns − units refunded outside returns. A provider refund
failure on a return's refund reopens the return (`received`) so it can be refunded again. The Phase 1 per-item
`returns` table, whose policies allowed direct customer inserts and unrestricted vendor updates, is now read-only.

## Reviews (Phase 6A)

`reviews` and `review_images` are read-only for API roles: anyone reads approved reviews, authors their own in
any state, admins all. `product_review_stats` holds approved-review totals per product (`review_count`,
`rating_sum`, `rating_1`…`rating_5`), recomputed by trigger whenever a review's status, rating or product changes.
Every write is an audited security-definer function:

| Function                                                       | Caller                      | Effect                                                                                                 |
| -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `review_eligibility(product?)`                                 | customer                    | Delivered, paid purchases inside `reviews.window_days` (30) not yet reviewed, one row per product      |
| `submit_review(order_item, rating, title, body)`               | customer                    | Verified purchase checks; one review per product; status `pending`; author name stored as "First L."   |
| `update_review(id, rating, title, body)`                       | author                      | Any change → `pending` (out of the totals until re-approved)                                           |
| `delete_review(id)`                                            | author                      | Deletes the review; returns photo paths for storage cleanup                                            |
| `attach_review_image(id, path)` / `remove_review_image(image)` | author                      | Uploaded object under `<profile>/<review>/`, at most `reviews.max_images` (4); a new photo → `pending` |
| `reply_to_review(id, reply)`                                   | vendor owner/manager        | One public reply on a published review (insert or edit)                                                |
| `remove_review_reply(id)`                                      | vendor owner/manager, admin | Removes the reply                                                                                      |
| `moderate_review(id, approve, reason)`                         | admin                       | `pending`/`rejected` → `approved`; `pending`/`approved` → `rejected` with a reason                     |

The Phase 1 policies that let customers and vendors write reviews directly (guarded only by a column trigger)
were dropped with that trigger.

## Coupons and flash sales (Phase 6B)

Money columns: `orders.discount_minor` (code discount on items), `orders.shipping_discount_minor`,
`orders.coupon_id`/`coupon_code`; `vendor_orders.discount_minor`, `shipping_discount_minor` and
`platform_funded_minor` (what Luxora pays); `order_items.discount_minor`, `platform_discount_minor`,
`list_price_minor` (regular price) and `flash_sale_item_id`. Constraints:
`total = subtotal − discount + shipping − shipping_discount + tax` (orders and vendor orders) and
`vendor_earnings = total + platform_funded − commission − fee`. Commission per line is on the line total minus any
vendor-funded discount.

| Function                                                                          | Caller                      | Effect                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cart_lines()`                                                                    | customer                    | Adds the regular price, the live flash-sale item, its end, and units left when the line does not fit   |
| `apply_cart_coupon(code)` / `remove_cart_coupon()`                                | customer                    | Puts a code on the bag (checked; failed attempts throttled)                                            |
| `cart_promotion_quote(address?)`                                                  | customer                    | The code's discount split per line and free shipping per vendor (the same function `place_order` uses) |
| `place_order(...)`                                                                | customer                    | Locks bag → stock → sale items → code; writes funded amounts; reserves the code use and sale units     |
| `save_coupon(...)` / `set_coupon_active(id, on)`                                  | vendor owner/manager, admin | Vendor codes (no free shipping) or Luxora codes; code and discount lock after first use                |
| `admin_set_coupon_disabled(id, disabled, reason)`                                 | admin                       | Disables any code; its owner cannot switch it back on                                                  |
| `save_flash_sale(...)` / `set_flash_sale_items(id, items)` / `end_flash_sale(id)` | vendor owner/manager        | Own variants only, price below regular, no overlapping sales; items lock once the sale starts          |
| `admin_disable_flash_sale(id, reason)`                                            | admin                       | Ends a sale at once                                                                                    |

Unpaid orders release their code use and sale units in `release_order_reservations_internal` (expiry,
cancellation, failed payment). Paid orders mark the use `redeemed` and post `promotion_cost`; refunds and returns
never restore uses or units. `request_refund` refunds what was paid for the units (cumulative split of the line's
paid total) and only the shipping the customer paid. All writes are audited (`coupon.*`, `flash_sale.*`).

## Audit log

`log_audit_event(action, entity_type, entity_id, metadata, ip, user_agent)` derives the actor from the
session and inserts into the append-only `audit_logs`. Action names are dotted lower-case
(`vendor.approved`, `commission.changed`, `refund.processed`, `settings.changed`).

## Testing the schema

`npm run test:db` recreates `TEST_DATABASE_URL`, applies the Supabase shim and every migration, then runs
assertions covering profile RLS, vendor lifecycle, catalog visibility, inventory safety, the multi-vendor
order model and its invariants, commission resolution, storage policies, and the Phase 2 workflow functions
and public catalog views.
