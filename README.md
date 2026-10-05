# Luxora Commerce

Luxora is a premium multi-vendor marketplace for fashion and lifestyle brands. A customer buys from several
independent vendors in a single checkout; each vendor fulfils and is paid for its own part of the order; the
platform earns commissions, subscriptions and paid placements.

This repository has completed **Phase 1 — Foundation** and **Phase 2 — Vendor onboarding & catalog**.
Vendors apply, administrators approve them, vendors build a storefront and catalog (products, variants,
images, inventory), administrators moderate products, and customers browse the shop, search, categories,
brands, stores and collections. Cart, checkout, orders, payouts and promotions arrive in later phases; their
routes exist and are protected, but deliberately render a "scheduled" notice instead of mock data.

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
| 3     | Cart, checkout orchestration (multi-vendor order split, reservations), payments provider, orders, addresses, reviews                                                                              |
| 4     | Commissions ledger, payouts, refunds & returns workflows, coupons, flash sales, subscriptions                                                                                                     |
| 5     | Analytics, content management, loyalty, notifications, featured placements                                                                                                                        |

## Status

Phases 1 and 2 are complete and verified (`npm run check`). The application is **not production-ready** yet:
customers can browse but not buy. Cart, checkout and payments are Phase 3.

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
