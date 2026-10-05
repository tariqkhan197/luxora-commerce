# Luxora — Database

PostgreSQL (Supabase). Migrations in `supabase/migrations/`, applied in filename order. All tables are in
`public`, all have RLS enabled, and the API roles have explicit, minimal grants.

## Conventions

| Concern      | Convention                                                                          |
| ------------ | ----------------------------------------------------------------------------------- |
| Primary keys | `uuid` (`gen_random_uuid()`); append-only logs use `bigint identity`                |
| Money        | `bigint` **minor units** (`*_minor`) + `currency char(3)`; domain `money_minor` ≥ 0 |
| Rates        | `integer` **basis points** (`*_bps`, 10000 = 100 %); domain `basis_points`          |
| Slugs        | domain `slug_text`: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–120 chars                       |
| Timestamps   | `timestamptz`; `updated_at` maintained by `set_updated_at()` trigger                |
| Statuses     | PostgreSQL enums (extend with `alter type … add value` in a migration)              |
| Snapshots    | Orders copy product names, SKUs, prices and addresses at purchase time              |
| Extensions   | `pgcrypto`, `citext`, `pg_trgm` in schema `extensions`                              |

## Migrations

| File                                   | Contents                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_foundation_extensions_enums`     | Extensions, all enums, domains, `set_updated_at()`                                                                                                                                                                  |
| `0002_identity_security`               | `roles`, `profiles`, auth trigger, RLS helpers, `platform_settings`, `audit_logs` + `log_audit_event()`                                                                                                             |
| `0003_vendors`                         | `vendors`, `vendor_users`, `vendor_applications`, `stores`, membership helpers, locked-column trigger                                                                                                               |
| `0004_catalog_inventory`               | `categories`, `brands`, `products`, `product_variants`, `product_images`, `collections`, `collection_products`, `inventory`, `inventory_movements`, safe inventory functions                                        |
| `0005_customer_data`                   | `addresses`, `carts`, `cart_items`, `wishlists`, `wishlist_items`                                                                                                                                                   |
| `0006_orders_payments`                 | `orders`, `vendor_orders`, `order_items`, `payments`, `payment_transactions`, `returns`, `refunds`, order number generator                                                                                          |
| `0007_reviews_promotions`              | `reviews`, `review_images`, `coupons`, `coupon_usages`, `flash_sales`, `flash_sale_items`                                                                                                                           |
| `0008_finance_monetization`            | `commission_rules`, `commissions`, `payouts`, `payout_items`, `subscription_plans`, `vendor_subscriptions`, `featured_products`, `featured_brands`, `resolve_commission_rate_bps()`, `calculate_commission_minor()` |
| `0009_engagement_content_analytics`    | `loyalty_accounts`, `loyalty_transactions`, `notifications`, `content_sections`, `banners`, `analytics_events`                                                                                                      |
| `0010_storage`                         | Buckets and `storage.objects` policies                                                                                                                                                                              |
| `0011_grants`                          | Explicit privileges for `anon`, `authenticated`, `service_role`                                                                                                                                                     |
| `0012_phase2_vendor_catalog_workflows` | `products.search_vector`, vendor review and product moderation functions, `product_listings` and `product_variant_availability` views                                                                               |

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

| Table group                            | anon                       | customer (authenticated)        | vendor member                            | admin                           |
| -------------------------------------- | -------------------------- | ------------------------------- | ---------------------------------------- | ------------------------------- |
| `profiles`                             | —                          | own row (not role/status)       | own row                                  | all; promote → super_admin only |
| `vendors`, `stores`                    | approved/published         | approved/published              | own (any status); edit presentation only | all                             |
| `vendor_applications`                  | —                          | own; insert as `submitted`      | —                                        | all                             |
| catalog (`products`, variants, images) | active of approved vendors | same                            | own in any status; cannot publish        | all                             |
| `inventory`, movements                 | —                          | —                               | own; quantities via functions only       | read; functions                 |
| `addresses`, carts, wishlists          | public wishlists           | own                             | own                                      | read                            |
| `orders`                               | —                          | own                             | orders containing their vendor orders    | read/update                     |
| `vendor_orders`, `order_items`         | —                          | own                             | own; fulfilment fields only              | read/update                     |
| `payments`, `payment_transactions`     | —                          | own payments                    | **none**                                 | read                            |
| `returns`                              | —                          | own; request                    | own vendor; review                       | all                             |
| `refunds`, `commissions`, `payouts`    | —                          | own refunds                     | own (read)                               | all                             |
| `coupons`                              | —                          | — (validated server-side)       | own vendor coupons                       | all                             |
| `reviews`                              | approved                   | own; create/edit → re-moderated | on own products; reply only              | all                             |
| content, banners, plans, placements    | active                     | active                          | active (+ own placements)                | all                             |
| `audit_logs`, `analytics_events`       | —                          | —                               | own vendor events                        | read                            |
| `platform_settings`                    | public keys                | public keys                     | public keys                              | read; super_admin writes        |

## Storage buckets

| Bucket             | Public | Path convention                   | Writers                |
| ------------------ | ------ | --------------------------------- | ---------------------- |
| `product-images`   | yes    | `<vendor_id>/<product_id>/<file>` | vendor members, admins |
| `vendor-logos`     | yes    | `<vendor_id>/<file>`              | vendor members, admins |
| `vendor-covers`    | yes    | `<vendor_id>/<file>`              | vendor members, admins |
| `vendor-documents` | **no** | `<profile_id>/<file>`             | applicant; admins read |
| `avatars`          | yes    | `<profile_id>/<file>`             | owner, admins          |
| `review-images`    | yes    | `<profile_id>/<review_id>/<file>` | owner, admins          |
| `banners`          | yes    | `<file>`                          | admins                 |

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
store, brand and category names, an `in_stock` flag and the `search_vector` used for prefix full-text search.
`product_variant_availability` exposes variants with `in_stock` and `is_low_stock` flags only, never quantities.

## Audit log

`log_audit_event(action, entity_type, entity_id, metadata, ip, user_agent)` derives the actor from the
session and inserts into the append-only `audit_logs`. Action names are dotted lower-case
(`vendor.approved`, `commission.changed`, `refund.processed`, `settings.changed`).

## Testing the schema

`npm run test:db` recreates `TEST_DATABASE_URL`, applies the Supabase shim and every migration, then runs
assertions covering profile RLS, vendor lifecycle, catalog visibility, inventory safety, the multi-vendor
order model and its invariants, commission resolution, storage policies, and the Phase 2 workflow functions
and public catalog views.
