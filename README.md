# Luxora Commerce

Luxora is a premium multi-vendor marketplace for fashion and lifestyle brands. A customer buys from several
independent vendors in a single checkout; each vendor fulfils and is paid for its own part of the order; the
platform earns commissions, subscriptions and paid placements.

This repository has completed **Phase 1 — Foundation**, **Phase 2 — Vendor onboarding & catalog**,
**Phase 3 — Cart, checkout & orders**, **Release 4a — taxonomy, shipping and legal** and **Phase 4b — payments
(Stripe test mode)**. Customers can build a multi-vendor bag and pay for it on Stripe hosted Checkout; the order
is split into one vendor order per brand, and Luxora owes each vendor through an internal ledger. **Live payments
are blocked** until Stripe, business and legal approval are confirmed (see `docs/PAYMENTS.md`). **Online payment is not enabled yet:**
orders are created as _awaiting payment_, nothing is charged, and unpaid reservations expire automatically.
Payouts, refunds and promotions arrive in later phases; their routes exist and are protected, but deliberately
render a "scheduled" notice instead of mock data.

## Tech stack

| Layer      | Choice                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Framework  | Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`) |
| Language   | TypeScript 5 (strict)                                                  |
| Styling    | Tailwind CSS v4 with design tokens, Radix UI primitives (shadcn-style) |
| Backend    | Supabase — PostgreSQL 16+, Auth, Storage, Row Level Security           |
| Validation | Zod v4 (shared by client forms and server actions), React Hook Form    |
| Testing    | Vitest (unit) + Vitest against a real PostgreSQL (migrations & RLS)    |
| Tooling    | ESLint 9 (flat config), Prettier, GitHub Actions                       |

## Local setup

Prerequisites: Node 22, npm 10, and either Docker (for the Supabase CLI) or a local PostgreSQL 16.

```bash
npm install
cp .env.example .env.local        # fill in your Supabase project values
npm run dev                       # http://localhost:3000
```

### Environment variables

| Variable                               | Scope  | Purpose                                                                        |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | public | Supabase project URL                                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable (or legacy anon) key; RLS applies to every request                 |
| `NEXT_PUBLIC_SITE_URL`                 | public | Canonical site URL for auth redirects                                          |
| `SUPABASE_SECRET_KEY`                  | server | Secret / service-role key. Bypasses RLS. Only `lib/supabase/admin.ts` reads it |
| `DATABASE_URL`                         | local  | Plain-Postgres target for `db:reset:local` / `db:seed:dev`                     |
| `TEST_DATABASE_URL`                    | local  | Database recreated by `test:db` on every run                                   |

`src/lib/env.ts` validates variables lazily and fails with a precise message listing what is missing.
Server-only secrets are never imported into client code (`server-only` guard).

### Supabase setup

1. Create a Supabase project (or run `supabase start` locally with Docker).
2. Apply migrations (next section).
3. In **Authentication → URL Configuration** set the Site URL to your `NEXT_PUBLIC_SITE_URL` and add
   `<site>/auth/confirm` and `<site>/auth/callback` as redirect URLs.
4. Update the **email templates** to use the token-hash flow, e.g. for _Confirm signup_:
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
   and for _Reset password_: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`.
5. Enable **Email confirmations** (recommended) and a minimum password length of 10.

### Database migrations

Migrations live in `supabase/migrations/` and are plain SQL, applied in filename order. They are the only
way the schema changes — never edit a hosted database by hand.

```bash
# Hosted / local Supabase (recommended)
supabase link --project-ref <ref>
supabase db push                  # applies pending migrations
supabase db reset                 # local only: recreate + migrations + dev seed

# Plain PostgreSQL without the Supabase CLI (uses tests/db/supabase-shim.sql)
npm run db:reset:local            # DATABASE_URL, default postgres://postgres:postgres@localhost:5432/luxora_dev
npm run db:seed:dev               # same, plus development reference data
```

The development seed (`supabase/seeds/dev/`) contains categories and subscription plans only, plus three
test accounts when running on a real Supabase stack. **Production works with an empty database**; nothing
seeds orders, revenue or analytics.

After schema changes, regenerate types with `npm run db:types`. It runs the Supabase CLI (installed as a dev
dependency) against `DATABASE_URL` (default: the local test database) and writes
`src/lib/supabase/database.generated.ts`. `database.types.ts` holds the application aliases on top of it.

## Development commands

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                        |
| `npm run build`     | Production build                                            |
| `npm run typecheck` | Generate route types and run `tsc --noEmit`                 |
| `npm run lint`      | ESLint                                                      |
| `npm run format`    | Prettier (write) / `format:check` in CI                     |
| `npm run test`      | Unit tests (no database needed)                             |
| `npm run test:db`   | Migration + RLS tests against `TEST_DATABASE_URL`           |
| `npm run db:types`  | Regenerate `database.generated.ts` from a migrated database |
| `npm run test:all`  | Both suites                                                 |
| `npm run check`     | typecheck + lint + all tests                                |

## Architecture overview

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture and
[`docs/DATABASE.md`](docs/DATABASE.md) for the data model, money conventions and commission rules.

In one paragraph: the browser talks to Next.js Server Components and Server Actions. Those use a
cookie-based Supabase client whose every query is filtered by **Row Level Security** for the signed-in user.
Trusted multi-tenant workflows (checkout orchestration, webhooks) will use the service-role client on the
server only. Business invariants that must never be bypassed — money arithmetic, stock never going negative,
who may change a vendor's status — are enforced **in the database** with constraints, triggers and
`security definer` functions, so the UI is never the last line of defence.

## Folder structure

```
supabase/
  migrations/           SQL migrations (schema, RLS, functions, storage, grants)
  seeds/dev/            development-only seed data
  config.toml           Supabase CLI configuration
src/
  app/                  App Router routes
    (storefront)/       customer-facing pages + /account
    (auth)/             login, signup, password reset, email confirm handlers
    vendor/             public vendor landing, onboarding, (portal)/ protected portal
    admin/              Admin Command Center (role-protected)
  components/ui/        design-system primitives (button, input, card, sheet, …)
  components/layout/    header, footer, portal shell, navigation
  components/shared/    page header, empty state, phase placeholder
  config/routes.ts      route constants, protected-path rules
  features/<domain>/    actions, queries and components (auth, vendors, account, catalog, inventory, admin)
  lib/supabase/         server / browser / admin clients, proxy session refresh, DB types
  lib/auth/dal.ts       getCurrentUser / requireUser / requireRole / requireVendorContext
  lib/errors/           AppError, Supabase error mapping, ActionResult
  lib/validation/       Zod schemas shared by client and server
  lib/money/            integer minor-unit arithmetic, allocation, formatting
  proxy.ts              session refresh + protected-route redirects
tests/
  unit/                 Vitest unit tests
  db/                   real-PostgreSQL migration & RLS tests (+ Supabase shim)
scripts/db/             migration runner for plain PostgreSQL
docs/                   architecture & database documentation
```

## Role model

| Role          | Stored in                        | Can                                                                |
| ------------- | -------------------------------- | ------------------------------------------------------------------ |
| `customer`    | `profiles.role`                  | Manage own profile, addresses, cart, wishlist, orders, reviews     |
| `vendor`      | `profiles.role` + `vendor_users` | Operate the vendors they are a member of (owner / manager / staff) |
| `admin`       | `profiles.role`                  | Platform-wide read, moderate vendors/products, manage finance      |
| `super_admin` | `profiles.role`                  | Everything admins can, plus promote admins and change settings     |

Roles are enforced in three places: the proxy (signed-in check), server layouts/actions (`requireRole`),
and the database (RLS policies + triggers). Only the database layer is authoritative.

## Security model

- All tables have RLS enabled; `anon` and `authenticated` start with **zero** privileges and receive explicit
  table/column grants (`20261005000011_grants.sql`).
- Inventory quantities can only change through `adjust_inventory`, `reserve_inventory`,
  `release_inventory` and `commit_reserved_inventory`, which lock rows, prevent negative stock and write an
  immutable movement.
- Protected columns (vendor status, commission, product approval, order financials) are locked by triggers
  unless the session is privileged (service role or an active admin).
- Audit logs, inventory movements, payment transactions and analytics events are append-only.
- Storage buckets are path-scoped: vendors write under `<vendor_id>/…`, users under `<profile_id>/…`,
  vendor documents are private.
- Auth: Supabase Auth owns credentials. Sessions are validated server-side with `getUser()`; redirects are
  checked against open-redirect attacks; service-role credentials never reach the client.

## Implementation phases

| Phase | Scope                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 ✅  | Foundation: schema, RLS, auth, roles, design system, routes, tests, docs                                                                                                                          |
| 2 ✅  | Vendor application review and approval, store setup with logo/cover uploads, product/variant/image management, inventory UI on the safe stock functions, product moderation, public catalog pages |
| 3 ✅  | Cart (database-priced), addresses, multi-vendor checkout with stock reservation and expiry, customer/vendor/admin order views, payment-provider boundary (no provider enabled yet)                |
| 4a ✅ | Admin category and brand management, shipping zones and vendor shipping rates in checkout, tax disclosure (tax = 0), legal pages and consent recording                                            |
| 4b    | Stripe payments (Luxora as merchant of record), Stripe Tax, vendor payouts                                                                                                                        |
| 5 ✅  | Customer returns (RMA): request within 14 days of delivery, vendor approval with return instructions, return tracking, receipt with restock, admin refund through Stripe (test mode)              |
| 6     | Reviews, coupons, flash sales, subscriptions                                                                                                                                                      |
| 5     | Analytics, content management, loyalty, notifications, featured placements                                                                                                                        |

## Status

Phases 1–3, Release 4a and Phase 4b are complete and verified (`npm run check`). The application is **not
production-ready**: payments run in Stripe **test mode only** (live keys and live events are refused); tax is not
collected (checkout states "Duties and taxes may apply on delivery."); and the company details on the legal pages
are placeholders (see below).

### Phase 2 workflows

- **Vendor approval.** `/admin/vendors` lists open applications. Approving calls `approve_vendor_application()`,
  which atomically creates the vendor, the owner membership and a draft store, upgrades the applicant's role
  and writes an audit entry. Rejection stores a reason the applicant sees at `/vendor/onboarding`.
- **Storefront.** `/vendor/storefront` edits store details, uploads logo and cover straight to Supabase Storage
  and publishes or unpublishes the store. Uploaded paths are re-validated server-side against the vendor folder.
- **Catalog.** `/vendor/products` creates products, then variants (SKU, price, options), images and inventory,
  then submits for review. `/admin/products` approves or rejects through `moderate_product()`.
- **Inventory.** `/vendor/inventory` changes stock only through `adjust_inventory()` and shows the immutable
  movement history.
- **Public catalog.** `/shop`, `/search`, `/category/[slug]`, `/brand/[slug]`, `/store/[slug]`,
  `/collection/[slug]` and `/product/[slug]` read the `product_listings` and `product_variant_availability`
  views. They only expose active products of approved vendors and never expose stock quantities.

### Phase 3 workflows

- **Cart.** `/cart` groups the bag by brand. Every write goes through `add_to_cart()`, `set_cart_item_quantity()`,
  `remove_cart_item()` and `clear_cart()`, which read prices and availability from the catalog. Customers cannot
  write cart rows directly, so a price can never come from the browser.
- **Addresses.** `/account/addresses` manages shipping and billing addresses (owner-only by RLS). Orders store a
  copy of the address, so editing or deleting one never changes a past order.
- **Checkout.** `/checkout` calls `place_order()`, which in one transaction re-prices the bag, locks inventory rows
  in a fixed order, reserves stock, creates the parent order plus one vendor order per brand with per-line
  commission snapshots, and converts the cart. The checkout token makes double submits idempotent, and the total
  the customer saw is re-checked so a price change cannot be charged silently.
- **Reservations.** Unpaid checkouts hold stock for `checkout.reservation_minutes` (30). `expire_stale_checkouts()`
  releases them; it runs every five minutes when `pg_cron` is enabled, and `place_order()` also expires stale
  reservations for the items it touches. Customers can cancel an unpaid order themselves.
- **Payment boundary.** `confirm_order_payment()` is the only path that records a payment and turns reserved stock
  into sold stock. It is callable only with the service role, from a provider webhook that does not exist yet.
  `src/lib/payments/provider.ts` defines the adapter interface; with `PAYMENT_PROVIDER` unset, payments are off.
- **Orders.** Customers see `/account/orders`; vendors see only their own vendor orders at `/vendor/orders` and can
  fulfil them only after payment; admins see everything at `/admin/orders`. Order prices, totals and commissions
  are immutable for every API role, admins and the service role included.

### Release 4a workflows

- **Categories.** `/admin/categories` manages the category tree (at most three levels, enforced by
  `enforce_category_hierarchy`), category images (`catalog-assets` bucket) and per-category commission rates.
  Deactivating a category cascades to its subcategories (`set_category_active()`); categories that have products
  or subcategories cannot be deleted, only deactivated. Every change is audited (`category.*`, `commission.changed`).
- **Brands.** `/admin/brands` manages brands, owners, logos and verification. Approving a vendor creates a brand in
  the vendor's name owned by that vendor. Vendors can only use their own brand or brands with no owner
  (`enforce_product_brand_usage`); brands in use cannot be deleted. `/brands` lists active brands publicly.
- **Shipping zones.** `/admin/shipping` creates zones and assigns countries (each country belongs to one zone,
  saved atomically by `admin_save_shipping_zone()`). Nothing is seeded for production: until an admin creates a
  zone, Luxora ships nowhere. Zones that vendors have rates for cannot be deleted, only deactivated.
- **Vendor shipping rates.** `/vendor/shipping` sets, per zone, a first-item price, an additional-item price, an
  optional free-shipping threshold and a delivery estimate (USD). A store cannot be published until the vendor
  ships to at least one active zone (`require_shipping_before_publish`).
- **Shipping at checkout.** Shipping is computed only in the database: `checkout_shipping_quote(address)` for
  display and `place_order()` for the charge, using the same `cart_shipping_for_country()` rules
  (`0` when nothing needs shipping or the vendor subtotal reaches the free threshold, otherwise
  `first + additional × (units − 1)`). Checkout is blocked for a country outside every active zone and for a
  vendor without a rate there. Commission applies to merchandise only; shipping is part of vendor earnings.
  Tax stays zero until Release 4b.
- **Legal.** `/legal/terms`, `/legal/privacy`, `/legal/shipping`, `/legal/returns` and `/legal/vendor-terms`.
  Return window: 14 days; the customer pays return shipping. Sign-up links the Terms and Privacy Policy; vendor
  applications require accepting the Vendor Terms, and the database records the version with a server-side
  timestamp.

### Before launch: legal placeholders

`src/config/legal.ts` holds `LEGAL_COMPANY_NAME`, `REGISTERED_BUSINESS_ADDRESS`, `CONTACT_EMAIL` and
`GOVERNING_LAW` as clearly marked `[PLACEHOLDER: …]` values. While any of them is a placeholder, every legal page
shows a "Draft — pending legal review" notice and highlights the missing values. Replace them with the real
details (and have the documents reviewed) before launch; `tests/unit/legal-config.test.ts` must be updated in the
same change. Bump `VENDOR_TERMS_VERSION` whenever the Vendor Terms change materially.

### Phase 4b workflows (Stripe test mode)

Full runbook: [`docs/PAYMENTS.md`](docs/PAYMENTS.md).

- **Pay.** Placing an order redirects to Stripe hosted Checkout (card, Link, Apple Pay and Google Pay; no delayed
  methods). The session is built from the order rows and must equal the order total. The stock hold extends to the
  session expiry.
- **Confirm.** `POST /api/webhooks/stripe` verifies the signature and de-duplicates the event, then calls
  `confirm_order_payment()`, which is idempotent per PaymentIntent and the only path that commits stock. The success
  page applies the same session server-side if the webhook is slow.
- **Recover.** Pay now / Resume payment, payment-aware cancellation (open sessions are expired first), automatic
  expiry and "Restore these items to my bag". Late payments are refunded automatically.
- **Refund.** From the admin order page, per vendor order and quantity. Shipping follows a configurable policy.
  Refunds, chargebacks and processing fees are currently borne by Luxora and recorded in `platform_ledger_entries`.
- **Pay vendors.** `vendor_ledger_entries` holds what Luxora owes each vendor. Earnings become available 14 days
  after delivery, and admins record payouts made outside Stripe (`/admin/payouts`). Vendors see their balance and
  statement at `/vendor/payouts`. No vendor needs a Stripe account, and no bank details are stored.

### Phase 5 workflows (returns)

- **Request.** On a delivered shipment, the customer picks items, quantities and a reason for each, inside the
  return window (`returns.window_days`, 14 days from delivery). Returnable quantities exclude units in other open
  returns and units refunded outside a return. Requests get an RMA number (`<vendor order>-R<n>`).
- **Decide.** Vendor owners/managers (or admins) approve a request with the return address and instructions, or
  decline it with a reason. The customer can cancel until the items are sent, then adds carrier and tracking.
- **Receive.** The vendor marks the parcel received, optionally restocking the units (an inventory `return`
  movement).
- **Refund.** Admins refund received returns from `/admin/returns`. `request_return_refund()` goes through
  `request_refund()`, so the Phase 4b shipping and liability policies, ledgers and Stripe idempotency all apply,
  and the refund is linked to the return. If the provider refund fails, the return reopens so it can be retried.
  Admins can also close a received return without a refund.
- Pages: `/account/returns`, the order page ("Request a return"), `/vendor/returns`, `/admin/returns`.
