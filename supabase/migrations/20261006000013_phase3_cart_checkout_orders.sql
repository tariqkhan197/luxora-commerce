-- =============================================================================
-- Migration 0013 (Phase 3): cart, checkout, inventory reservation, orders and
-- the payment-confirmation boundary.
-- -----------------------------------------------------------------------------
-- Principles
--   * Prices, totals, commissions and stock are computed ONLY inside database
--     functions from database rows. The browser sends variant ids, quantities,
--     address ids and an idempotency token — never money.
--   * Customer-facing business rules raise SQLSTATE P0001 with a message that
--     is safe to show; authorization failures raise 42501.
--   * Every multi-row change (checkout, cancellation, expiry, payment
--     confirmation) is a single SECURITY DEFINER function, i.e. one transaction.
--   * Order financial snapshots are immutable outside those trusted functions.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('checkout.reservation_minutes', '30', 'Minutes that stock stays reserved for an unpaid checkout before it is released.', false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Trusted-context detection
-- -----------------------------------------------------------------------------
-- Statements executed inside a SECURITY DEFINER function run as the function
-- owner, so `current_user` is not an API role there. This helper is SECURITY
-- INVOKER on purpose: called from a trigger it reports who is really writing.
create or replace function public.in_trusted_context()
returns boolean
language sql
stable
as $$
  select current_user not in ('anon', 'authenticated', 'service_role');
$$;

-- -----------------------------------------------------------------------------
-- Internal stock helpers (no grants: callable only from definer functions).
-- The Phase 1 public functions keep their privilege checks and delegate here,
-- so checkout and the platform share exactly one implementation.
-- -----------------------------------------------------------------------------
create or replace function public.inventory_reserve_internal(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'reservation quantity must be positive' using errcode = 'check_violation';
  end if;
  select * into v_inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    raise exception 'no inventory record for variant %', p_variant_id using errcode = 'no_data_found';
  end if;
  if v_inv.track_inventory and not v_inv.allow_backorder
     and v_inv.stock_quantity - v_inv.reserved_quantity < p_quantity then
    raise exception 'insufficient available stock: available %, requested %',
      v_inv.stock_quantity - v_inv.reserved_quantity, p_quantity using errcode = 'check_violation';
  end if;
  update public.inventory set reserved_quantity = reserved_quantity + p_quantity
   where id = v_inv.id returning * into v_inv;
  return v_inv;
end;
$$;

create or replace function public.inventory_release_internal(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'release quantity must be positive' using errcode = 'check_violation';
  end if;
  select * into v_inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    raise exception 'no inventory record for variant %', p_variant_id using errcode = 'no_data_found';
  end if;
  update public.inventory set reserved_quantity = greatest(reserved_quantity - p_quantity, 0)
   where id = v_inv.id returning * into v_inv;
  return v_inv;
end;
$$;

create or replace function public.inventory_commit_internal(p_variant_id uuid, p_quantity integer, p_reference_id uuid)
returns public.inventory
language plpgsql
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;
  select * into v_inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    raise exception 'no inventory record for variant %', p_variant_id using errcode = 'no_data_found';
  end if;
  if v_inv.reserved_quantity < p_quantity then
    raise exception 'cannot commit % units: only % reserved', p_quantity, v_inv.reserved_quantity
      using errcode = 'check_violation';
  end if;
  update public.inventory
     set stock_quantity = stock_quantity - p_quantity, reserved_quantity = reserved_quantity - p_quantity
   where id = v_inv.id returning * into v_inv;
  insert into public.inventory_movements
    (inventory_id, type, quantity_delta, quantity_after, reference_type, reference_id, created_by)
  values
    (v_inv.id, 'sale', -p_quantity, v_inv.stock_quantity, 'order', p_reference_id, public.current_profile_id());
  return v_inv;
end;
$$;

create or replace function public.reserve_inventory(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'reservation quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'reservations are performed by the platform' using errcode = 'insufficient_privilege';
  end if;
  return public.inventory_reserve_internal(p_variant_id, p_quantity);
end;
$$;

create or replace function public.release_inventory(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'release quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'reservations are performed by the platform' using errcode = 'insufficient_privilege';
  end if;
  return public.inventory_release_internal(p_variant_id, p_quantity);
end;
$$;

create or replace function public.commit_reserved_inventory(p_variant_id uuid, p_quantity integer, p_reference_id uuid)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'sales are committed by the platform' using errcode = 'insufficient_privilege';
  end if;
  return public.inventory_commit_internal(p_variant_id, p_quantity, p_reference_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.orders
  add column checkout_token uuid unique,
  add column reservation_expires_at timestamptz;

create index orders_pending_expiry_idx on public.orders (reservation_expires_at)
  where status = 'pending' and payment_status = 'pending';

-- Vendors fulfil from their own vendor order; they no longer read the parent
-- order (which carries other vendors' totals), so the ship-to is snapshotted here.
alter table public.vendor_orders add column shipping_address jsonb;

-- Per-line commission snapshot (rules can differ by category within one vendor order).
alter table public.order_items
  add column commission_rate_bps public.basis_points not null default 0,
  add column commission_minor public.money_minor not null default 0;

-- -----------------------------------------------------------------------------
-- Cart
-- -----------------------------------------------------------------------------
-- Current state of the signed-in customer's active cart, priced from the
-- catalog. Used by the cart page, the checkout page and place_order().
create or replace function public.cart_lines()
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
  unavailable_reason text
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
    pv.price_minor::bigint,
    ci.unit_price_minor::bigint,
    (pv.price_minor * ci.quantity)::bigint,
    case
      when i.id is null then 0
      when not i.track_inventory or i.allow_backorder then 99
      else greatest(least(i.available_quantity, 99), 0)
    end,
    r.reason is null,
    r.reason
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

-- Returns the caller's profile id or raises; also requires an active account.
create or replace function public.require_active_customer()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.current_profile_id();
begin
  if v_profile is null then
    raise exception 'Please sign in to continue.' using errcode = 'insufficient_privilege';
  end if;
  if public.current_account_status() <> 'active' then
    raise exception 'This account is not active.' using errcode = 'insufficient_privilege';
  end if;
  return v_profile;
end;
$$;

-- Validates that a quantity of a variant can be bought now; returns its price.
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
  return v_row.price_minor;
end;
$$;

create or replace function public.add_to_cart(p_variant_id uuid, p_quantity integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid := public.require_active_customer();
  v_cart     public.carts;
  v_currency text;
  v_existing integer;
  v_new_qty  integer;
  v_price    bigint;
  v_has_items boolean;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then
    raise exception 'Quantity must be between 1 and 99.';
  end if;

  select p.currency::text into v_currency
    from public.product_variants pv join public.products p on p.id = pv.product_id
   where pv.id = p_variant_id;
  if not found then
    raise exception 'This item is no longer available.';
  end if;

  select * into v_cart from public.carts where profile_id = v_profile and status = 'active' for update;
  if not found then
    insert into public.carts (profile_id, currency) values (v_profile, v_currency) returning * into v_cart;
  end if;

  v_has_items := exists (select 1 from public.cart_items where cart_id = v_cart.id);
  if not v_has_items and v_cart.currency::text <> v_currency then
    update public.carts set currency = v_currency where id = v_cart.id returning * into v_cart;
  end if;

  select quantity into v_existing from public.cart_items where cart_id = v_cart.id and variant_id = p_variant_id;
  v_new_qty := coalesce(v_existing, 0) + p_quantity;
  if v_new_qty > 99 then
    raise exception 'You can add at most 99 of an item.';
  end if;

  v_price := public.assert_variant_purchasable(p_variant_id, v_new_qty, v_cart.currency::text);

  insert into public.cart_items (cart_id, variant_id, quantity, unit_price_minor)
  values (v_cart.id, p_variant_id, v_new_qty, v_price)
  on conflict (cart_id, variant_id)
  do update set quantity = excluded.quantity, unit_price_minor = excluded.unit_price_minor;

  update public.carts set updated_at = now() where id = v_cart.id;
  return v_new_qty;
end;
$$;

create or replace function public.set_cart_item_quantity(p_cart_item_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_item    record;
  v_price   bigint;
begin
  select ci.id, ci.variant_id, c.id as cart_id, c.currency::text as currency
    into v_item
    from public.cart_items ci join public.carts c on c.id = ci.cart_id
   where ci.id = p_cart_item_id and c.profile_id = v_profile and c.status = 'active'
     for update of ci;
  if not found then
    raise exception 'That item is no longer in your bag.' using errcode = 'no_data_found';
  end if;

  if p_quantity is null or p_quantity < 0 or p_quantity > 99 then
    raise exception 'Quantity must be between 1 and 99.';
  end if;
  if p_quantity = 0 then
    delete from public.cart_items where id = v_item.id;
    return 0;
  end if;

  v_price := public.assert_variant_purchasable(v_item.variant_id, p_quantity, v_item.currency);
  update public.cart_items set quantity = p_quantity, unit_price_minor = v_price where id = v_item.id;
  update public.carts set updated_at = now() where id = v_item.cart_id;
  return p_quantity;
end;
$$;

create or replace function public.remove_cart_item(p_cart_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
begin
  delete from public.cart_items ci
   using public.carts c
   where ci.id = p_cart_item_id and c.id = ci.cart_id and c.profile_id = v_profile and c.status = 'active';
end;
$$;

create or replace function public.clear_cart()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
begin
  delete from public.cart_items ci
   using public.carts c
   where c.id = ci.cart_id and c.profile_id = v_profile and c.status = 'active';
end;
$$;

-- -----------------------------------------------------------------------------
-- Order lifecycle helpers
-- -----------------------------------------------------------------------------
create or replace function public.address_snapshot(p_address public.addresses)
returns jsonb
language sql
immutable
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'full_name', p_address.full_name,
    'phone', p_address.phone,
    'line1', p_address.line1,
    'line2', p_address.line2,
    'city', p_address.city,
    'state', p_address.state,
    'postal_code', p_address.postal_code,
    'country_code', p_address.country_code
  ));
$$;

-- Releases every reservation held by a pending order and cancels it.
-- Caller must hold a row lock on the order and have checked it is pending.
create or replace function public.release_order_reservations_internal(p_order_id uuid, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_item record;
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

  update public.orders
     set status = 'cancelled', payment_status = 'cancelled', cancelled_at = now(),
         cancellation_reason = p_reason, reservation_expires_at = null
   where id = p_order_id;
  update public.vendor_orders set status = 'cancelled', cancelled_at = now() where order_id = p_order_id;
end;
$$;

-- Cancels unpaid checkouts whose reservation window has passed and releases
-- their stock. Optionally limited to orders that hold any of `p_variant_ids`.
-- Safe to run concurrently: each order is locked and processed exactly once.
create or replace function public.expire_stale_checkouts(p_variant_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_count integer := 0;
begin
  for v_order_id in
    select o.id from public.orders o
     where o.status = 'pending' and o.payment_status = 'pending'
       and o.reservation_expires_at is not null and o.reservation_expires_at < now()
       and (p_variant_ids is null or exists (
             select 1 from public.order_items oi where oi.order_id = o.id and oi.variant_id = any (p_variant_ids)))
     order by o.id
     for update skip locked
  loop
    perform public.release_order_reservations_internal(v_order_id, 'checkout_expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Checkout
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

  select coalesce(sum(l.line_total_minor), 0) into v_subtotal from public.cart_lines() l;
  if p_expected_total_minor is not null and p_expected_total_minor <> v_subtotal then
    raise exception 'Prices in your bag have changed. Please review your order and try again.';
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
    customer_id, currency, subtotal_minor, total_minor, customer_email, customer_note,
    shipping_address, billing_address, checkout_token, reservation_expires_at
  ) values (
    v_profile, v_cart.currency, v_subtotal, v_subtotal, v_email, nullif(trim(p_customer_note), ''),
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
    insert into public.vendor_orders (
      order_id, vendor_id, vendor_order_number, currency, subtotal_minor, total_minor,
      commission_rate_bps, commission_minor, payment_fee_minor, vendor_earnings_minor, shipping_address
    ) values (
      v_order_id, v_vendor.vendor_id, v_order_number || '-' || lpad(v_index::text, 2, '0'), v_cart.currency,
      v_vendor.subtotal, v_vendor.subtotal,
      -- effective (blended) rate for reporting; per-line rates are on order_items
      case when v_vendor.subtotal > 0
           then least(10000, (v_vendor.commission * 10000 + v_vendor.subtotal / 2) / v_vendor.subtotal)::integer
           else 0 end,
      v_vendor.commission, 0, v_vendor.subtotal - v_vendor.commission, public.address_snapshot(v_ship)
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

-- Customer (own order) or admin cancels an order that is still awaiting payment.
create or replace function public.cancel_pending_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_admin boolean := public.is_admin();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (v_order.customer_id is distinct from public.current_profile_id() and not v_admin) then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'Only orders that are awaiting payment can be cancelled here.';
  end if;
  perform public.release_order_reservations_internal(p_order_id, case when v_admin and v_order.customer_id <> public.current_profile_id() then 'cancelled_by_admin' else 'cancelled_by_customer' end);
  if v_admin and v_order.customer_id <> public.current_profile_id() then
    perform public.log_audit_event('order.cancelled', 'order', p_order_id::text, jsonb_build_object('order_number', v_order.order_number));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment confirmation boundary
-- -----------------------------------------------------------------------------
-- The ONLY path that turns reserved stock into a sale. Intended to be called
-- by a server-side payment-provider webhook using the service role after the
-- provider has verified the capture. It is not callable by browsers.
create or replace function public.confirm_order_payment(
  p_order_id            uuid,
  p_provider            public.payment_provider,
  p_provider_payment_id text,
  p_amount_minor        bigint,
  p_currency            text,
  p_fee_minor           bigint default 0,
  p_raw_payload         jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders;
  v_payment_id uuid;
  v_item       record;
begin
  if coalesce(auth.role(), 'direct') in ('anon', 'authenticated') then
    raise exception 'payments are confirmed by the platform' using errcode = 'insufficient_privilege';
  end if;
  if p_provider_payment_id is null or char_length(p_provider_payment_id) < 3 then
    raise exception 'a provider payment reference is required' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % does not exist', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'order % is not awaiting payment (status %, payment %)', v_order.order_number, v_order.status, v_order.payment_status
      using errcode = 'check_violation';
  end if;
  if p_amount_minor <> v_order.total_minor or p_currency <> v_order.currency::text then
    raise exception 'payment % % does not match order total % %', p_amount_minor, p_currency, v_order.total_minor, v_order.currency
      using errcode = 'check_violation';
  end if;
  if p_fee_minor < 0 or p_fee_minor > p_amount_minor then
    raise exception 'invalid payment fee' using errcode = 'check_violation';
  end if;

  insert into public.payments (order_id, provider, provider_payment_id, status, currency, amount_minor, fee_minor,
                               authorized_at, captured_at, metadata)
  values (p_order_id, p_provider, p_provider_payment_id, 'paid', v_order.currency, p_amount_minor, p_fee_minor,
          now(), now(), coalesce(p_raw_payload, '{}'::jsonb))
  returning id into v_payment_id;

  insert into public.payment_transactions (payment_id, type, status, amount_minor, currency, provider_transaction_id, raw_payload)
  values (v_payment_id, 'capture', 'succeeded', p_amount_minor, v_order.currency, p_provider_payment_id, p_raw_payload);
  if p_fee_minor > 0 then
    insert into public.payment_transactions (payment_id, type, status, amount_minor, currency)
    values (v_payment_id, 'fee', 'succeeded', -p_fee_minor, v_order.currency);
  end if;

  -- Reserved stock becomes sold stock.
  for v_item in
    select oi.variant_id, sum(oi.quantity)::integer as quantity
      from public.order_items oi
     where oi.order_id = p_order_id and oi.variant_id is not null
     group by oi.variant_id
     order by oi.variant_id
  loop
    perform public.inventory_commit_internal(v_item.variant_id, v_item.quantity, p_order_id);
  end loop;

  -- Allocate the provider fee to vendor orders by total, largest remainder,
  -- ties broken by vendor order number (mirrors allocateProportionally()).
  with base as (
    select vo.id, vo.total_minor as w, row_number() over (order by vo.vendor_order_number) as rn
      from public.vendor_orders vo where vo.order_id = p_order_id
  ), tot as (
    -- sum()/count() return numeric/bigint; cast so every division below is integer division
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
         vendor_earnings_minor = vo.total_minor - vo.commission_minor - (r.share + case when r.rk <= r.leftover then 1 else 0 end),
         status = 'confirmed'
    from ranked r
   where vo.id = r.id;

  update public.orders
     set status = 'confirmed', payment_status = 'paid', confirmed_at = now(), reservation_expires_at = null
   where id = p_order_id;

  return v_payment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Immutable financial snapshots
-- -----------------------------------------------------------------------------
-- No API role (anon, authenticated incl. admins, service_role) may change the
-- money or snapshot columns of an order once written. Only trusted database
-- functions (running as their owner) and direct maintenance sessions can.
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
         new.placed_at, new.checkout_token)
     is distinct from
     row(old.order_number, old.customer_id, old.currency, old.subtotal_minor, old.discount_minor, old.shipping_minor,
         old.tax_minor, old.total_minor, old.coupon_code, old.customer_email, old.shipping_address, old.billing_address,
         old.placed_at, old.checkout_token) then
    raise exception 'order financial snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger orders_lock_financials
  before update on public.orders
  for each row execute function public.lock_order_financials();

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
         new.payment_fee_minor, new.vendor_earnings_minor, new.shipping_address)
     is distinct from
     row(old.order_id, old.vendor_id, old.vendor_order_number, old.currency, old.subtotal_minor, old.discount_minor,
         old.shipping_minor, old.tax_minor, old.total_minor, old.commission_rate_bps, old.commission_minor,
         old.payment_fee_minor, old.vendor_earnings_minor, old.shipping_address) then
    raise exception 'vendor order financial snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger vendor_orders_lock_financials
  before update on public.vendor_orders
  for each row execute function public.lock_vendor_order_financials();

create or replace function public.lock_order_item_financials()
returns trigger
language plpgsql
as $$
begin
  if public.in_trusted_context() then
    return new;
  end if;
  if row(new.order_id, new.vendor_order_id, new.vendor_id, new.product_name, new.variant_title, new.sku, new.quantity,
         new.unit_price_minor, new.discount_minor, new.tax_minor, new.total_minor, new.commission_rate_bps, new.commission_minor)
     is distinct from
     row(old.order_id, old.vendor_order_id, old.vendor_id, old.product_name, old.variant_title, old.sku, old.quantity,
         old.unit_price_minor, old.discount_minor, old.tax_minor, old.total_minor, old.commission_rate_bps, old.commission_minor) then
    raise exception 'order item price snapshots are immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger order_items_lock_financials
  before update on public.order_items
  for each row execute function public.lock_order_item_financials();

-- Trusted functions (cancellation, expiry, payment confirmation) may be invoked
-- by customers or the service role; let them through the Phase 1 column guard.
create or replace function public.protect_vendor_order_locked_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() or public.in_trusted_context() then
    return new;
  end if;
  if new.order_id is distinct from old.order_id
     or new.vendor_id is distinct from old.vendor_id
     or new.vendor_order_number is distinct from old.vendor_order_number
     or new.currency is distinct from old.currency
     or new.subtotal_minor is distinct from old.subtotal_minor
     or new.discount_minor is distinct from old.discount_minor
     or new.shipping_minor is distinct from old.shipping_minor
     or new.tax_minor is distinct from old.tax_minor
     or new.total_minor is distinct from old.total_minor
     or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.commission_minor is distinct from old.commission_minor
     or new.payment_fee_minor is distinct from old.payment_fee_minor
     or new.vendor_earnings_minor is distinct from old.vendor_earnings_minor then
    raise exception 'financial fields on vendor orders are managed by the platform'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('confirmed', 'processing', 'shipped', 'delivered') then
    raise exception 'vendors may only move orders to confirmed, processing, shipped or delivered'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Vendors fulfil only paid orders, forward through the lifecycle.
create or replace function public.enforce_vendor_order_transitions()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() or public.in_trusted_context() or new.status = old.status then
    return new;
  end if;
  if old.status = 'pending' then
    raise exception 'This order is awaiting payment and cannot be fulfilled yet.';
  end if;
  if not ((old.status = 'confirmed' and new.status in ('processing', 'shipped'))
       or (old.status = 'processing' and new.status = 'shipped')
       or (old.status = 'shipped' and new.status = 'delivered')) then
    raise exception 'An order cannot move from % to %.', old.status, new.status;
  end if;
  if new.status = 'shipped' and new.shipped_at is null then
    new.shipped_at := now();
  end if;
  if new.status = 'delivered' and new.delivered_at is null then
    new.delivered_at := now();
  end if;
  return new;
end;
$$;

create trigger vendor_orders_status_transitions
  before update on public.vendor_orders
  for each row execute function public.enforce_vendor_order_transitions();

-- -----------------------------------------------------------------------------
-- RLS: vendors read their vendor orders and items, never the parent order.
-- -----------------------------------------------------------------------------
drop policy orders_select_vendor on public.orders;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Cart rows (and their price snapshots) are written only by the cart functions.
revoke insert, update on public.carts, public.cart_items from authenticated;

-- Orders are mutated only by trusted functions; vendors update fulfilment columns.
revoke update on public.orders from authenticated;
revoke update on public.vendor_orders, public.order_items from authenticated;
grant update (status, carrier, tracking_number, tracking_url, shipped_at, delivered_at, vendor_note)
  on public.vendor_orders to authenticated;
grant update (fulfilled_quantity) on public.order_items to authenticated;

grant execute on function public.in_trusted_context() to anon, authenticated, service_role;

grant execute on function
  public.cart_lines(),
  public.add_to_cart(uuid, integer),
  public.set_cart_item_quantity(uuid, integer),
  public.remove_cart_item(uuid),
  public.clear_cart(),
  public.place_order(uuid, uuid, uuid, bigint, text),
  public.cancel_pending_order(uuid)
to authenticated;

grant execute on function
  public.expire_stale_checkouts(uuid[]),
  public.confirm_order_payment(uuid, public.payment_provider, text, bigint, text, bigint, jsonb),
  public.cancel_pending_order(uuid)
to service_role;

-- Internal helpers stay ungranted: only SECURITY DEFINER functions call them.
revoke all on function
  public.inventory_reserve_internal(uuid, integer),
  public.inventory_release_internal(uuid, integer),
  public.inventory_commit_internal(uuid, integer, uuid),
  public.release_order_reservations_internal(uuid, text),
  public.require_active_customer(),
  public.assert_variant_purchasable(uuid, integer, text),
  public.address_snapshot(public.addresses)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Scheduled expiry (Supabase): when pg_cron is available, release abandoned
-- checkouts every five minutes. Checkout also expires stale reservations for
-- the items it touches, so correctness never depends on the schedule.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('luxora-expire-checkouts', '*/5 * * * *', 'select public.expire_stale_checkouts()');
  else
    raise notice 'pg_cron is not enabled: abandoned checkouts are released lazily by place_order(). Enable pg_cron and run: select cron.schedule(''luxora-expire-checkouts'', ''*/5 * * * *'', ''select public.expire_stale_checkouts()'');';
  end if;
end;
$$;
