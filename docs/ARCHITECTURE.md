# Luxora — Architecture

## Goals

- A real, multi-tenant marketplace: many vendors, one storefront, one checkout.
- Security enforced where it cannot be bypassed: the database.
- Deterministic money.
- A codebase a senior team can extend phase by phase without rewrites.

## System shape

```
Browser ──► Next.js 16 (App Router)
             ├─ proxy.ts            refresh Supabase session, redirect anonymous users off protected paths
             ├─ Server Components   read via cookie-based Supabase client (RLS applies)
             ├─ Server Actions      validate (Zod) → write via Supabase client (RLS applies)
             └─ Admin client        service role, server-only, for cross-tenant orchestration (checkout, webhooks)
                        │
                        ▼
             Supabase ── Auth (credentials, sessions, email flows)
                      ── PostgreSQL (schema, RLS, triggers, security-definer functions)
                      ── Storage (path-scoped buckets)
```

### Request lifecycle

1. `src/proxy.ts` runs on every non-asset request. It refreshes the auth cookie via `updateSession()` and
   redirects signed-out users from `/account`, `/vendor/*`, `/admin`, `/checkout` to `/login?next=…`.
   It does **not** decide roles.
2. Layouts call the Data Access Layer (`src/lib/auth/dal.ts`):
   - `requireUser()` — validated session + active profile, or redirect to login.
   - `requireRole([...])` — redirect to `/forbidden` when the profile role does not match.
   - `requireVendorContext()` — the vendor the user is a member of, or redirect to onboarding.
3. Pages query through `createClient()` (cookie-based). Everything is filtered by RLS, so a bug in a
   page cannot leak another tenant's data.
4. Server Actions re-validate input with the same Zod schema the form used, call the database, and return
   an `ActionResult` (`{ ok, data } | { ok, error }`) — never a thrown error across the network boundary.

### Error handling

`src/lib/errors` defines `AppError` with a stable code (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION`, `CONFLICT`, `RATE_LIMITED`, `DATABASE`, `NETWORK`, `CONFIGURATION`, `INTERNAL`), an HTTP
status and a user-safe message. `fromPostgrestError` / `fromAuthError` translate Supabase errors by code,
so raw database messages never reach a customer; messages raised deliberately by our own SQL functions
(SQLSTATE `P0001`) are passed through because they are written for users. `error.tsx`, `global-error.tsx`,
`not-found.tsx` and `/forbidden` render the corresponding states.

## Authorization: three layers

| Layer    | Mechanism                                                           | Purpose                             |
| -------- | ------------------------------------------------------------------- | ----------------------------------- |
| Edge     | `proxy.ts`                                                          | Cheap redirect for signed-out users |
| Server   | `requireUser` / `requireRole` / `assertRole` in layouts & actions   | UX and defence in depth             |
| Database | RLS policies, explicit grants, triggers, security-definer functions | **Authoritative**                   |

RLS helper functions (`current_profile_id()`, `is_admin()`, `is_vendor_member(vendor_id)`,
`has_vendor_role(vendor_id, roles[])`, …) are `security definer` so policies never recurse into the table
they protect, and are wrapped in `(select …)` so the planner evaluates them once per statement.

Column-level protection (e.g. a vendor editing its display name but not its `status`) is implemented with
`BEFORE UPDATE` triggers that check `is_privileged_session()` — true for the service role, migrations and
active admins. Policies cannot query their own table, so triggers are the right tool for "which columns".

## Multi-vendor order model

```
orders (what the customer paid)
  └── vendor_orders (one per vendor; fulfilment + earnings)
        └── order_items (reference BOTH order_id and vendor_order_id)
payments / payment_transactions (per parent order)
refunds (per order, optionally per vendor order; splits commission vs vendor debit)
returns (per order item)
commissions (ledger per vendor order; reversals linked)
payouts / payout_items (settle vendor orders and refund debits)
```

Checkout (Phase 3) runs server-side with the admin client inside one transaction: reserve stock, create the
parent order, split items by vendor into vendor orders with resolved commission rates, record the payment,
then `commit_reserved_inventory` on capture. Invariants (`total = subtotal − discount + shipping + tax`,
`vendor_earnings = total − commission − payment_fee`) are CHECK constraints, so an incorrect split cannot be
written.

## Money

Integer minor units (`bigint`/`number`), ISO currency codes, rates in basis points. `src/lib/money` mirrors
the SQL function `calculate_commission_minor` (round half up) and provides largest-remainder allocation for
splitting shared costs across vendor orders so parts always sum to the total. No floating point anywhere
in calculations; formatting converts integers to decimals only at render time.

## Design system

Tailwind v4 with tokens declared on `:root` (ivory canvas, ink text, brass accent) and mapped via
`@theme inline` so `bg-surface`, `text-ink-soft`, `shadow-soft`, `font-display` resolve to one source.
Typography: Fraunces (display) + Inter (body) via `next/font`. Utilities `display-1/2/3`, `eyebrow`,
`container-editorial` encode the editorial rhythm. Components in `src/components/ui` follow the shadcn
pattern (Radix primitives + `cva` variants) and are hand-written so the registry is not a build dependency.
Layouts are mobile-first: the portal shell collapses to a top bar with horizontal navigation; the header
uses a sheet for navigation on small screens.

## Testing strategy

| Suite       | Runner                              | What it proves                                                                                                                        |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `typecheck` | `next typegen && tsc`               | Strict types incl. generated route props                                                                                              |
| `lint`      | ESLint (next/core-web-vitals + TS)  | Code quality                                                                                                                          |
| `test:unit` | Vitest                              | Money, validation, error mapping, route guards (every static route has a page), env validation, checkout/shipping quote, legal config |
| `test:db`   | Vitest + `pg` against PostgreSQL 16 | Every migration applies from scratch; RLS per role; inventory safety; order invariants; commission resolution; storage policies       |

The DB suite applies `tests/db/supabase-shim.sql` (roles, `auth.uid()`, `storage.foldername()`) then all
migrations, and impersonates API requests exactly like PostgREST: `SET LOCAL ROLE authenticated` +
`request.jwt.claims`. CI runs it on a `postgres:16` service container.

## Phase 2 flows

```
Customer  apply ──────────────► vendor_applications
Admin     approve_vendor_application ─► vendors + vendor_users (owner) + stores (draft)
Vendor    store settings, logo/cover upload (browser → Storage, RLS by folder) ─► stores
Vendor    product (draft) ─► variants (+ inventory row) ─► images ─► submit (pending_review)
Admin     moderate_product ─► active | rejected
Vendor    adjust_inventory ─► inventory + inventory_movements (append-only)
Public    product_listings / product_variant_availability views ─► /shop /search /category /brand /store /collection /product
```

Browser uploads go straight to Supabase Storage. The storage policies decide whether the user may write to
`<vendor_id>/…`, then the Server Action validates the returned path against the same owner folder before
persisting it. Public reads never touch `inventory` directly; the views expose boolean stock flags only.

## Phase 3: checkout and the payment boundary

```
Browser ── ids + quantities ──► cart functions ──► carts / cart_items (price snapshot from catalog)
Browser ── address ids, token, displayed total ──► place_order()
             ├─ re-price from catalog, reject if total drifted
             ├─ lock inventory rows (variant order) → reserve stock
             ├─ orders (pending, reservation_expires_at) → vendor_orders (one per vendor) → order_items (snapshots)
             └─ cart converted
Unpaid ──► expire_stale_checkouts() / cancel_pending_order() ──► release stock, cancel
Paid   ──► provider webhook (server, service role) ──► confirm_order_payment() ──► commit stock, record payment
```

The TypeScript quote (`src/features/checkout/quote.ts`) uses the integer money utilities to display the same
totals the database will compute from the same catalog rows. It is never trusted: its total is sent as
`expectedTotalMinor` and the database rejects a mismatch. Payment collection is behind the adapter interface in
`src/lib/payments/provider.ts`; no adapter ships yet, so orders remain unpaid and expire.

## Release 4a: taxonomy, shipping and legal

```
Admin   /admin/categories, /admin/brands ─► categories / brands (RLS: admins write; triggers: depth, delete guards, audit)
Admin   /admin/shipping ─► admin_save_shipping_zone() ─► shipping_zones + shipping_zone_countries
Vendor  /vendor/shipping ─► vendor_shipping_rates (owner/manager; one row per zone)
Checkout page ─► checkout_shipping_quote(address) per address ─► quote.ts adds it up for display
Browser ── address, token, total incl. shipping ──► place_order() ─► same cart_shipping_for_country() rules
```

Shipping follows the same rule as prices: **computed only in the database**. The checkout page asks
`checkout_shipping_quote()` for each of the customer's shipping addresses (at most 20), and the client form
switches the summary and the expected total with the selected address. `place_order()` recomputes shipping with
the shared `cart_shipping_for_country()` and rejects any drift, so a rate change between page load and
submission cannot be charged silently. Customers never read vendor rate rows, only the computed quote.

Admin-managed catalog images live in the public `catalog-assets` bucket (`categories/<id>/…`, `brands/<id>/…`);
the Server Action re-validates the path with `isCatalogAssetPath()` before saving it.

Legal copy lives in `src/app/(storefront)/legal/*` and reads its company details and policy values from
`src/config/legal.ts`. Company details are explicit placeholders until supplied; the pages show a draft notice
while any remain. Tax is zero in 4a and every total carries "Duties and taxes may apply on delivery."

## Phase 4b: payments (Stripe test mode)

```
place_order() ─► begin_payment_attempt() ─► Stripe Checkout Session (from order rows) ─► record_checkout_session()
Stripe ─ signed webhook ─► processStripeWebhook(): verify ─► refuse live mode ─► begin_webhook_event (dedupe)
                                     └► handleStripeEvent() ─► confirm / expire / fail / refund / dispute (SQL, idempotent)
/checkout/success ─► reconcileCheckoutSession(): re-read session server-side ─► same handler
Admin refund ─► request_refund() (policy) ─► Stripe refund (idempotency key = refund id) ─► mark_refund_submitted()
```

- `src/lib/payments/`: config validation (live keys blocked), the pure Checkout Session builder and the Stripe
  client, which is server-only and pinned to `STRIPE_API_VERSION`.
- `src/features/payments/`: event handling over injected ports (`PaymentStore` for the SQL functions,
  `PaymentGateway` for Stripe), so the logic is unit-tested without Stripe or a database. `server.ts` holds the real
  adapters, using the service role and the Stripe client.
- With `PAYMENT_PROVIDER` unset, every page falls back to the Phase 3 behaviour ("awaiting payment").

## Conventions

- Routes come from `src/config/routes.ts`; never hard-code paths.
- A feature lives in `src/features/<domain>/` with `actions.ts` (server) and `components/` (client).
- Validation schemas live in `src/lib/validation` and are imported by both forms and actions.
- Database writes that must be atomic or cross-tenant become SQL functions, not application code.
- No mock data in the UI. Empty states are explicit and honest.
