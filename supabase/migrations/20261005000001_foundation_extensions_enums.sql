-- =============================================================================
-- Luxora Commerce — Migration 0001: extensions, enums, shared helpers
-- -----------------------------------------------------------------------------
-- Conventions used across all migrations:
--   * Money is stored as BIGINT in the currency's minor unit (e.g. cents).
--     Columns are suffixed `_minor` and always paired with a `currency` code.
--   * Rates (commissions, discounts, fees) are stored as INTEGER basis points
--     (`_bps`): 1 bp = 0.01 %, so 10000 bps = 100 %.
--   * Every mutable table has `created_at` / `updated_at` maintained by the
--     `public.set_updated_at()` trigger.
--   * All tables live in `public` and have Row Level Security enabled.
-- =============================================================================

-- Extensions live in the `extensions` schema (Supabase convention) so that the
-- privilege model in migration 0011 — which revokes default EXECUTE on functions
-- in `public` — never touches extension functions.
create schema if not exists extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext"   with schema extensions;
create extension if not exists "pg_trgm"  with schema extensions;

-- -----------------------------------------------------------------------------
-- Enumerated types
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'vendor', 'admin', 'super_admin');
create type public.account_status as enum ('active', 'suspended', 'deactivated');

create type public.vendor_status as enum ('pending', 'approved', 'suspended', 'rejected', 'closed');
create type public.vendor_member_role as enum ('owner', 'manager', 'staff');
create type public.vendor_application_status as enum ('submitted', 'under_review', 'approved', 'rejected');
create type public.store_status as enum ('draft', 'published', 'unpublished');

create type public.product_status as enum ('draft', 'pending_review', 'active', 'rejected', 'archived');
create type public.inventory_movement_type as enum (
  'purchase', 'sale', 'return', 'cancellation', 'manual_adjustment', 'damaged', 'restock'
);

create type public.cart_status as enum ('active', 'converted', 'abandoned');
create type public.address_type as enum ('shipping', 'billing', 'both');

create type public.order_status as enum (
  'pending', 'confirmed', 'processing', 'partially_fulfilled', 'fulfilled',
  'completed', 'cancelled', 'refunded'
);
create type public.vendor_order_status as enum (
  'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'refunded'
);
create type public.payment_status as enum (
  'pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'cancelled'
);
create type public.payment_provider as enum ('stripe', 'paypal', 'cash_on_delivery', 'manual');
create type public.payment_transaction_type as enum ('authorization', 'capture', 'refund', 'fee', 'adjustment');
create type public.payment_transaction_status as enum ('pending', 'succeeded', 'failed');

create type public.refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');
create type public.return_status as enum (
  'requested', 'approved', 'rejected', 'in_transit', 'received', 'inspected', 'completed', 'cancelled'
);

create type public.review_status as enum ('pending', 'approved', 'rejected');

create type public.coupon_scope as enum ('platform', 'vendor');
create type public.discount_type as enum ('percentage', 'fixed_amount', 'free_shipping');
create type public.flash_sale_status as enum ('scheduled', 'active', 'ended', 'cancelled');

create type public.commission_rule_scope as enum ('global', 'vendor', 'category');
create type public.commission_status as enum ('pending', 'settled', 'reversed');
create type public.payout_status as enum ('pending', 'scheduled', 'processing', 'paid', 'failed', 'cancelled');
create type public.payout_item_type as enum ('vendor_order_earnings', 'refund_debit', 'adjustment');

create type public.billing_interval as enum ('monthly', 'yearly');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'cancelled', 'expired');
create type public.placement_status as enum ('scheduled', 'active', 'ended', 'cancelled');

create type public.loyalty_transaction_type as enum ('earn', 'redeem', 'expire', 'adjust');
create type public.collection_type as enum ('manual', 'automatic');

-- -----------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Shared domain checks
-- -----------------------------------------------------------------------------
-- Slugs: lowercase, digits, single hyphens, 2–120 chars.
create domain public.slug_text as text
  check (value ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(value) between 2 and 120);

-- ISO-4217 alpha-3 currency code, upper case.
create domain public.currency_code as char(3)
  check (value ~ '^[A-Z]{3}$');

-- Basis points 0..10000 inclusive.
create domain public.basis_points as integer
  check (value between 0 and 10000);

-- Non-negative money in minor units.
create domain public.money_minor as bigint
  check (value >= 0);
