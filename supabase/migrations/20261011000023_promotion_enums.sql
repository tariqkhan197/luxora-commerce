-- =============================================================================
-- Migration 0023 (Phase 6B): enum values for promotions.
-- -----------------------------------------------------------------------------
-- New enum values cannot be used in the transaction that adds them, so they
-- live in their own migration ahead of 0024_promotions.
--   promotion_cost           Luxora-funded discounts (platform coupons and
--                            free shipping), posted when an order is paid.
--   promotion_cost_reversed  Luxora's funded share recovered when a vendor
--                            repays a refund (refunds.vendor_liability =
--                            net_of_commission; not the current policy).
-- =============================================================================

alter type public.platform_ledger_entry_type add value if not exists 'promotion_cost';
alter type public.platform_ledger_entry_type add value if not exists 'promotion_cost_reversed';

create type public.coupon_usage_status as enum ('reserved', 'redeemed', 'released');
