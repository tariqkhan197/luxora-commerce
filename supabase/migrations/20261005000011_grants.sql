-- =============================================================================
-- Migration 0011: explicit privilege model for the API roles
-- -----------------------------------------------------------------------------
-- Supabase's default privileges grant broad access to `anon` and
-- `authenticated` and rely entirely on RLS. Luxora layers an explicit grant
-- model on top (defence in depth): a role can only touch the tables, columns and
-- functions it legitimately needs, and RLS then narrows rows further.
-- Re-apply/extend this file whenever a migration adds tables or functions.
-- =============================================================================

-- Start from zero for the public API roles.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

grant usage on schema public to anon, authenticated, service_role;

-- The service role (server-only, never shipped to clients) keeps full access.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- -----------------------------------------------------------------------------
-- anon: read-only on public catalog & content
-- -----------------------------------------------------------------------------
grant select on
  public.platform_settings, public.vendors, public.stores,
  public.categories, public.brands, public.collections, public.collection_products,
  public.products, public.product_variants, public.product_images,
  public.wishlists, public.wishlist_items,
  public.reviews, public.review_images,
  public.flash_sales, public.flash_sale_items,
  public.featured_products, public.featured_brands,
  public.subscription_plans, public.content_sections, public.banners
to anon;

-- -----------------------------------------------------------------------------
-- authenticated: table privileges (RLS decides which rows)
-- -----------------------------------------------------------------------------
grant select on public.roles, public.audit_logs, public.inventory_movements,
  public.payments, public.payment_transactions, public.coupon_usages,
  public.loyalty_transactions, public.analytics_events
to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.platform_settings to authenticated;

grant select, insert, update, delete on
  public.vendors, public.vendor_users, public.vendor_applications, public.stores,
  public.categories, public.brands, public.collections, public.collection_products,
  public.products, public.product_variants, public.product_images,
  public.addresses, public.carts, public.cart_items, public.wishlists, public.wishlist_items,
  public.refunds, public.reviews, public.review_images, public.coupons,
  public.flash_sales, public.flash_sale_items,
  public.commission_rules, public.commissions, public.payouts, public.payout_items,
  public.subscription_plans, public.vendor_subscriptions,
  public.featured_products, public.featured_brands,
  public.loyalty_accounts, public.content_sections, public.banners
to authenticated;

grant select, update on public.orders, public.vendor_orders, public.order_items to authenticated;
grant select, insert, update on public.returns to authenticated;
grant select, update, delete on public.notifications to authenticated;

-- Inventory quantities only move through the safe functions: no direct UPDATE
-- on the quantity columns for API roles, even for administrators.
grant select, insert on public.inventory to authenticated;
grant update (low_stock_threshold, track_inventory, allow_backorder) on public.inventory to authenticated;

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
-- Helpers referenced by policies that also apply to anonymous visitors.
grant execute on function
  public.product_is_public(uuid), public.review_is_public(uuid), public.wishlist_is_public(uuid),
  public.flash_sale_is_live(uuid), public.storage_owner_segment(text),
  public.calculate_commission_minor(bigint, integer)
to anon, authenticated;

grant execute on function
  public.current_profile_id(), public.current_user_role(), public.current_account_status(),
  public.is_admin(), public.is_super_admin(), public.is_privileged_session(),
  public.is_vendor_member(uuid), public.has_vendor_role(uuid, public.vendor_member_role[]), public.current_vendor_ids(),
  public.product_vendor_id(uuid), public.cart_owner_profile_id(uuid), public.wishlist_owner_profile_id(uuid),
  public.order_customer_id(uuid), public.vendor_order_vendor_id(uuid), public.review_customer_id(uuid),
  public.flash_sale_vendor_id(uuid), public.payout_vendor_id(uuid), public.loyalty_account_profile_id(uuid),
  public.log_audit_event(text, text, text, jsonb, inet, text),
  public.adjust_inventory(uuid, integer, public.inventory_movement_type, text, uuid, text),
  public.resolve_commission_rate_bps(uuid, uuid)
to authenticated;

-- reserve_inventory / release_inventory / commit_reserved_inventory and
-- generate_order_number are deliberately NOT granted to API roles: checkout
-- runs server-side with the service role.

-- Supabase's auth service inserts into auth.users as supabase_auth_admin and
-- fires the profile-creation trigger.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_auth_user() to supabase_auth_admin;
  end if;
end;
$$;
