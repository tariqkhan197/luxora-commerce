-- =============================================================================
-- Migration 0015 (Release 4a): shipping zones, vendor shipping rates and
-- shipping in checkout.
-- -----------------------------------------------------------------------------
--   * Admins define zones and the countries in them. A country in no active
--     zone is not shipped to: the zone list is the list of countries Luxora
--     sells to. Nothing is seeded here; production starts with no zones.
--   * Each vendor sets, per zone: first item, each additional item, an
--     optional free-shipping threshold and a delivery estimate (USD minor units).
--   * Shipping is computed only in the database, per vendor order:
--       0                                   if no line needs shipping
--       0                                   if vendor subtotal >= threshold
--       first + additional * (qty - 1)      otherwise (qty = shipped units)
--   * Commission stays on merchandise only; shipping is part of the vendor
--     order total and therefore of vendor earnings.
--   * Tax stays at zero in Release 4a (Stripe Tax arrives in Release 4b).
-- =============================================================================

create table public.shipping_zones (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(trim(name)) between 2 and 80),
  description  text check (description is null or char_length(description) <= 300),
  position     integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index shipping_zones_name_key on public.shipping_zones (lower(name));

create trigger shipping_zones_set_updated_at
  before update on public.shipping_zones
  for each row execute function public.set_updated_at();

-- A country belongs to at most one zone.
create table public.shipping_zone_countries (
  country_code char(2) primary key check (country_code ~ '^[A-Z]{2}$'),
  zone_id      uuid not null references public.shipping_zones (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index shipping_zone_countries_zone_idx on public.shipping_zone_countries (zone_id);

create table public.vendor_shipping_rates (
  id                            uuid primary key default gen_random_uuid(),
  vendor_id                     uuid not null references public.vendors (id) on delete cascade,
  zone_id                       uuid not null references public.shipping_zones (id) on delete cascade,
  currency                      public.currency_code not null default 'USD',
  first_item_minor              public.money_minor not null,
  additional_item_minor         public.money_minor not null default 0,
  free_shipping_threshold_minor public.money_minor,
  min_delivery_days             integer check (min_delivery_days is null or min_delivery_days between 0 and 120),
  max_delivery_days             integer check (max_delivery_days is null or max_delivery_days between 0 and 120),
  is_active                     boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (vendor_id, zone_id),
  constraint vendor_shipping_rates_delivery_window check (
    min_delivery_days is null or max_delivery_days is null or max_delivery_days >= min_delivery_days
  )
);

create index vendor_shipping_rates_zone_idx on public.vendor_shipping_rates (zone_id) where is_active;

create trigger vendor_shipping_rates_set_updated_at
  before update on public.vendor_shipping_rates
  for each row execute function public.set_updated_at();

-- Zones that vendors ship to cannot be deleted, only deactivated.
create or replace function public.prevent_delete_used_shipping_zone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.vendor_shipping_rates r where r.zone_id = old.id) then
    raise exception 'Vendors have shipping rates for this zone. Deactivate it instead of deleting it.';
  end if;
  return old;
end;
$$;

create trigger shipping_zones_prevent_delete_used
  before delete on public.shipping_zones
  for each row execute function public.prevent_delete_used_shipping_zone();

-- -----------------------------------------------------------------------------
-- Admin: save a zone and its country list atomically, with an audit entry.
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_shipping_zone(
  p_name        text,
  p_countries   text[],
  p_is_active   boolean default true,
  p_position    integer default 0,
  p_description text    default null,
  p_zone_id     uuid    default null   -- null creates a new zone
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid := p_zone_id;
  v_countries text[];
  v_taken     text;
begin
  if not public.is_admin() then
    raise exception 'only administrators can manage shipping zones' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(array_agg(distinct upper(trim(c))), '{}') into v_countries from unnest(coalesce(p_countries, '{}')) c;
  if exists (select 1 from unnest(v_countries) c where c !~ '^[A-Z]{2}$') then
    raise exception 'Countries must be 2-letter ISO codes.';
  end if;
  if exists (select 1 from public.shipping_zones z where lower(z.name) = lower(trim(p_name)) and z.id is distinct from v_id) then
    raise exception 'A zone named "%" already exists.', trim(p_name);
  end if;

  if v_id is null then
    insert into public.shipping_zones (name, description, position, is_active)
    values (trim(p_name), nullif(trim(p_description), ''), coalesce(p_position, 0), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.shipping_zones
       set name = trim(p_name), description = nullif(trim(p_description), ''),
           position = coalesce(p_position, 0), is_active = coalesce(p_is_active, true)
     where id = v_id;
    if not found then
      raise exception 'Shipping zone not found.' using errcode = 'no_data_found';
    end if;
  end if;

  select string_agg(zc.country_code, ', ' order by zc.country_code) into v_taken
    from public.shipping_zone_countries zc
   where zc.country_code = any (v_countries) and zc.zone_id <> v_id;
  if v_taken is not null then
    raise exception 'Already in another zone: %. Remove them from that zone first.', v_taken;
  end if;

  delete from public.shipping_zone_countries where zone_id = v_id and country_code <> all (v_countries);
  insert into public.shipping_zone_countries (country_code, zone_id)
  select c, v_id from unnest(v_countries) c
  on conflict (country_code) do nothing;

  perform public.log_audit_event('shipping_zone.saved', 'shipping_zone', v_id::text,
    jsonb_build_object('name', trim(p_name), 'countries', to_jsonb(v_countries), 'is_active', coalesce(p_is_active, true)));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Stores cannot be published by a vendor until they ship to at least one zone.
-- -----------------------------------------------------------------------------
create or replace function public.require_shipping_before_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then
    return new;
  end if;
  if public.is_privileged_session() or public.in_trusted_context() then
    return new;
  end if;
  if not exists (
    select 1 from public.vendor_shipping_rates r
      join public.shipping_zones z on z.id = r.zone_id
     where r.vendor_id = new.vendor_id and r.is_active and z.is_active
  ) then
    raise exception 'Set up shipping for at least one zone before publishing your store.';
  end if;
  return new;
end;
$$;

create trigger stores_require_shipping_before_publish
  before insert or update of status on public.stores
  for each row execute function public.require_shipping_before_publish();

-- -----------------------------------------------------------------------------
-- Shipping calculation (internal; called from SECURITY DEFINER functions only)
-- -----------------------------------------------------------------------------
create or replace function public.shipping_zone_for_country(p_country text)
returns uuid
language sql
stable
set search_path = public
as $$
  select zc.zone_id
    from public.shipping_zone_countries zc
    join public.shipping_zones z on z.id = zc.zone_id and z.is_active
   where zc.country_code = upper(p_country);
$$;

-- Shipping for the caller's active cart, per vendor, to a destination country.
create or replace function public.cart_shipping_for_country(p_country text)
returns table (
  vendor_id         uuid,
  vendor_name       text,
  zone_name         text,
  shippable         boolean,
  shipping_minor    bigint,
  min_delivery_days integer,
  max_delivery_days integer,
  reason            text
)
language sql
stable
set search_path = public
as $$
  with lines as (
    select l.vendor_id, l.vendor_name, l.currency, l.line_total_minor, l.quantity, p.requires_shipping
      from public.cart_lines() l
      join public.products p on p.id = l.product_id
  ), per_vendor as (
    select ln.vendor_id,
           min(ln.vendor_name) as vendor_name,
           min(ln.currency) as currency,
           sum(ln.line_total_minor)::bigint as subtotal,
           sum(case when ln.requires_shipping then ln.quantity else 0 end)::integer as shipped_units
      from lines ln
     group by ln.vendor_id
  ), zone as (
    select public.shipping_zone_for_country(p_country) as zone_id
  )
  select
    v.vendor_id,
    v.vendor_name,
    zn.name,
    (v.shipped_units = 0 or r.id is not null),
    case
      when v.shipped_units = 0 or r.id is null then 0
      when r.free_shipping_threshold_minor is not null and v.subtotal >= r.free_shipping_threshold_minor then 0
      else (r.first_item_minor + r.additional_item_minor * (v.shipped_units - 1))::bigint
    end,
    r.min_delivery_days,
    r.max_delivery_days,
    case
      when v.shipped_units = 0 then null
      when z.zone_id is null then 'country_not_served'
      when r.id is null then 'vendor_does_not_ship'
    end
  from per_vendor v
  cross join zone z
  left join public.shipping_zones zn on zn.id = z.zone_id
  left join public.vendor_shipping_rates r
         on r.vendor_id = v.vendor_id and r.zone_id = z.zone_id and r.is_active and r.currency::text = v.currency
  order by v.vendor_name, v.vendor_id;
$$;

-- Checkout: shipping per vendor for one of the caller's own shipping addresses.
create or replace function public.checkout_shipping_quote(p_address_id uuid)
returns table (
  vendor_id         uuid,
  vendor_name       text,
  zone_name         text,
  shippable         boolean,
  shipping_minor    bigint,
  min_delivery_days integer,
  max_delivery_days integer,
  reason            text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_address public.addresses;
begin
  select * into v_address from public.addresses where id = p_address_id and profile_id = v_profile;
  if not found or v_address.type = 'billing' then
    raise exception 'Choose a valid shipping address.';
  end if;
  return query select * from public.cart_shipping_for_country(v_address.country_code);
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.shipping_zones enable row level security;
alter table public.shipping_zone_countries enable row level security;
alter table public.vendor_shipping_rates enable row level security;

create policy shipping_zones_select_public on public.shipping_zones
  for select to anon, authenticated using (is_active);
create policy shipping_zones_admin_all on public.shipping_zones
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy shipping_zone_countries_select_public on public.shipping_zone_countries
  for select to anon, authenticated
  using (exists (select 1 from public.shipping_zones z where z.id = shipping_zone_countries.zone_id and z.is_active));
create policy shipping_zone_countries_admin_all on public.shipping_zone_countries
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Rates are read by the vendor's team and admins; customers only ever see the
-- computed shipping returned by the checkout functions.
create policy vendor_shipping_rates_select_member on public.vendor_shipping_rates
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy vendor_shipping_rates_manage_manager on public.vendor_shipping_rates
  for all to authenticated
  using ((select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])))
  with check ((select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])));
create policy vendor_shipping_rates_admin_all on public.vendor_shipping_rates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

grant select on public.shipping_zones, public.shipping_zone_countries to anon;
grant select, insert, update, delete on public.shipping_zones, public.shipping_zone_countries, public.vendor_shipping_rates to authenticated;
grant all on public.shipping_zones, public.shipping_zone_countries, public.vendor_shipping_rates to service_role;

grant execute on function
  public.admin_save_shipping_zone(text, text[], boolean, integer, text, uuid),
  public.checkout_shipping_quote(uuid)
to authenticated;
grant execute on function public.admin_save_shipping_zone(text, text[], boolean, integer, text, uuid) to service_role;

revoke all on function
  public.shipping_zone_for_country(text),
  public.cart_shipping_for_country(text)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Checkout: place_order() now charges shipping per vendor order.
-- Same signature and behaviour as Phase 3 apart from the shipping changes,
-- which are marked "Release 4a" below.
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

  select coalesce(sum(l.line_total_minor), 0) into v_subtotal from public.cart_lines() l;
  select coalesce(sum(q.shipping_minor), 0) into v_shipping from public.cart_shipping_for_country(v_ship.country_code) q;
  if p_expected_total_minor is not null and p_expected_total_minor <> v_subtotal + v_shipping then
    raise exception 'Prices or shipping costs have changed. Please review your order and try again.';
  end if;

  -- Lock inventory rows in a global order (variant id) to avoid deadlocks, then
  -- verify and reserve. Concurrent checkouts for the same stock serialise here.
  perform 1 from public.inventory i
    where i.variant_id in (select ci.variant_id from public.cart_items ci where ci.cart_id = v_cart.id)
    order by i.variant_id
    for update;

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
    customer_id, currency, subtotal_minor, shipping_minor, total_minor, customer_email, customer_note,
    shipping_address, billing_address, checkout_token, reservation_expires_at
  ) values (
    v_profile, v_cart.currency, v_subtotal, v_shipping, v_subtotal + v_shipping, v_email, nullif(trim(p_customer_note), ''),
    public.address_snapshot(v_ship), public.address_snapshot(v_bill), p_checkout_token,
    now() + make_interval(mins => v_minutes)
  ) returning id, order_number into v_order_id, v_order_number;

  -- One vendor order per vendor. Commission per line uses that line's category.
  for v_vendor in
    select l.vendor_id,
           sum(l.line_total_minor)::bigint as subtotal,
           sum(public.calculate_commission_minor(l.line_total_minor,
               public.resolve_commission_rate_bps(l.vendor_id, p.category_id)))::bigint as commission
      from public.cart_lines() l
      join public.products p on p.id = l.product_id
     group by l.vendor_id
     order by l.vendor_id
  loop
    v_index := v_index + 1;
    select coalesce(sum(q.shipping_minor), 0) into v_vendor_ship
      from public.cart_shipping_for_country(v_ship.country_code) q
     where q.vendor_id = v_vendor.vendor_id;
    insert into public.vendor_orders (
      order_id, vendor_id, vendor_order_number, currency, subtotal_minor, shipping_minor, total_minor,
      commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor, shipping_address
    ) values (
      v_order_id, v_vendor.vendor_id, v_order_number || '-' || lpad(v_index::text, 2, '0'), v_cart.currency,
      v_vendor.subtotal, v_vendor_ship, v_vendor.subtotal + v_vendor_ship,
      -- effective (blended) rate for reporting; per-line rates are on order_items
      case when v_vendor.subtotal > 0
           then least(10000, (v_vendor.commission * 10000 + v_vendor.subtotal / 2) / v_vendor.subtotal)::integer
           else 0 end,
      -- commission is on merchandise only; shipping is passed through to the vendor
      v_vendor.commission, 0, v_vendor.subtotal + v_vendor_ship - v_vendor.commission, public.address_snapshot(v_ship)
    ) returning id into v_vo_id;

    insert into public.order_items (
      order_id, vendor_order_id, vendor_id, product_id, variant_id, product_name, variant_title, sku,
      image_path, quantity, unit_price_minor, total_minor, commission_rate_bps, commission_minor
    )
    select v_order_id, v_vo_id, l.vendor_id, l.product_id, l.variant_id, l.product_name, l.variant_title, l.sku,
           l.image_path, l.quantity, l.unit_price_minor, l.line_total_minor, r.rate,
           public.calculate_commission_minor(l.line_total_minor, r.rate)
      from public.cart_lines() l
      join public.products p on p.id = l.product_id
      cross join lateral (select public.resolve_commission_rate_bps(l.vendor_id, p.category_id) as rate) r
     where l.vendor_id = v_vendor.vendor_id;
  end loop;

  update public.carts set status = 'converted' where id = v_cart.id;
  return v_order_id;
end;
$$;
