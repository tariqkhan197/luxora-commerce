-- =============================================================================
-- Migration 0024 (Phase 6B): coupons and flash sales.
-- -----------------------------------------------------------------------------
-- Approved policy:
--   * Platform coupons are funded by Luxora: vendor earnings stay as if there
--     were no discount, commission is on the full price, and Luxora books the
--     discount as `promotion_cost` when the order is paid. Platform coupons may
--     be free-shipping codes (Luxora pays the shipping).
--   * Vendor coupons and flash sales are funded by the vendor: commission is
--     on the discounted amount. Vendor coupons cannot give free shipping.
--   * One coupon per order; coupons never discount flash-sale items.
--   * Coupon uses and flash-sale units are reserved when the order is placed
--     and released only if the order is never paid (expiry, cancellation,
--     failed payment) — never after a refund or return.
--   * Vendors run their own coupons and flash sales without approval;
--     administrators can disable them. No platform-wide sales of vendor items.
--   * A flash-sale price must be below the regular price.
--
-- Money rules (integer minor units):
--   coupon discount D on eligible subtotal E: percentage = round half-up of
--   E × bps / 10000, capped by max_discount and E; fixed = min(value, E).
--   D is split across eligible lines by largest remainder (ties: earlier line
--   in bag order), so per-line and per-vendor discounts always add up to D.
--   orders.total        = subtotal − discount + shipping − shipping_discount + tax
--   vendor_orders.total = subtotal − discount + shipping − shipping_discount + tax
--   vendor earnings     = total + platform_funded − commission − fee
--   order_items.total   = quantity × unit price − discount + tax   (unchanged)
--   commission base     = line total − vendor-funded discount
-- Refunds return what was paid for the refunded units (cumulative, so a full
-- refund of a line returns exactly its paid total).
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('payments.minimum_charge_minor', '50', 'Smallest order total that can be charged (Stripe minimum, minor units). Codes that would go below it are refused.', false),
  ('coupons.max_failed_attempts_per_hour', '10', 'Failed discount-code attempts allowed per customer per hour.', false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Coupons and flash sales: columns and rules
-- -----------------------------------------------------------------------------
alter table public.coupons
  add column funded_by text generated always as (case when scope = 'platform' then 'platform' else 'vendor' end) stored,
  add column disabled_by_admin_at timestamptz,
  add column disabled_by          uuid references public.profiles (id) on delete set null,
  add column disabled_reason      text check (disabled_reason is null or char_length(disabled_reason) between 3 and 500),
  add constraint coupons_vendor_no_free_shipping check (scope = 'platform' or discount_type <> 'free_shipping'),
  add constraint coupons_max_discount_percentage_only check (max_discount_minor is null or discount_type = 'percentage');

alter table public.coupon_usages
  add column status      public.coupon_usage_status not null default 'reserved',
  add column redeemed_at timestamptz,
  add column released_at timestamptz;

create index coupon_usages_order_idx on public.coupon_usages (order_id);

alter table public.flash_sales
  add column disabled_by_admin_at timestamptz,
  add column disabled_by          uuid references public.profiles (id) on delete set null,
  add column disabled_reason      text check (disabled_reason is null or char_length(disabled_reason) between 3 and 500),
  -- No platform-wide sales: every sale belongs to the vendor that funds it.
  add constraint flash_sales_vendor_required check (vendor_id is not null) not valid;

alter table public.flash_sale_items
  add constraint flash_sale_items_price_positive check (sale_price_minor > 0);

create index flash_sale_items_variant_idx on public.flash_sale_items (variant_id);

-- Failed code attempts (throttling guesses).
create table public.coupon_code_attempts (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index coupon_code_attempts_profile_idx on public.coupon_code_attempts (profile_id, attempted_at desc);

-- A code applied in the bag; checked again (and reserved) when the order is placed.
alter table public.carts add column coupon_id uuid references public.coupons (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Orders: discounts and who funds them
-- -----------------------------------------------------------------------------
alter table public.orders
  add column coupon_id               uuid references public.coupons (id) on delete restrict,
  add column shipping_discount_minor public.money_minor not null default 0;
alter table public.orders
  drop constraint orders_total_consistent,
  add constraint orders_total_consistent
    check (total_minor = subtotal_minor - discount_minor + shipping_minor - shipping_discount_minor + tax_minor),
  add constraint orders_shipping_discount_within_shipping check (shipping_discount_minor <= shipping_minor);

alter table public.vendor_orders
  add column shipping_discount_minor public.money_minor not null default 0,
  add column platform_funded_minor   public.money_minor not null default 0;
alter table public.vendor_orders
  drop constraint vendor_orders_total_consistent,
  drop constraint vendor_orders_earnings_consistent,
  add constraint vendor_orders_total_consistent
    check (total_minor = subtotal_minor - discount_minor + shipping_minor - shipping_discount_minor + tax_minor),
  add constraint vendor_orders_earnings_consistent
    check (vendor_earnings_minor = total_minor + platform_funded_minor - commission_minor - payment_fee_minor),
  add constraint vendor_orders_shipping_discount_within_shipping check (shipping_discount_minor <= shipping_minor),
  add constraint vendor_orders_platform_funded_within_discounts
    check (platform_funded_minor <= discount_minor + shipping_discount_minor);

alter table public.order_items
  add column platform_discount_minor public.money_minor not null default 0,
  add column list_price_minor        public.money_minor,
  add column flash_sale_item_id      uuid references public.flash_sale_items (id) on delete set null,
  add constraint order_items_platform_discount_within_discount check (platform_discount_minor <= discount_minor);

-- Refunds: Luxora-funded shipping discount covered and promotion cost recovered.
alter table public.refunds
  add column shipping_discount_minor  public.money_minor not null default 0,
  add column promotion_reversed_minor public.money_minor not null default 0;
alter table public.refunds
  drop constraint refunds_split_within_amount,
  add constraint refunds_split_within_amount
    check (commission_reversed_minor + vendor_debit_minor <= amount_minor + promotion_reversed_minor);

-- Financial snapshots stay immutable for API roles (new columns included).
create or replace function public.lock_order_financials()
returns trigger
language plpgsql
as $$
begin
  if public.in_trusted_context() then
    return new;
  end if;
  if row(new.order_number, new.customer_id, new.currency, new.subtotal_minor, new.discount_minor, new.shipping_minor,
         new.tax_minor, new.total_minor, new.coupon_code, new.customer_email, new.shipping_address, new.billing_address,
         new.placed_at, new.checkout_token, new.coupon_id, new.shipping_discount_minor)
     is distinct from
     row(old.order_number, old.customer_id, old.currency, old.subtotal_minor, old.discount_minor, old.shipping_minor,
         old.tax_minor, old.total_minor, old.coupon_code, old.customer_email, old.shipping_address, old.billing_address,
         old.placed_at, old.checkout_token, old.coupon_id, old.shipping_discount_minor) then
    raise exception 'order financial snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.lock_vendor_order_financials()
returns trigger
language plpgsql
as $$
begin
  if public.in_trusted_context() then
    return new;
  end if;
  if row(new.order_id, new.vendor_id, new.vendor_order_number, new.currency, new.subtotal_minor, new.discount_minor,
         new.shipping_minor, new.tax_minor, new.total_minor, new.commission_rate_bps, new.commission_minor,
         new.payment_fee_minor, new.vendor_earnings_minor, new.shipping_address, new.shipping_discount_minor,
         new.platform_funded_minor)
     is distinct from
     row(old.order_id, old.vendor_id, old.vendor_order_number, old.currency, old.subtotal_minor, old.discount_minor,
         old.shipping_minor, old.tax_minor, old.total_minor, old.commission_rate_bps, old.commission_minor,
         old.payment_fee_minor, old.vendor_earnings_minor, old.shipping_address, old.shipping_discount_minor,
         old.platform_funded_minor) then
    raise exception 'vendor order financial snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.lock_order_item_financials()
returns trigger
language plpgsql
as $$
begin
  if public.in_trusted_context() then
    return new;
  end if;
  if row(new.order_id, new.vendor_order_id, new.vendor_id, new.product_name, new.variant_title, new.sku, new.quantity,
         new.unit_price_minor, new.discount_minor, new.tax_minor, new.total_minor, new.commission_rate_bps, new.commission_minor,
         new.platform_discount_minor, new.list_price_minor, new.flash_sale_item_id)
     is distinct from
     row(old.order_id, old.vendor_order_id, old.vendor_id, old.product_name, old.variant_title, old.sku, old.quantity,
         old.unit_price_minor, old.discount_minor, old.tax_minor, old.total_minor, old.commission_rate_bps, old.commission_minor,
         old.platform_discount_minor, old.list_price_minor, old.flash_sale_item_id) then
    raise exception 'order item price snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Flash-sale pricing
-- -----------------------------------------------------------------------------
-- A sale is live while it is scheduled/active, not disabled, and inside its
-- window. `remaining` is null when the sale has no unit cap. Internal view:
-- not granted to API roles (it exposes reservation counts).
create view public.live_flash_sale_items as
select fi.id,
       fi.flash_sale_id,
       fi.variant_id,
       fi.sale_price_minor::bigint as sale_price_minor,
       fi.quantity_limit,
       fi.sold_count,
       case when fi.quantity_limit is null then null else fi.quantity_limit - fi.sold_count end as remaining,
       fs.vendor_id,
       fs.ends_at
  from public.flash_sale_items fi
  join public.flash_sales fs on fs.id = fi.flash_sale_id
 where fs.status in ('scheduled', 'active')
   and fs.disabled_by_admin_at is null
   and fs.starts_at <= now()
   and fs.ends_at > now();

create or replace function public.flash_sale_is_live(p_flash_sale_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select status in ('scheduled', 'active') and disabled_by_admin_at is null
                          and starts_at <= now() and ends_at > now()
                     from public.flash_sales where id = p_flash_sale_id), false);
$$;

-- Same checks as before; the price returned is the flash-sale price when the
-- whole quantity fits in the sale's remaining units (never above the regular price).
create or replace function public.assert_variant_purchasable(p_variant_id uuid, p_quantity integer, p_currency text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_available integer;
begin
  if p_quantity < 1 or p_quantity > 99 then
    raise exception 'Quantity must be between 1 and 99.';
  end if;

  select pv.price_minor, pv.is_active, p.name, p.status as product_status, p.currency::text as currency,
         v.status as vendor_status, i.id as inventory_id, i.track_inventory, i.allow_backorder, i.available_quantity
    into v_row
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.vendors v on v.id = p.vendor_id
    left join public.inventory i on i.variant_id = pv.id
   where pv.id = p_variant_id;

  if not found or v_row.product_status <> 'active' or v_row.vendor_status <> 'approved' or not v_row.is_active then
    raise exception 'This item is no longer available.';
  end if;
  if p_currency is not null and v_row.currency <> p_currency then
    raise exception 'Your bag contains items priced in %. Items priced in % must be bought separately.', p_currency, v_row.currency;
  end if;
  if v_row.inventory_id is null then
    raise exception '"%" is out of stock.', v_row.name;
  end if;
  if v_row.track_inventory and not v_row.allow_backorder then
    v_available := v_row.available_quantity;
    if v_available <= 0 then
      raise exception '"%" is out of stock.', v_row.name;
    end if;
    if v_available < p_quantity then
      raise exception 'Only % of "%" available.', v_available, v_row.name;
    end if;
  end if;
  return coalesce((
    select least(lf.sale_price_minor, v_row.price_minor)
      from public.live_flash_sale_items lf
     where lf.variant_id = p_variant_id and (lf.remaining is null or lf.remaining >= p_quantity)
     limit 1), v_row.price_minor);
end;
$$;

-- The bag, priced by the database. New columns (appended): the regular price,
-- the live flash-sale item applied to the line, its end, and whether a sale
-- exists but has fewer units left than the line quantity (D9).
drop function public.cart_lines();
create function public.cart_lines()
returns table (
  cart_item_id       uuid,
  variant_id         uuid,
  product_id         uuid,
  product_slug       text,
  product_name       text,
  variant_title      text,
  sku                text,
  options            jsonb,
  vendor_id          uuid,
  vendor_name        text,
  store_slug         text,
  image_path         text,
  currency           text,
  quantity           integer,
  unit_price_minor   bigint,
  added_price_minor  bigint,
  line_total_minor   bigint,
  max_quantity       integer,
  purchasable        boolean,
  unavailable_reason text,
  list_price_minor   bigint,
  flash_sale_item_id uuid,
  flash_sale_ends_at timestamptz,
  flash_sale_units_left integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ci.id,
    pv.id,
    p.id,
    p.slug::text,
    p.name,
    pv.title,
    pv.sku,
    pv.options,
    v.id,
    coalesce(s.name, v.display_name),
    case when s.status = 'published' then s.slug::text end,
    img.storage_path,
    c.currency::text,
    ci.quantity,
    pr.unit_price,
    ci.unit_price_minor::bigint,
    (pr.unit_price * ci.quantity)::bigint,
    case
      when i.id is null then 0
      when not i.track_inventory or i.allow_backorder then 99
      else greatest(least(i.available_quantity, 99), 0)
    end,
    r.reason is null,
    r.reason,
    pv.price_minor::bigint,
    case when pr.on_sale then fs.id end,
    case when pr.on_sale then fs.ends_at end,
    -- a live sale the line does not fit in: units still available at the sale price
    case when fs.id is not null and not pr.on_sale then greatest(fs.remaining, 0) end
  from public.carts c
  join public.cart_items ci on ci.cart_id = c.id
  join public.product_variants pv on pv.id = ci.variant_id
  join public.products p on p.id = pv.product_id
  join public.vendors v on v.id = p.vendor_id
  left join public.stores s on s.vendor_id = v.id
  left join public.inventory i on i.variant_id = pv.id
  left join lateral (
    select pi.storage_path from public.product_images pi
    where pi.product_id = p.id
    order by (pi.variant_id = pv.id) desc nulls last, pi.is_primary desc, pi.position
    limit 1
  ) img on true
  left join lateral (
    select lf.id, lf.sale_price_minor, lf.remaining, lf.ends_at
      from public.live_flash_sale_items lf
     where lf.variant_id = pv.id and lf.vendor_id = p.vendor_id
     limit 1
  ) fs on true
  cross join lateral (
    select fs.id is not null and (fs.remaining is null or fs.remaining >= ci.quantity) as on_sale
  ) z
  cross join lateral (
    select z.on_sale,
           case when z.on_sale then least(fs.sale_price_minor, pv.price_minor) else pv.price_minor end::bigint as unit_price
  ) pr
  cross join lateral (
    select case
      when p.status <> 'active' or v.status <> 'approved' or not pv.is_active then 'unavailable'
      when p.currency <> c.currency then 'currency_mismatch'
      when i.id is null then 'out_of_stock'
      when i.track_inventory and not i.allow_backorder and i.available_quantity <= 0 then 'out_of_stock'
      when i.track_inventory and not i.allow_backorder and i.available_quantity < ci.quantity then 'insufficient_stock'
    end as reason
  ) r
  where c.profile_id = public.current_profile_id()
    and c.status = 'active'
  order by coalesce(s.name, v.display_name), v.id, ci.created_at, ci.id;
$$;

-- -----------------------------------------------------------------------------
-- Integer allocation and coupon evaluation
-- -----------------------------------------------------------------------------
-- Splits p_amount across p_weights (in order) by largest remainder; ties go to
-- the earlier position. The result always sums to p_amount (when weights > 0).
create or replace function public.allocate_minor_internal(p_amount bigint, p_weights bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_n        integer := coalesce(array_length(p_weights, 1), 0);
  v_total    numeric;
  v_shares   bigint[];
  v_leftover bigint;
  v_rec      record;
begin
  if v_n = 0 then
    return '{}'::bigint[];
  end if;
  select coalesce(sum(w), 0) into v_total from unnest(p_weights) w;
  v_shares := array_fill(0::bigint, array[v_n]);
  if v_total <= 0 or coalesce(p_amount, 0) <= 0 then
    return v_shares;
  end if;
  for i in 1 .. v_n loop
    v_shares[i] := floor(p_amount::numeric * p_weights[i] / v_total)::bigint;
  end loop;
  select p_amount - sum(s) into v_leftover from unnest(v_shares) s;
  for v_rec in
    select w.ord
      from unnest(p_weights) with ordinality as w(weight, ord)
     order by mod(p_amount::numeric * w.weight, v_total) desc, w.ord
     limit v_leftover
  loop
    v_shares[v_rec.ord] := v_shares[v_rec.ord] + 1;
  end loop;
  return v_shares;
end;
$$;

create or replace function public.format_money_internal(p_minor bigint, p_currency text)
returns text
language sql
immutable
as $$
  select p_currency || ' ' || to_char(p_minor / 100.0, 'FM999,999,999,990.00');
$$;

-- Evaluates a coupon against the caller's bag. With a destination country the
-- free-shipping amounts and the minimum-charge check include shipping.
-- Returns the merchandise discount and its split per bag line, and the
-- shipping discount per vendor.
create or replace function public.cart_coupon_allocation_internal(p_coupon_id uuid, p_country text)
returns table (
  ok                        boolean,
  message                   text,
  discount_minor            bigint,
  shipping_discount_minor   bigint,
  line_discounts            jsonb,
  vendor_shipping_discounts jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_profile   uuid := public.current_profile_id();
  v_coupon    public.coupons;
  v_used      integer;
  v_currency  text;
  v_all       bigint;
  v_eligible  bigint;
  v_base      bigint;
  v_ids       uuid[];
  v_weights   bigint[];
  v_shares    bigint[];
  v_discount  bigint := 0;
  v_shipping  bigint := 0;
  v_ship_disc bigint := 0;
  v_lines     jsonb := '{}'::jsonb;
  v_vendors   jsonb := '{}'::jsonb;
  v_vendor    text;
  v_min       bigint := public.platform_setting_int('payments.minimum_charge_minor', 50);
begin
  select * into v_coupon from public.coupons c where c.id = p_coupon_id;
  if not found or not v_coupon.is_active or v_coupon.disabled_by_admin_at is not null
     or (v_coupon.scope = 'vendor' and v_coupon.discount_type = 'free_shipping') then
    return query select false, 'This code isn''t valid.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;
  if v_coupon.starts_at > now() then
    return query select false, 'This code isn''t active yet.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;
  if v_coupon.ends_at is not null and v_coupon.ends_at <= now() then
    return query select false, 'This code has expired.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;
  if v_coupon.usage_limit is not null and v_coupon.used_count >= v_coupon.usage_limit then
    return query select false, 'This code has reached its usage limit.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;
  if v_coupon.usage_limit_per_customer is not null then
    select count(*) into v_used from public.coupon_usages u
     where u.coupon_id = v_coupon.id and u.customer_id = v_profile and u.status in ('reserved', 'redeemed');
    if v_used >= v_coupon.usage_limit_per_customer then
      return query select false, 'You have already used this code.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
      return;
    end if;
  end if;

  select coalesce(sum(l.line_total_minor), 0), min(l.currency) into v_all, v_currency from public.cart_lines() l;
  select array_agg(l.cart_item_id order by l.ordinality), array_agg(l.line_total_minor order by l.ordinality),
         coalesce(sum(l.line_total_minor), 0)
    into v_ids, v_weights, v_eligible
    from public.cart_lines() with ordinality as l
   where l.flash_sale_item_id is null
     and (v_coupon.scope = 'platform' or l.vendor_id = v_coupon.vendor_id);

  if v_coupon.discount_type = 'free_shipping' then
    v_base := v_all;  -- D3: order-level, flash-sale items count towards the minimum spend
  else
    if v_eligible = 0 then
      if v_coupon.scope = 'vendor' then
        select coalesce(s.name, v.display_name) into v_vendor
          from public.vendors v left join public.stores s on s.vendor_id = v.id
         where v.id = v_coupon.vendor_id;
        return query select false, format('This code applies only to items from %s that aren''t on flash sale.', coalesce(v_vendor, 'one brand')),
                            0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
      else
        return query select false, 'This code doesn''t apply to items on flash sale.', 0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
      end if;
      return;
    end if;
    v_base := v_eligible;  -- D4: minimum spend on the items the code discounts
  end if;
  if v_base < v_coupon.min_subtotal_minor then
    return query select false,
      format('Spend at least %s on eligible items to use this code.', public.format_money_internal(v_coupon.min_subtotal_minor, coalesce(v_currency, 'USD'))),
      0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;

  if v_coupon.discount_type = 'percentage' then
    v_discount := least((v_eligible * v_coupon.discount_value + 5000) / 10000,  -- D1: round half-up
                        coalesce(v_coupon.max_discount_minor, v_eligible), v_eligible);
  elsif v_coupon.discount_type = 'fixed_amount' then
    v_discount := least(v_coupon.discount_value, v_eligible);
  end if;
  if v_discount > 0 then
    v_shares := public.allocate_minor_internal(v_discount, v_weights);
    select coalesce(jsonb_object_agg(x.id, x.share), '{}'::jsonb) into v_lines
      from unnest(v_ids, v_shares) as x(id, share)
     where x.share > 0;
  end if;

  if p_country is not null then
    select coalesce(sum(q.shipping_minor), 0) into v_shipping from public.cart_shipping_for_country(p_country) q;
    if v_coupon.discount_type = 'free_shipping' then
      select coalesce(jsonb_object_agg(q.vendor_id, q.shipping_minor), '{}'::jsonb), coalesce(sum(q.shipping_minor), 0)
        into v_vendors, v_ship_disc
        from public.cart_shipping_for_country(p_country) q
       where q.shipping_minor > 0;
    end if;
  end if;

  -- D6: never below the smallest chargeable amount.
  if v_all - v_discount + v_shipping - v_ship_disc < v_min then
    return query select false,
      format('This code would bring your order below the minimum payment of %s.', public.format_money_internal(v_min, coalesce(v_currency, 'USD'))),
      0::bigint, 0::bigint, '{}'::jsonb, '{}'::jsonb;
    return;
  end if;

  return query select true, null::text, v_discount, v_ship_disc, v_lines, v_vendors;
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer: discount codes in the bag
-- -----------------------------------------------------------------------------
create or replace function public.apply_cart_coupon(p_code text)
returns table (applied boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_cart    public.carts;
  v_coupon  public.coupons;
  v_failed  integer;
  v_result  record;
begin
  select count(*) into v_failed from public.coupon_code_attempts a
   where a.profile_id = v_profile and not a.succeeded and a.attempted_at > now() - interval '1 hour';
  if v_failed >= public.platform_setting_int('coupons.max_failed_attempts_per_hour', 10) then
    return query select false, 'Too many attempts. Please try again later.';
    return;
  end if;

  select * into v_cart from public.carts where profile_id = v_profile and status = 'active' for update;
  if not found or not exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    return query select false, 'Add something to your bag first.';
    return;
  end if;

  -- Codes are case-insensitive (the citext operators are outside this search_path).
  select * into v_coupon from public.coupons where lower(code::text) = lower(trim(coalesce(p_code, '')));
  if not found then
    insert into public.coupon_code_attempts (profile_id, succeeded) values (v_profile, false);
    return query select false, 'This code isn''t valid.';
    return;
  end if;

  select * into v_result from public.cart_coupon_allocation_internal(v_coupon.id, null);
  insert into public.coupon_code_attempts (profile_id, succeeded) values (v_profile, v_result.ok);
  if not v_result.ok then
    return query select false, v_result.message;
    return;
  end if;

  update public.carts set coupon_id = v_coupon.id, updated_at = now() where id = v_cart.id;
  return query select true,
    case when v_coupon.discount_type = 'free_shipping' then 'Code applied: free shipping at checkout.' else 'Code applied.' end;
end;
$$;

create or replace function public.remove_cart_coupon()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
begin
  update public.carts set coupon_id = null, updated_at = now()
   where profile_id = v_profile and status = 'active' and coupon_id is not null;
end;
$$;

-- The code in the bag and what it is worth now. With a shipping address the
-- free-shipping amounts are included. No rows when no code is applied.
create or replace function public.cart_promotion_quote(p_address_id uuid default null)
returns table (
  coupon_id                 uuid,
  code                      text,
  name                      text,
  funded_by                 text,
  discount_type             public.discount_type,
  applied                   boolean,
  message                   text,
  discount_minor            bigint,
  shipping_discount_minor   bigint,
  line_discounts            jsonb,
  vendor_shipping_discounts jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_profile uuid := public.require_active_customer();
  v_cart    public.carts;
  v_coupon  public.coupons;
  v_country text;
  v_result  record;
begin
  select * into v_cart from public.carts c where c.profile_id = v_profile and c.status = 'active';
  if not found or v_cart.coupon_id is null then
    return;
  end if;
  if p_address_id is not null then
    select a.country_code into v_country from public.addresses a
     where a.id = p_address_id and a.profile_id = v_profile and a.type <> 'billing';
    if not found then
      raise exception 'Choose a valid shipping address.';
    end if;
  end if;
  select * into v_coupon from public.coupons c where c.id = v_cart.coupon_id;
  select * into v_result from public.cart_coupon_allocation_internal(v_coupon.id, v_country);
  return query select v_coupon.id, v_coupon.code::text, v_coupon.name, v_coupon.funded_by, v_coupon.discount_type,
                      v_result.ok, v_result.message, v_result.discount_minor, v_result.shipping_discount_minor,
                      v_result.line_discounts, v_result.vendor_shipping_discounts;
end;
$$;

-- -----------------------------------------------------------------------------
-- Checkout: place_order() with promotions.
-- Same signature and behaviour as Release 4a, plus (marked "Phase 6B"):
-- flash-sale prices, the bag's discount code, discount allocation and funding,
-- and the reservation of coupon uses and flash-sale units.
-- Lock order everywhere: bag → inventory → flash-sale items → coupon.
-- -----------------------------------------------------------------------------
create or replace function public.place_order(
  p_shipping_address_id  uuid,
  p_billing_address_id   uuid,
  p_checkout_token       uuid,
  p_expected_total_minor bigint default null,
  p_customer_note        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile      uuid := public.require_active_customer();
  v_existing     public.orders;
  v_cart         public.carts;
  v_ship         public.addresses;
  v_bill         public.addresses;
  v_email        text;
  v_line         record;
  v_vendor       record;
  v_subtotal     bigint;
  v_shipping     bigint;
  v_vendor_ship  bigint;
  v_blocker      record;
  v_order_id     uuid;
  v_order_number text;
  v_vo_id        uuid;
  v_index        integer := 0;
  v_minutes      integer;
  v_available    integer;
  -- Phase 6B
  v_coupon       public.coupons;
  v_alloc        record;
  v_lines_disc   jsonb := '{}'::jsonb;
  v_vendor_ship_disc jsonb := '{}'::jsonb;
  v_discount     bigint := 0;
  v_ship_discount bigint := 0;
  v_platform     boolean := false;
  v_vo_ship_disc bigint;
  v_vo_platform  bigint;
  v_vo_total     bigint;
begin
  if p_checkout_token is null then
    raise exception 'A checkout token is required.';
  end if;
  if p_customer_note is not null and char_length(p_customer_note) > 1000 then
    raise exception 'Order notes must be 1000 characters or fewer.';
  end if;

  -- Idempotency: replaying the same submission returns the same order.
  select * into v_existing from public.orders where checkout_token = p_checkout_token;
  if found then
    if v_existing.customer_id <> v_profile then
      raise exception 'Invalid checkout token.' using errcode = 'insufficient_privilege';
    end if;
    return v_existing.id;
  end if;

  select * into v_cart from public.carts where profile_id = v_profile and status = 'active' for update;
  if not found or not exists (select 1 from public.cart_items where cart_id = v_cart.id) then
    raise exception 'Your bag is empty.';
  end if;

  select * into v_ship from public.addresses where id = p_shipping_address_id and profile_id = v_profile;
  if not found or v_ship.type = 'billing' then
    raise exception 'Choose a valid shipping address.';
  end if;
  select * into v_bill from public.addresses where id = p_billing_address_id and profile_id = v_profile;
  if not found or v_bill.type = 'shipping' then
    raise exception 'Choose a valid billing address.';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    raise exception 'Your account has no email address.';
  end if;

  -- Free stock held by abandoned checkouts for the same items.
  perform public.expire_stale_checkouts(array(select ci.variant_id from public.cart_items ci where ci.cart_id = v_cart.id));

  -- Catalog-level availability (stock is re-checked under lock below).
  select l.product_name, l.unavailable_reason into v_line
    from public.cart_lines() l
   where l.unavailable_reason in ('unavailable', 'currency_mismatch')
   limit 1;
  if found then
    raise exception '"%" is no longer available. Remove it from your bag to continue.', v_line.product_name;
  end if;

  -- Release 4a: every vendor in the bag must ship to the destination.
  select q.vendor_name, q.reason into v_blocker
    from public.cart_shipping_for_country(v_ship.country_code) q
   where not q.shippable
   limit 1;
  if found then
    if v_blocker.reason = 'country_not_served' then
      raise exception 'Luxora does not ship to the selected address yet.';
    end if;
    raise exception '"%" does not ship to the selected address. Remove their items or choose another address.', v_blocker.vendor_name;
  end if;

  -- Lock inventory rows in a global order (variant id) to avoid deadlocks.
  -- Concurrent checkouts for the same stock serialise here.
  perform 1 from public.inventory i
    where i.variant_id in (select ci.variant_id from public.cart_items ci where ci.cart_id = v_cart.id)
    order by i.variant_id
    for update;

  -- Phase 6B: then the flash-sale allocations of those variants, then the coupon,
  -- so the prices and limits read below cannot change until this order commits.
  perform 1 from public.flash_sale_items f
    where f.variant_id in (select ci.variant_id from public.cart_items ci where ci.cart_id = v_cart.id)
    order by f.id
    for update;
  if v_cart.coupon_id is not null then
    select * into v_coupon from public.coupons where id = v_cart.coupon_id for update;
  end if;

  select coalesce(sum(l.line_total_minor), 0) into v_subtotal from public.cart_lines() l;
  select coalesce(sum(q.shipping_minor), 0) into v_shipping from public.cart_shipping_for_country(v_ship.country_code) q;

  if v_coupon.id is not null then
    select * into v_alloc from public.cart_coupon_allocation_internal(v_coupon.id, v_ship.country_code);
    if not v_alloc.ok then
      raise exception '% Remove the code % from your bag to continue.', v_alloc.message, v_coupon.code;
    end if;
    v_discount := v_alloc.discount_minor;
    v_ship_discount := v_alloc.shipping_discount_minor;
    v_lines_disc := v_alloc.line_discounts;
    v_vendor_ship_disc := v_alloc.vendor_shipping_discounts;
    v_platform := v_coupon.scope = 'platform';
  end if;

  if p_expected_total_minor is not null
     and p_expected_total_minor <> v_subtotal - v_discount + v_shipping - v_ship_discount then
    raise exception 'Prices or shipping costs have changed. Please review your order and try again.';
  end if;

  for v_line in
    select ci.variant_id, ci.quantity, p.name, i.id as inventory_id, i.track_inventory, i.allow_backorder,
           i.stock_quantity - i.reserved_quantity as available
      from public.cart_items ci
      join public.product_variants pv on pv.id = ci.variant_id
      join public.products p on p.id = pv.product_id
      left join public.inventory i on i.variant_id = ci.variant_id
     where ci.cart_id = v_cart.id
     order by ci.variant_id
  loop
    if v_line.inventory_id is null then
      raise exception '"%" is out of stock.', v_line.name;
    end if;
    if v_line.track_inventory and not v_line.allow_backorder and v_line.available < v_line.quantity then
      v_available := greatest(v_line.available, 0);
      if v_available = 0 then
        raise exception '"%" has just sold out.', v_line.name;
      end if;
      raise exception 'Only % of "%" left in stock. Update your bag to continue.', v_available, v_line.name;
    end if;
    perform public.inventory_reserve_internal(v_line.variant_id, v_line.quantity);
  end loop;

  select coalesce((value #>> '{}')::integer, 30) into v_minutes
    from public.platform_settings where key = 'checkout.reservation_minutes';
  v_minutes := coalesce(v_minutes, 30);

  insert into public.orders (
    customer_id, currency, subtotal_minor, discount_minor, shipping_minor, shipping_discount_minor, total_minor,
    coupon_id, coupon_code, customer_email, customer_note,
    shipping_address, billing_address, checkout_token, reservation_expires_at
  ) values (
    v_profile, v_cart.currency, v_subtotal, v_discount, v_shipping, v_ship_discount,
    v_subtotal - v_discount + v_shipping - v_ship_discount,
    v_coupon.id, v_coupon.code, v_email, nullif(trim(p_customer_note), ''),
    public.address_snapshot(v_ship), public.address_snapshot(v_bill), p_checkout_token,
    now() + make_interval(mins => v_minutes)
  ) returning id, order_number into v_order_id, v_order_number;

  -- One vendor order per vendor. Commission per line uses that line's category
  -- and is charged on the line total minus any vendor-funded discount.
  for v_vendor in
    select l.vendor_id,
           sum(l.line_total_minor)::bigint as subtotal,
           sum(d.discount)::bigint as discount,
           sum(public.calculate_commission_minor(l.line_total_minor - case when v_platform then 0 else d.discount end,
               public.resolve_commission_rate_bps(l.vendor_id, p.category_id)))::bigint as commission
      from public.cart_lines() l
      join public.products p on p.id = l.product_id
      cross join lateral (select coalesce((v_lines_disc ->> l.cart_item_id::text)::bigint, 0) as discount) d
     group by l.vendor_id
     order by l.vendor_id
  loop
    v_index := v_index + 1;
    select coalesce(sum(q.shipping_minor), 0) into v_vendor_ship
      from public.cart_shipping_for_country(v_ship.country_code) q
     where q.vendor_id = v_vendor.vendor_id;
    v_vo_ship_disc := coalesce((v_vendor_ship_disc ->> v_vendor.vendor_id::text)::bigint, 0);
    v_vo_platform := case when v_platform then v_vendor.discount + v_vo_ship_disc else 0 end;
    v_vo_total := v_vendor.subtotal - v_vendor.discount + v_vendor_ship - v_vo_ship_disc;
    insert into public.vendor_orders (
      order_id, vendor_id, vendor_order_number, currency, subtotal_minor, discount_minor, shipping_minor,
      shipping_discount_minor, total_minor, platform_funded_minor,
      commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor, shipping_address
    ) values (
      v_order_id, v_vendor.vendor_id, v_order_number || '-' || lpad(v_index::text, 2, '0'), v_cart.currency,
      v_vendor.subtotal, v_vendor.discount, v_vendor_ship, v_vo_ship_disc, v_vo_total, v_vo_platform,
      -- effective (blended) rate on the commission base, for reporting; per-line rates are on order_items
      case when v_vendor.subtotal - case when v_platform then 0 else v_vendor.discount end > 0
           then least(10000, (v_vendor.commission * 10000
                              + (v_vendor.subtotal - case when v_platform then 0 else v_vendor.discount end) / 2)
                             / (v_vendor.subtotal - case when v_platform then 0 else v_vendor.discount end))::integer
           else 0 end,
      -- commission is on merchandise only; shipping is passed through to the vendor
      v_vendor.commission, 0, v_vo_total + v_vo_platform - v_vendor.commission, public.address_snapshot(v_ship)
    ) returning id into v_vo_id;

    insert into public.order_items (
      order_id, vendor_order_id, vendor_id, product_id, variant_id, product_name, variant_title, sku,
      image_path, quantity, unit_price_minor, discount_minor, platform_discount_minor, total_minor,
      commission_rate_bps, commission_minor, list_price_minor, flash_sale_item_id
    )
    select v_order_id, v_vo_id, l.vendor_id, l.product_id, l.variant_id, l.product_name, l.variant_title, l.sku,
           l.image_path, l.quantity, l.unit_price_minor, d.discount, case when v_platform then d.discount else 0 end,
           l.line_total_minor - d.discount, r.rate,
           public.calculate_commission_minor(l.line_total_minor - case when v_platform then 0 else d.discount end, r.rate),
           l.list_price_minor, l.flash_sale_item_id
      from public.cart_lines() l
      join public.products p on p.id = l.product_id
      cross join lateral (select public.resolve_commission_rate_bps(l.vendor_id, p.category_id) as rate) r
      cross join lateral (select coalesce((v_lines_disc ->> l.cart_item_id::text)::bigint, 0) as discount) d
     where l.vendor_id = v_vendor.vendor_id;
  end loop;

  -- Phase 6B: reserve flash-sale units (after the item snapshot above, which
  -- priced the lines before this order's own reservation).
  for v_line in
    select oi.flash_sale_item_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = v_order_id and oi.flash_sale_item_id is not null
     group by oi.flash_sale_item_id
     order by oi.flash_sale_item_id
  loop
    update public.flash_sale_items
       set sold_count = sold_count + v_line.quantity
     where id = v_line.flash_sale_item_id
       and (quantity_limit is null or sold_count + v_line.quantity <= quantity_limit);
    if not found then
      raise exception 'Prices or shipping costs have changed. Please review your order and try again.';
    end if;
  end loop;

  -- Phase 6B: reserve one use of the code (released if the order is never paid).
  if v_coupon.id is not null then
    insert into public.coupon_usages (coupon_id, order_id, customer_id, discount_minor, status)
    values (v_coupon.id, v_order_id, v_profile, v_discount + v_ship_discount, 'reserved');
    update public.coupons set used_count = used_count + 1 where id = v_coupon.id;
  end if;

  update public.carts set status = 'converted' where id = v_cart.id;
  return v_order_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Unpaid orders: release coupon uses and flash-sale units with the stock
-- -----------------------------------------------------------------------------
create or replace function public.release_order_reservations_internal(
  p_order_id       uuid,
  p_reason         text,
  p_payment_status public.payment_status
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_item      record;
  v_coupon_id uuid;
begin
  for v_item in
    select oi.variant_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = p_order_id and oi.variant_id is not null
       and exists (select 1 from public.inventory i where i.variant_id = oi.variant_id)
     group by oi.variant_id
     order by oi.variant_id
  loop
    perform public.inventory_release_internal(v_item.variant_id, v_item.quantity);
  end loop;

  -- Phase 6B: flash-sale units, then the coupon use (same lock order as checkout).
  for v_item in
    select oi.flash_sale_item_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = p_order_id and oi.flash_sale_item_id is not null
     group by oi.flash_sale_item_id
     order by oi.flash_sale_item_id
  loop
    update public.flash_sale_items set sold_count = greatest(sold_count - v_item.quantity, 0)
     where id = v_item.flash_sale_item_id;
  end loop;
  update public.coupon_usages set status = 'released', released_at = now()
   where order_id = p_order_id and status = 'reserved'
  returning coupon_id into v_coupon_id;
  if v_coupon_id is not null then
    update public.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon_id;
  end if;

  update public.orders
     set status = 'cancelled', payment_status = p_payment_status, cancelled_at = now(),
         cancellation_reason = p_reason, reservation_expires_at = null
   where id = p_order_id;
  update public.vendor_orders set status = 'cancelled', cancelled_at = now() where order_id = p_order_id;
  update public.payment_attempts
     set status = case when p_payment_status = 'failed' then 'failed'::public.payment_attempt_status
                       else 'expired'::public.payment_attempt_status end
   where order_id = p_order_id and status = 'open';
end;
$$;

-- Vendor-borne processing fees keep the earnings rule (now including Luxora-funded discounts).
create or replace function public.allocate_payment_fee_internal(p_order_id uuid, p_fee_minor bigint)
returns void
language plpgsql
set search_path = public
as $$
begin
  with base as (
    select vo.id, vo.total_minor as w, row_number() over (order by vo.vendor_order_number) as rn
      from public.vendor_orders vo where vo.order_id = p_order_id
  ), tot as (
    select sum(w)::bigint as tw, count(*)::bigint as n from base
  ), shares as (
    select b.id, b.rn,
           case when t.tw > 0 then (p_fee_minor * b.w) / t.tw else p_fee_minor / t.n end as share,
           case when t.tw > 0 then (p_fee_minor * b.w) % t.tw else 0 end as frac
      from base b cross join tot t
  ), ranked as (
    select s.*, row_number() over (order by s.frac desc, s.rn) as rk,
           p_fee_minor - sum(s.share) over () as leftover
      from shares s
  )
  update public.vendor_orders vo
     set payment_fee_minor = r.share + case when r.rk <= r.leftover then 1 else 0 end,
         vendor_earnings_minor = vo.total_minor + vo.platform_funded_minor - vo.commission_minor
                                 - (r.share + case when r.rk <= r.leftover then 1 else 0 end)
    from ranked r
   where vo.id = r.id;
end;
$$;

-- Paid orders: earnings and commission (Phase 4b), Luxora-funded discounts as
-- promotion_cost, and the reserved coupon use becomes redeemed.
create or replace function public.post_paid_order_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status in ('pending', 'processing') then
    insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, vendor_order_id, description)
    select vo.vendor_id, 'order_earning', vo.vendor_earnings_minor, vo.currency, vo.id, 'Earnings for ' || vo.vendor_order_number
      from public.vendor_orders vo where vo.order_id = new.id
    on conflict do nothing;
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, description)
    select 'commission_earned', vo.commission_minor, vo.currency, new.id, vo.id, 'Commission on ' || vo.vendor_order_number
      from public.vendor_orders vo where vo.order_id = new.id and vo.commission_minor > 0;
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, reference, description)
    select 'promotion_cost', -vo.platform_funded_minor, vo.currency, new.id, vo.id, new.coupon_code,
           'Luxora-funded discount on ' || vo.vendor_order_number
      from public.vendor_orders vo where vo.order_id = new.id and vo.platform_funded_minor > 0;
    update public.coupon_usages set status = 'redeemed', redeemed_at = now()
     where order_id = new.id and status = 'reserved';
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Refunds: return what was paid for the refunded units
-- -----------------------------------------------------------------------------
create or replace function public.request_refund(
  p_vendor_order_id  uuid,
  p_items            jsonb,                 -- [{"order_item_id": uuid, "quantity": int}, …]
  p_kind             public.refund_kind,
  p_reason           text,
  p_include_shipping boolean default null   -- null: follow the configured policy
)
returns table (refund_id uuid, amount_minor bigint, currency text, provider_payment_id text, order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_vo           public.vendor_orders;
  v_order        public.orders;
  v_payment      public.payments;
  v_refund_id    uuid;
  v_req          record;
  v_item         public.order_items;
  v_in_flight    integer;
  v_done         integer;
  v_items_total  bigint := 0;
  v_items_vendor bigint := 0;
  v_commission   bigint := 0;
  v_line_comm    bigint;
  v_line_paid    bigint;
  v_line_vendor  bigint;
  v_shipping     bigint := 0;
  v_ship_disc    bigint := 0;
  v_ship_left    bigint;
  v_ship_disc_left bigint;
  v_full         boolean;
  v_include      boolean;
  v_amount       bigint;
  v_refundable   bigint;
  v_liability    text := public.platform_setting_text('refunds.vendor_liability', 'none');
  v_vendor_debit bigint := 0;
  v_comm_rev     bigint := 0;
  v_promo_rev    bigint := 0;
begin
  if not public.is_admin() then
    raise exception 'only administrators can issue refunds' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('cancellation', 'return', 'goodwill') then
    raise exception 'Choose cancellation, return or goodwill.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Give a reason for the refund (at least 3 characters).';
  end if;

  select * into v_vo from public.vendor_orders where id = p_vendor_order_id for update;
  if not found then
    raise exception 'Vendor order not found.' using errcode = 'no_data_found';
  end if;
  select * into v_order from public.orders where id = v_vo.order_id for update;
  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'Only paid orders can be refunded.';
  end if;
  select * into v_payment from public.payments
   where order_id = v_order.id and status in ('paid', 'partially_refunded')
   order by created_at limit 1 for update;
  if not found then
    raise exception 'This order has no refundable payment.';
  end if;

  insert into public.refunds (order_id, vendor_order_id, payment_id, status, currency, amount_minor, reason, kind,
                              requested_by, approved_by, approved_at)
  values (v_order.id, v_vo.id, v_payment.id, 'processing', v_order.currency, 1, trim(p_reason), p_kind,
          public.current_profile_id(), public.current_profile_id(), now())
  returning id into v_refund_id;

  for v_req in
    select (e ->> 'order_item_id')::uuid as order_item_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
     group by 1
  loop
    if v_req.quantity is null or v_req.quantity < 1 then
      raise exception 'Refund quantities must be at least 1.';
    end if;
    select * into v_item from public.order_items where id = v_req.order_item_id and vendor_order_id = v_vo.id for update;
    if not found then
      raise exception 'An item does not belong to this vendor order.';
    end if;
    select coalesce(sum(ri.quantity), 0)::integer into v_in_flight
      from public.refund_items ri join public.refunds r on r.id = ri.refund_id
     where ri.order_item_id = v_item.id and r.status in ('requested', 'approved', 'processing') and r.id <> v_refund_id;
    if v_req.quantity > v_item.quantity - v_item.refunded_quantity - v_in_flight then
      raise exception 'Only % of "%" can still be refunded.', greatest(v_item.quantity - v_item.refunded_quantity - v_in_flight, 0), v_item.product_name;
    end if;
    -- Cumulative splits: refunding every unit returns exactly the line's totals.
    v_done := v_item.refunded_quantity + v_in_flight;
    v_line_comm := (v_item.commission_minor * (v_done + v_req.quantity)) / v_item.quantity
                 - (v_item.commission_minor * v_done) / v_item.quantity;
    -- What the customer paid for these units (after any discount)…
    v_line_paid := (v_item.total_minor * (v_done + v_req.quantity)) / v_item.quantity
                 - (v_item.total_minor * v_done) / v_item.quantity;
    -- …and their value on the vendor's side (Luxora-funded discounts added back).
    v_line_vendor := ((v_item.total_minor + v_item.platform_discount_minor) * (v_done + v_req.quantity)) / v_item.quantity
                   - ((v_item.total_minor + v_item.platform_discount_minor) * v_done) / v_item.quantity;
    insert into public.refund_items (refund_id, order_item_id, quantity, amount_minor, commission_minor)
    values (v_refund_id, v_item.id, v_req.quantity, v_line_paid, v_line_comm);
    v_items_total := v_items_total + v_line_paid;
    v_items_vendor := v_items_vendor + v_line_vendor;
    v_commission := v_commission + v_line_comm;
  end loop;

  -- Does this refund (with those in flight) cover every remaining unit of the vendor order?
  select not exists (
    select 1 from public.order_items oi
     where oi.vendor_order_id = v_vo.id
       and oi.quantity > oi.refunded_quantity + coalesce((
             select sum(ri.quantity) from public.refund_items ri join public.refunds r on r.id = ri.refund_id
              where ri.order_item_id = oi.id and r.status in ('requested', 'approved', 'processing')), 0)
  ) into v_full;

  -- Only the shipping the customer actually paid can be refunded to them.
  select v_vo.shipping_minor - v_vo.shipping_discount_minor - coalesce(sum(r.shipping_minor), 0),
         v_vo.shipping_discount_minor - coalesce(sum(r.shipping_discount_minor), 0)
    into v_ship_left, v_ship_disc_left
    from public.refunds r
   where r.vendor_order_id = v_vo.id and r.status in ('requested', 'approved', 'processing', 'completed') and r.id <> v_refund_id;
  v_include := coalesce(p_include_shipping, case
    when not v_full then public.platform_setting_text('refunds.shipping_on_partial', 'false') = 'true'
    when p_kind = 'cancellation' then public.platform_setting_text('refunds.shipping_on_full_cancellation', 'true') = 'true'
    when p_kind = 'return' then public.platform_setting_text('refunds.shipping_on_full_return', 'false') = 'true'
    else false end);
  if v_include then
    v_shipping := greatest(v_ship_left, 0);
    v_ship_disc := greatest(v_ship_disc_left, 0);
  end if;

  v_amount := v_items_total + v_shipping;
  if v_amount <= 0 then
    raise exception 'Nothing to refund: choose items (or include the shipping charge).';
  end if;
  select v_payment.amount_minor - v_payment.refunded_minor - coalesce(sum(r.amount_minor), 0) into v_refundable
    from public.refunds r
   where r.payment_id = v_payment.id and r.status in ('requested', 'approved', 'processing') and r.id <> v_refund_id;
  if v_amount > v_refundable then
    raise exception 'The refund exceeds what is left to refund on this payment.';
  end if;

  if v_liability = 'net_of_commission' then
    -- The vendor repays its earnings on the refunded part; Luxora recovers the
    -- discount it funded on those units.
    v_comm_rev := v_commission;
    v_promo_rev := (v_items_vendor - v_items_total) + v_ship_disc;
    v_vendor_debit := v_items_vendor + v_shipping + v_ship_disc - v_commission;
  end if;

  update public.refunds
     set amount_minor = v_amount, shipping_minor = v_shipping, shipping_discount_minor = v_ship_disc,
         commission_reversed_minor = v_comm_rev, vendor_debit_minor = v_vendor_debit,
         promotion_reversed_minor = v_promo_rev
   where id = v_refund_id;

  perform public.log_audit_event('refund.requested', 'refund', v_refund_id::text,
    jsonb_build_object('order_id', v_order.id, 'vendor_order_id', v_vo.id, 'amount_minor', v_amount,
                       'shipping_minor', v_shipping, 'kind', p_kind, 'vendor_liability', v_liability,
                       'platform_funded_minor', (v_items_vendor - v_items_total) + v_ship_disc));

  return query select v_refund_id, v_amount, v_order.currency::text, v_payment.provider_payment_id, v_order.id;
end;
$$;

create or replace function public.complete_refund_internal(p_refund_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_refund    public.refunds;
  v_payment   public.payments;
  v_vo        public.vendor_orders;
  v_paid_left bigint;
  v_loss      bigint;
begin
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if v_refund.status = 'completed' then
    return 'duplicate';
  end if;
  if v_refund.status not in ('requested', 'approved', 'processing') then
    return 'ignored';
  end if;

  update public.refunds set status = 'completed', processed_at = now(), failure_message = null where id = v_refund.id;

  update public.order_items oi
     set refunded_quantity = oi.refunded_quantity + ri.quantity
    from public.refund_items ri
   where ri.refund_id = v_refund.id and oi.id = ri.order_item_id;

  select * into v_payment from public.payments where id = v_refund.payment_id for update;
  update public.payments
     set refunded_minor = refunded_minor + v_refund.amount_minor,
         status = case when refunded_minor + v_refund.amount_minor >= amount_minor then 'refunded'::public.payment_status
                       else 'partially_refunded'::public.payment_status end
   where id = v_payment.id;
  insert into public.payment_transactions (payment_id, type, status, amount_minor, currency, provider_transaction_id)
  values (v_payment.id, 'refund', 'succeeded', -v_refund.amount_minor, v_refund.currency, v_refund.provider_refund_id);

  select coalesce(sum(amount_minor - refunded_minor), 0) into v_paid_left
    from public.payments where order_id = v_refund.order_id and status in ('paid', 'partially_refunded', 'refunded');
  update public.orders
     set payment_status = case when v_paid_left <= 0 then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
         status = case when v_paid_left <= 0 then 'refunded'::public.order_status else status end
   where id = v_refund.order_id;

  if v_refund.vendor_order_id is not null then
    select * into v_vo from public.vendor_orders where id = v_refund.vendor_order_id for update;
    if not exists (select 1 from public.order_items oi where oi.vendor_order_id = v_vo.id and oi.refunded_quantity < oi.quantity) then
      update public.vendor_orders set status = 'refunded' where id = v_vo.id;
    end if;
    if v_refund.vendor_debit_minor > 0 then
      insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, vendor_order_id, refund_id, description)
      values (v_vo.vendor_id, 'refund_debit', -v_refund.vendor_debit_minor, v_refund.currency, v_vo.id, v_refund.id,
              'Refund on ' || v_vo.vendor_order_number);
    end if;
  end if;

  if v_refund.commission_reversed_minor > 0 then
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, refund_id, description)
    values ('commission_reversed', -v_refund.commission_reversed_minor, v_refund.currency, v_refund.order_id,
            v_refund.vendor_order_id, v_refund.id, 'Commission returned on refund');
  end if;
  if v_refund.promotion_reversed_minor > 0 then
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, refund_id, description)
    values ('promotion_cost_reversed', v_refund.promotion_reversed_minor, v_refund.currency, v_refund.order_id,
            v_refund.vendor_order_id, v_refund.id, 'Luxora-funded discount recovered on refund');
  end if;
  v_loss := v_refund.amount_minor - v_refund.vendor_debit_minor - v_refund.commission_reversed_minor
            + v_refund.promotion_reversed_minor;
  if v_loss > 0 then
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, payment_id, refund_id, description)
    values ('refund_loss', -v_loss, v_refund.currency, v_refund.order_id, v_refund.vendor_order_id, v_refund.payment_id,
            v_refund.id, 'Refund borne by the platform (' || v_refund.kind || ')');
  end if;

  perform public.log_audit_event('refund.completed', 'refund', v_refund.id::text,
    jsonb_build_object('order_id', v_refund.order_id, 'amount_minor', v_refund.amount_minor, 'provider_refund_id', v_refund.provider_refund_id));
  return 'completed';
end;
$$;

-- -----------------------------------------------------------------------------
-- Restoring an expired order to the bag re-attaches its code (D14); it is
-- checked again like any other code.
-- -----------------------------------------------------------------------------
create or replace function public.restore_cart_from_order(p_order_id uuid)
returns table (restored integer, skipped integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid := public.require_active_customer();
  v_order    public.orders;
  v_item     record;
  v_restored integer := 0;
  v_skipped  integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> v_profile then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'cancelled' or v_order.payment_status not in ('cancelled', 'expired', 'failed') then
    raise exception 'Only unpaid orders that were cancelled or expired can be restored to your bag.';
  end if;
  if v_order.metadata ? 'cart_restored_at' then
    raise exception 'This order has already been restored to your bag.';
  end if;

  for v_item in
    select oi.variant_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = p_order_id and oi.variant_id is not null
     group by oi.variant_id
     order by min(oi.created_at), oi.variant_id
  loop
    begin
      -- Same rules as adding by hand: current price, availability, stock, currency.
      perform public.add_to_cart(v_item.variant_id, v_item.quantity);
      v_restored := v_restored + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;
  v_skipped := v_skipped + (select count(*)::integer from public.order_items oi where oi.order_id = p_order_id and oi.variant_id is null);

  if v_order.coupon_id is not null and v_restored > 0 then
    update public.carts set coupon_id = v_order.coupon_id
     where profile_id = v_profile and status = 'active';
  end if;

  update public.orders set metadata = metadata || jsonb_build_object('cart_restored_at', now()) where id = p_order_id;
  return query select v_restored, v_skipped;
end;
$$;

-- -----------------------------------------------------------------------------
-- Coupon management (vendor owners/managers for their coupons, admins for
-- platform coupons; admins can disable any coupon)
-- -----------------------------------------------------------------------------
create or replace function public.coupon_has_been_used_internal(p_coupon_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.coupon_usages u where u.coupon_id = p_coupon_id and u.status in ('reserved', 'redeemed'));
$$;

create or replace function public.can_manage_coupon_internal(p_scope public.coupon_scope, p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when p_scope = 'platform' then public.is_admin()
              else public.has_vendor_role(p_vendor_id, array['owner', 'manager']::public.vendor_member_role[]) end;
$$;

create or replace function public.save_coupon(
  p_coupon_id                uuid,
  p_vendor_id                uuid,                  -- null: a Luxora (platform) coupon
  p_code                     text,
  p_name                     text,
  p_description              text,
  p_discount_type            public.discount_type,
  p_discount_value           bigint,                -- percentage: basis points; fixed: minor units; free shipping: ignored
  p_min_subtotal_minor       bigint,
  p_max_discount_minor       bigint,
  p_usage_limit              integer,
  p_usage_limit_per_customer integer,
  p_starts_at                timestamptz,
  p_ends_at                  timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.coupons;
  v_scope    public.coupon_scope;
  v_vendor   uuid;
  v_code     text := upper(trim(coalesce(p_code, '')));
  v_value    bigint := coalesce(p_discount_value, 0);
  v_starts   timestamptz := coalesce(p_starts_at, now());
  v_id       uuid;
begin
  if p_coupon_id is not null then
    select * into v_existing from public.coupons where id = p_coupon_id for update;
    if not found or not public.can_manage_coupon_internal(v_existing.scope, v_existing.vendor_id) then
      raise exception 'Coupon not found.' using errcode = 'no_data_found';
    end if;
    v_scope := v_existing.scope;
    v_vendor := v_existing.vendor_id;
  else
    v_scope := case when p_vendor_id is null then 'platform'::public.coupon_scope else 'vendor'::public.coupon_scope end;
    v_vendor := p_vendor_id;
    if not public.can_manage_coupon_internal(v_scope, v_vendor) then
      raise exception 'You cannot create this coupon.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
    raise exception 'Use 3–32 letters, numbers, hyphens or underscores for the code.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Give the coupon a name (2–120 characters).';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'Keep the description under 500 characters.';
  end if;
  if p_discount_type = 'free_shipping' and v_scope = 'vendor' then
    raise exception 'Only Luxora can offer free-shipping codes.';
  end if;
  if p_discount_type = 'percentage' and v_value not between 1 and 10000 then
    raise exception 'Enter a percentage between 0.01%% and 100%%.';
  end if;
  if p_discount_type = 'fixed_amount' and v_value < 1 then
    raise exception 'Enter a discount amount greater than zero.';
  end if;
  if p_discount_type = 'free_shipping' then
    v_value := 0;
  end if;
  if p_max_discount_minor is not null and (p_discount_type <> 'percentage' or p_max_discount_minor < 1) then
    raise exception 'A maximum discount applies only to percentage codes and must be greater than zero.';
  end if;
  if coalesce(p_min_subtotal_minor, 0) < 0 then
    raise exception 'The minimum spend cannot be negative.';
  end if;
  if (p_usage_limit is not null and p_usage_limit < 1) or (p_usage_limit_per_customer is not null and p_usage_limit_per_customer < 1) then
    raise exception 'Usage limits must be at least 1 (or left empty for no limit).';
  end if;
  if p_ends_at is not null and p_ends_at <= v_starts then
    raise exception 'The end date must be after the start date.';
  end if;

  if v_existing.id is not null then
    -- D11: once used, the code and the discount itself can no longer change.
    if public.coupon_has_been_used_internal(v_existing.id)
       and (v_existing.code::text <> v_code or v_existing.discount_type <> p_discount_type or v_existing.discount_value <> v_value) then
      raise exception 'This code has been used, so its code and discount can no longer change.';
    end if;
    begin
      update public.coupons
         set code = v_code, name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
             discount_type = p_discount_type, discount_value = v_value,
             min_subtotal_minor = coalesce(p_min_subtotal_minor, 0), max_discount_minor = p_max_discount_minor,
             usage_limit = p_usage_limit, usage_limit_per_customer = p_usage_limit_per_customer,
             starts_at = v_starts, ends_at = p_ends_at
       where id = v_existing.id;
    exception when unique_violation then
      raise exception 'That code is already taken. Choose another.';
    end;
    v_id := v_existing.id;
    perform public.log_audit_event('coupon.updated', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'scope', v_scope, 'vendor_id', v_vendor));
  else
    begin
      insert into public.coupons (code, scope, vendor_id, name, description, discount_type, discount_value,
                                  min_subtotal_minor, max_discount_minor, usage_limit, usage_limit_per_customer,
                                  starts_at, ends_at, is_active, created_by)
      values (v_code, v_scope, v_vendor, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_discount_type, v_value,
              coalesce(p_min_subtotal_minor, 0), p_max_discount_minor, p_usage_limit, p_usage_limit_per_customer,
              v_starts, p_ends_at, true, public.current_profile_id())
      returning id into v_id;
    exception when unique_violation then
      raise exception 'That code is already taken. Choose another.';
    end;
    perform public.log_audit_event('coupon.created', 'coupon', v_id::text,
      jsonb_build_object('code', v_code, 'scope', v_scope, 'vendor_id', v_vendor, 'discount_type', p_discount_type,
                         'discount_value', v_value));
  end if;
  return v_id;
end;
$$;

create or replace function public.set_coupon_active(p_coupon_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons;
begin
  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found or not public.can_manage_coupon_internal(v_coupon.scope, v_coupon.vendor_id) then
    raise exception 'Coupon not found.' using errcode = 'no_data_found';
  end if;
  if p_active and v_coupon.disabled_by_admin_at is not null then
    raise exception 'Luxora has disabled this code: %', v_coupon.disabled_reason;
  end if;
  if v_coupon.is_active = p_active then
    return;
  end if;
  update public.coupons set is_active = p_active where id = v_coupon.id;
  perform public.log_audit_event(case when p_active then 'coupon.resumed' else 'coupon.paused' end, 'coupon', v_coupon.id::text,
    jsonb_build_object('code', v_coupon.code, 'scope', v_coupon.scope, 'vendor_id', v_coupon.vendor_id));
end;
$$;

create or replace function public.admin_set_coupon_disabled(p_coupon_id uuid, p_disabled boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons;
begin
  if not public.is_admin() then
    raise exception 'only administrators can disable coupons' using errcode = 'insufficient_privilege';
  end if;
  select * into v_coupon from public.coupons where id = p_coupon_id for update;
  if not found then
    raise exception 'Coupon not found.' using errcode = 'no_data_found';
  end if;
  if p_disabled then
    if char_length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Give a reason (at least 3 characters).';
    end if;
    update public.coupons
       set disabled_by_admin_at = now(), disabled_by = public.current_profile_id(), disabled_reason = left(trim(p_reason), 500)
     where id = v_coupon.id;
  else
    if v_coupon.disabled_by_admin_at is null then
      raise exception 'This code is not disabled.';
    end if;
    update public.coupons set disabled_by_admin_at = null, disabled_by = null, disabled_reason = null where id = v_coupon.id;
  end if;
  perform public.log_audit_event(case when p_disabled then 'coupon.disabled_by_admin' else 'coupon.enabled_by_admin' end,
    'coupon', v_coupon.id::text,
    jsonb_build_object('code', v_coupon.code, 'scope', v_coupon.scope, 'vendor_id', v_coupon.vendor_id, 'reason', p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- Flash sales (vendor owners/managers; admins can disable)
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_flash_sale_internal(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_vendor_role(p_vendor_id, array['owner', 'manager']::public.vendor_member_role[]);
$$;

-- D10: a variant cannot be in two sales whose windows overlap.
create or replace function public.flash_sale_overlap_internal(p_sale_id uuid, p_variant_id uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.flash_sale_items fi
      join public.flash_sales fs on fs.id = fi.flash_sale_id
     where fi.variant_id = p_variant_id
       and fs.id <> p_sale_id
       and fs.status in ('scheduled', 'active')
       and fs.disabled_by_admin_at is null
       and fs.starts_at < p_ends and fs.ends_at > p_starts
  );
$$;

create or replace function public.save_flash_sale(
  p_sale_id     uuid,
  p_vendor_id   uuid,
  p_name        text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.flash_sales;
  v_id   uuid;
  v_clash text;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Give the sale a name (2–120 characters).';
  end if;
  if p_description is not null and char_length(p_description) > 500 then
    raise exception 'Keep the description under 500 characters.';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'The sale must end after it starts.';
  end if;

  if p_sale_id is null then
    if not public.can_manage_flash_sale_internal(p_vendor_id) then
      raise exception 'You cannot create flash sales for this vendor.' using errcode = 'insufficient_privilege';
    end if;
    if p_ends_at <= now() then
      raise exception 'The sale must end in the future.';
    end if;
    insert into public.flash_sales (vendor_id, name, description, starts_at, ends_at, status, created_by)
    values (p_vendor_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at, 'scheduled',
            public.current_profile_id())
    returning id into v_id;
    perform public.log_audit_event('flash_sale.created', 'flash_sale', v_id::text,
      jsonb_build_object('vendor_id', p_vendor_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
    return v_id;
  end if;

  select * into v_sale from public.flash_sales where id = p_sale_id for update;
  if not found or not public.can_manage_flash_sale_internal(v_sale.vendor_id) then
    raise exception 'Flash sale not found.' using errcode = 'no_data_found';
  end if;
  if v_sale.status not in ('scheduled', 'active') or v_sale.disabled_by_admin_at is not null or v_sale.ends_at <= now() then
    raise exception 'This flash sale has ended.';
  end if;
  if (p_starts_at is distinct from v_sale.starts_at or p_ends_at is distinct from v_sale.ends_at) then
    if v_sale.starts_at <= now() then
      raise exception 'The sale has started, so its dates can no longer change. You can end it early.';
    end if;
    if p_ends_at <= now() then
      raise exception 'The sale must end in the future.';
    end if;
    select pv.sku into v_clash
      from public.flash_sale_items fi join public.product_variants pv on pv.id = fi.variant_id
     where fi.flash_sale_id = v_sale.id and public.flash_sale_overlap_internal(v_sale.id, fi.variant_id, p_starts_at, p_ends_at)
     limit 1;
    if v_clash is not null then
      raise exception 'SKU % is in another flash sale at the same time.', v_clash;
    end if;
  end if;
  update public.flash_sales
     set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''),
         starts_at = p_starts_at, ends_at = p_ends_at
   where id = v_sale.id;
  perform public.log_audit_event('flash_sale.updated', 'flash_sale', v_sale.id::text,
    jsonb_build_object('vendor_id', v_sale.vendor_id, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  return v_sale.id;
end;
$$;

-- Replaces the sale's items: [{"variant_id": uuid, "sale_price_minor": int, "quantity_limit": int|null}, …].
-- Only before the sale starts, or once for a sale that started empty (D11).
create or replace function public.set_flash_sale_items(p_sale_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale  public.flash_sales;
  v_req   record;
  v_var   record;
  v_count integer := 0;
begin
  select * into v_sale from public.flash_sales where id = p_sale_id for update;
  if not found or not public.can_manage_flash_sale_internal(v_sale.vendor_id) then
    raise exception 'Flash sale not found.' using errcode = 'no_data_found';
  end if;
  if v_sale.status not in ('scheduled', 'active') or v_sale.disabled_by_admin_at is not null or v_sale.ends_at <= now() then
    raise exception 'This flash sale has ended.';
  end if;
  -- An empty sale (e.g. one starting now) can be filled once; after that the
  -- items and prices shoppers have seen no longer change.
  if v_sale.starts_at <= now() and exists (select 1 from public.flash_sale_items where flash_sale_id = v_sale.id) then
    raise exception 'The sale has started, so its items and prices can no longer change. You can end it early.';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200 then
    raise exception 'A flash sale can have at most 200 items.';
  end if;

  delete from public.flash_sale_items where flash_sale_id = v_sale.id;
  for v_req in
    select (e ->> 'variant_id')::uuid as variant_id,
           (e ->> 'sale_price_minor')::bigint as sale_price,
           nullif(e ->> 'quantity_limit', '')::integer as quantity_limit
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
  loop
    select pv.id, pv.sku, pv.price_minor, p.name into v_var
      from public.product_variants pv join public.products p on p.id = pv.product_id
     where pv.id = v_req.variant_id and p.vendor_id = v_sale.vendor_id;
    if not found then
      raise exception 'A product in this sale does not belong to your store.';
    end if;
    if v_req.sale_price is null or v_req.sale_price < 1 or v_req.sale_price >= v_var.price_minor then
      raise exception 'The sale price of "%" (%) must be lower than its regular price.', v_var.name, v_var.sku;
    end if;
    if v_req.quantity_limit is not null and v_req.quantity_limit not between 1 and 100000 then
      raise exception 'The unit limit for "%" must be between 1 and 100000 (or empty for no limit).', v_var.name;
    end if;
    if public.flash_sale_overlap_internal(v_sale.id, v_var.id, v_sale.starts_at, v_sale.ends_at) then
      raise exception '"%" (%) is in another flash sale at the same time.', v_var.name, v_var.sku;
    end if;
    begin
      insert into public.flash_sale_items (flash_sale_id, variant_id, sale_price_minor, quantity_limit)
      values (v_sale.id, v_var.id, v_req.sale_price, v_req.quantity_limit);
    exception when unique_violation then
      raise exception '"%" (%) is listed twice.', v_var.name, v_var.sku;
    end;
    v_count := v_count + 1;
  end loop;

  perform public.log_audit_event('flash_sale.updated', 'flash_sale', v_sale.id::text,
    jsonb_build_object('vendor_id', v_sale.vendor_id, 'items', v_count));
  return v_count;
end;
$$;

-- Ends a live sale now, or cancels one that has not started.
create or replace function public.end_flash_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.flash_sales;
begin
  select * into v_sale from public.flash_sales where id = p_sale_id for update;
  if not found or not public.can_manage_flash_sale_internal(v_sale.vendor_id) then
    raise exception 'Flash sale not found.' using errcode = 'no_data_found';
  end if;
  if v_sale.status not in ('scheduled', 'active') or v_sale.disabled_by_admin_at is not null or v_sale.ends_at <= now() then
    raise exception 'This flash sale has already ended.';
  end if;
  if v_sale.starts_at > now() then
    update public.flash_sales set status = 'cancelled' where id = v_sale.id;
  else
    update public.flash_sales set status = 'ended', ends_at = now() where id = v_sale.id;
  end if;
  perform public.log_audit_event('flash_sale.ended', 'flash_sale', v_sale.id::text,
    jsonb_build_object('vendor_id', v_sale.vendor_id, 'before_start', v_sale.starts_at > now()));
end;
$$;

create or replace function public.admin_disable_flash_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.flash_sales;
begin
  if not public.is_admin() then
    raise exception 'only administrators can disable flash sales' using errcode = 'insufficient_privilege';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason (at least 3 characters).';
  end if;
  select * into v_sale from public.flash_sales where id = p_sale_id for update;
  if not found then
    raise exception 'Flash sale not found.' using errcode = 'no_data_found';
  end if;
  if v_sale.disabled_by_admin_at is not null then
    raise exception 'This flash sale is already disabled.';
  end if;
  update public.flash_sales
     set status = 'cancelled', disabled_by_admin_at = now(), disabled_by = public.current_profile_id(),
         disabled_reason = left(trim(p_reason), 500)
   where id = v_sale.id;
  perform public.log_audit_event('flash_sale.disabled_by_admin', 'flash_sale', v_sale.id::text,
    jsonb_build_object('vendor_id', v_sale.vendor_id, 'reason', p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- Public catalog views: flash-sale prices (appended columns)
-- -----------------------------------------------------------------------------
create or replace view public.product_variant_availability as
select
  pv.id         as variant_id,
  pv.product_id,
  pv.sku,
  pv.title,
  pv.options,
  pv.price_minor,
  pv.compare_at_price_minor,
  pv.position,
  pv.is_default,
  coalesce(not i.track_inventory or i.allow_backorder or i.available_quantity > 0, false) as in_stock,
  coalesce(i.track_inventory and not i.allow_backorder and i.available_quantity <= i.low_stock_threshold, false) as is_low_stock,
  least(fs.sale_price_minor, pv.price_minor) as sale_price_minor,
  fs.ends_at as sale_ends_at,
  coalesce(fs.quantity_limit is not null, false) as sale_limited
from public.product_variants pv
join public.products p on p.id = pv.product_id and p.status = 'active'
join public.vendors v on v.id = p.vendor_id and v.status = 'approved'
left join public.inventory i on i.variant_id = pv.id
left join lateral (
  select lf.sale_price_minor, lf.ends_at, lf.quantity_limit
    from public.live_flash_sale_items lf
   where lf.variant_id = pv.id and lf.vendor_id = p.vendor_id and (lf.remaining is null or lf.remaining > 0)
   limit 1
) fs on true
where pv.is_active;

create or replace view public.product_listings as
select
  p.id,
  p.slug,
  p.name,
  p.short_description,
  p.currency,
  p.vendor_id,
  p.category_id,
  p.brand_id,
  p.tags,
  p.published_at,
  p.created_at,
  s.slug           as store_slug,
  s.name           as store_name,
  b.slug           as brand_slug,
  b.name           as brand_name,
  c.slug           as category_slug,
  c.name           as category_name,
  pr.min_price_minor,
  pr.max_price_minor,
  pr.compare_at_price_minor,
  img.storage_path as primary_image_path,
  img.alt_text     as primary_image_alt,
  coalesce(inv.in_stock, false) as in_stock,
  p.search_vector,
  coalesce(rs.review_count, 0) as review_count,
  coalesce(rs.rating_sum, 0)   as rating_sum,
  fl.flash_min_price_minor,
  fl.flash_sale_ends_at
from public.products p
join public.vendors v on v.id = p.vendor_id and v.status = 'approved'
left join public.stores s on s.vendor_id = v.id and s.status = 'published'
left join public.brands b on b.id = p.brand_id and b.is_active
left join public.categories c on c.id = p.category_id and c.is_active
join lateral (
  select min(pv.price_minor) as min_price_minor,
         max(pv.price_minor) as max_price_minor,
         max(pv.compare_at_price_minor) as compare_at_price_minor
  from public.product_variants pv
  where pv.product_id = p.id and pv.is_active
) pr on pr.min_price_minor is not null
left join lateral (
  select pi.storage_path, pi.alt_text
  from public.product_images pi
  where pi.product_id = p.id
  order by pi.is_primary desc, pi.position asc
  limit 1
) img on true
left join lateral (
  select bool_or(not i.track_inventory or i.allow_backorder or i.available_quantity > 0) as in_stock
  from public.inventory i
  join public.product_variants pv on pv.id = i.variant_id
  where pv.product_id = p.id and pv.is_active
) inv on true
left join public.product_review_stats rs on rs.product_id = p.id
left join lateral (
  -- Lowest price among variants on a live flash sale with units left (null when none).
  select min(least(lf.sale_price_minor, pv.price_minor)) as flash_min_price_minor,
         min(lf.ends_at) as flash_sale_ends_at
    from public.live_flash_sale_items lf
    join public.product_variants pv on pv.id = lf.variant_id and pv.is_active
   where pv.product_id = p.id and lf.vendor_id = p.vendor_id and (lf.remaining is null or lf.remaining > 0)
) fl on true
where p.status = 'active';

comment on view public.product_listings is
  'Public catalog: active products of approved vendors with price range, primary image, stock flag, approved-review totals and live flash-sale price.';

-- -----------------------------------------------------------------------------
-- RLS: promotions are written only through the functions above
-- -----------------------------------------------------------------------------
drop policy coupons_vendor_all on public.coupons;
drop policy coupons_admin_all on public.coupons;
create policy coupons_select_vendor on public.coupons
  for select to authenticated using (scope = 'vendor' and (select public.is_vendor_member(vendor_id)));
create policy coupons_select_admin on public.coupons
  for select to authenticated using ((select public.is_admin()));

drop policy flash_sales_select_public on public.flash_sales;
drop policy flash_sales_vendor_all on public.flash_sales;
drop policy flash_sales_admin_all on public.flash_sales;
create policy flash_sales_select_public on public.flash_sales
  for select to anon, authenticated
  using (status in ('scheduled', 'active') and disabled_by_admin_at is null and starts_at <= now() and ends_at > now());
create policy flash_sales_select_vendor on public.flash_sales
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy flash_sales_select_admin on public.flash_sales
  for select to authenticated using ((select public.is_admin()));

drop policy flash_sale_items_vendor_all on public.flash_sale_items;
drop policy flash_sale_items_admin_all on public.flash_sale_items;
create policy flash_sale_items_select_vendor on public.flash_sale_items
  for select to authenticated using ((select public.is_vendor_member((select public.flash_sale_vendor_id(flash_sale_id)))));
create policy flash_sale_items_select_admin on public.flash_sale_items
  for select to authenticated using ((select public.is_admin()));

alter table public.coupon_code_attempts enable row level security;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke insert, update, delete on public.coupons, public.coupon_usages, public.flash_sales, public.flash_sale_items
  from anon, authenticated;
revoke all on public.coupon_code_attempts from anon, authenticated;
grant all on public.coupon_code_attempts to service_role;
revoke all on public.live_flash_sale_items from anon, authenticated;

revoke all on function public.cart_lines() from public, anon;
grant execute on function public.cart_lines() to authenticated, service_role;

revoke all on function
  public.allocate_minor_internal(bigint, bigint[]),
  public.format_money_internal(bigint, text),
  public.cart_coupon_allocation_internal(uuid, text),
  public.coupon_has_been_used_internal(uuid),
  public.can_manage_coupon_internal(public.coupon_scope, uuid),
  public.can_manage_flash_sale_internal(uuid),
  public.flash_sale_overlap_internal(uuid, uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;

revoke all on function
  public.apply_cart_coupon(text),
  public.remove_cart_coupon(),
  public.cart_promotion_quote(uuid),
  public.save_coupon(uuid, uuid, text, text, text, public.discount_type, bigint, bigint, bigint, integer, integer, timestamptz, timestamptz),
  public.set_coupon_active(uuid, boolean),
  public.admin_set_coupon_disabled(uuid, boolean, text),
  public.save_flash_sale(uuid, uuid, text, text, timestamptz, timestamptz),
  public.set_flash_sale_items(uuid, jsonb),
  public.end_flash_sale(uuid),
  public.admin_disable_flash_sale(uuid, text)
from public, anon;

grant execute on function
  public.apply_cart_coupon(text),
  public.remove_cart_coupon(),
  public.cart_promotion_quote(uuid),
  public.save_coupon(uuid, uuid, text, text, text, public.discount_type, bigint, bigint, bigint, integer, integer, timestamptz, timestamptz),
  public.set_coupon_active(uuid, boolean),
  public.admin_set_coupon_disabled(uuid, boolean, text),
  public.save_flash_sale(uuid, uuid, text, text, timestamptz, timestamptz),
  public.set_flash_sale_items(uuid, jsonb),
  public.end_flash_sale(uuid),
  public.admin_disable_flash_sale(uuid, text)
to authenticated, service_role;
