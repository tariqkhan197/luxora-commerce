-- =============================================================================
-- Migration 0018 (Phase 4b): hosted-checkout payments (Stripe, TEST MODE).
-- -----------------------------------------------------------------------------
-- Luxora is the only merchant: customers pay Luxora; vendors never have a
-- payment-provider account. The database stays the financial source of truth:
--   * the order (place_order) fixes every amount before any payment starts;
--   * a payment attempt (one Stripe Checkout Session) is recorded against the
--     order and extends the stock hold to the session's expiry + a grace;
--   * only the service role (a verified webhook) can confirm a payment, and the
--     confirmation is idempotent per provider payment reference;
--   * a payment that arrives for an order that is no longer payable is
--     recorded and reported as `refund_required`, never silently dropped.
-- Live payments are blocked here as well as in the application:
-- `payments.live_mode_enabled` is false and every provider-facing function
-- refuses livemode data until it is deliberately switched on.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('payments.live_mode_enabled', 'false', 'Live (real-money) payments. Must stay false until Stripe, business and legal approval are confirmed.', false),
  ('payments.session_minutes', '30', 'Lifetime of a hosted checkout session in minutes (Stripe minimum is 30).', false),
  ('payments.reservation_grace_minutes', '5', 'Extra minutes the stock hold lasts beyond the checkout session expiry.', false),
  ('payments.max_attempts', '3', 'Maximum checkout sessions per order.', false),
  ('payments.max_hold_minutes', '120', 'Longest time an unpaid order may hold stock, measured from placement.', false),
  ('payments.fee_bearer', '"platform"', 'Who bears payment processing fees: "platform" or "vendor".', false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Settings helpers (internal)
-- -----------------------------------------------------------------------------
create or replace function public.platform_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::integer from public.platform_settings where key = p_key), p_default);
$$;

create or replace function public.platform_setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value #>> '{}' from public.platform_settings where key = p_key), p_default);
$$;

-- Refuses provider data from live mode unless live payments were enabled.
create or replace function public.assert_payment_mode(p_livemode boolean)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(p_livemode, false)
     and public.platform_setting_text('payments.live_mode_enabled', 'false') <> 'true' then
    raise exception 'live payments are not enabled on this platform' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create or replace function public.assert_platform_caller()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'direct') in ('anon', 'authenticated') then
    raise exception 'payments are handled by the platform' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
-- Provider customer per profile (lets the provider reuse saved details).
create table public.payment_customers (
  profile_id            uuid not null references public.profiles (id) on delete cascade,
  provider              public.payment_provider not null,
  provider_customer_id  text not null unique,
  livemode              boolean not null default false,
  created_at            timestamptz not null default now(),
  primary key (profile_id, provider, livemode)
);

-- One hosted-checkout attempt (Stripe Checkout Session) per row.
create table public.payment_attempts (
  id                          uuid primary key default gen_random_uuid(),
  order_id                    uuid not null references public.orders (id) on delete restrict,
  attempt_no                  integer not null check (attempt_no between 1 and 20),
  provider                    public.payment_provider not null,
  provider_session_id         text not null unique,
  provider_payment_intent_id  text,
  status                      public.payment_attempt_status not null default 'open',
  currency                    public.currency_code not null,
  amount_minor                public.money_minor not null,
  checkout_url                text,
  livemode                    boolean not null default false,
  expires_at                  timestamptz not null,
  completed_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (order_id, attempt_no)
);

create unique index payment_attempts_one_open_idx on public.payment_attempts (order_id) where status = 'open';
create index payment_attempts_payment_intent_idx on public.payment_attempts (provider_payment_intent_id)
  where provider_payment_intent_id is not null;

create trigger payment_attempts_set_updated_at
  before update on public.payment_attempts
  for each row execute function public.set_updated_at();

-- Every provider webhook event, for de-duplication and audit.
create table public.payment_webhook_events (
  event_id      text primary key,
  provider      public.payment_provider not null,
  type          text not null,
  livemode      boolean not null default false,
  api_version   text,
  status        public.webhook_event_status not null default 'received',
  attempts      integer not null default 1,
  last_error    text,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  processed_at  timestamptz
);

create index payment_webhook_events_status_idx on public.payment_webhook_events (status, received_at desc);

-- Provider references on the order's payment are looked up by intent id.
create index payments_order_status_idx on public.payments (order_id, status);

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table public.payment_customers enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_webhook_events enable row level security;

create policy payment_attempts_select_customer on public.payment_attempts
  for select to authenticated using ((select public.order_customer_id(order_id)) = (select public.current_profile_id()));
create policy payment_attempts_select_admin on public.payment_attempts
  for select to authenticated using ((select public.is_admin()));
create policy payment_webhook_events_select_admin on public.payment_webhook_events
  for select to authenticated using ((select public.is_admin()));

-- Supabase's default privileges grant new tables to the API roles; start from
-- zero (as migration 0011 does) and grant only what is needed.
revoke all on public.payment_customers, public.payment_attempts, public.payment_webhook_events from anon, authenticated;

-- Same hardening for the Release 4a shipping tables (RLS already limits rows;
-- this removes the broad default table privileges underneath it).
revoke all on public.shipping_zones, public.shipping_zone_countries, public.vendor_shipping_rates from anon, authenticated;
grant select on public.shipping_zones, public.shipping_zone_countries to anon;
grant select, insert, update, delete on public.shipping_zones, public.shipping_zone_countries, public.vendor_shipping_rates
  to authenticated;

-- Customers see the state of their own attempts, never the session URL or ids.
grant select (id, order_id, attempt_no, status, currency, amount_minor, expires_at, completed_at, created_at)
  on public.payment_attempts to authenticated;
grant select on public.payment_webhook_events to authenticated;  -- admins only, by RLS
grant all on public.payment_customers, public.payment_attempts, public.payment_webhook_events to service_role;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
-- Every product is priced in the platform currency (USD in Release 4).
create or replace function public.enforce_platform_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := public.platform_setting_text('platform.default_currency', 'USD');
begin
  if new.currency::text <> v_currency then
    raise exception 'Prices must be in %.', v_currency;
  end if;
  return new;
end;
$$;

create trigger products_enforce_platform_currency
  before insert or update of currency on public.products
  for each row execute function public.enforce_platform_currency();

-- Hosted checkout accepts at most 100 line items: cap the bag accordingly.
create or replace function public.enforce_cart_line_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.cart_items where cart_id = new.cart_id) >= 100 then
    raise exception 'Your bag can hold up to 100 different items.';
  end if;
  return new;
end;
$$;

create trigger cart_items_line_limit
  before insert on public.cart_items
  for each row execute function public.enforce_cart_line_limit();

-- -----------------------------------------------------------------------------
-- Order release (replaces the Phase 3 helper: the payment status is now explicit)
-- -----------------------------------------------------------------------------
drop function if exists public.release_order_reservations_internal(uuid, text);

-- Releases every reservation held by a pending order and cancels it.
-- Caller must hold a row lock on the order and have checked it is releasable.
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

-- Unpaid checkouts past their hold are cancelled as `expired`. Orders whose
-- payment is processing are never expired here.
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
    perform public.release_order_reservations_internal(v_order_id, 'checkout_expired', 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Customer (own order) or admin cancels an order that is still awaiting payment.
-- An open hosted-checkout session must be closed first (the application expires
-- it with the provider), so a cancelled order cannot be paid afterwards.
create or replace function public.cancel_pending_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_admin boolean := public.is_admin();
  v_by_admin boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (v_order.customer_id is distinct from public.current_profile_id() and not v_admin) then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.payment_status = 'processing' then
    raise exception 'Your payment is being processed, so this order can no longer be cancelled here.';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'Only orders that are awaiting payment can be cancelled here.';
  end if;
  if exists (select 1 from public.payment_attempts a
              where a.order_id = p_order_id and a.status = 'open' and a.expires_at > now()) then
    raise exception 'This order has an open payment page. Please try again in a moment.';
  end if;
  v_by_admin := v_admin and v_order.customer_id <> public.current_profile_id();
  perform public.release_order_reservations_internal(
    p_order_id, case when v_by_admin then 'cancelled_by_admin' else 'cancelled_by_customer' end, 'cancelled');
  if v_by_admin then
    perform public.log_audit_event('order.cancelled', 'order', p_order_id::text, jsonb_build_object('order_number', v_order.order_number));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment attempts
-- -----------------------------------------------------------------------------
-- Called by the order's customer (through the application) before redirecting
-- to hosted checkout. Returns either the open attempt to reuse, or the number
-- and expiry the next attempt must use. Never creates anything itself.
create or replace function public.begin_payment_attempt(p_order_id uuid)
returns table (
  action             text,         -- 'reuse' | 'create'
  attempt_no         integer,
  checkout_url       text,
  session_expires_at timestamptz,
  order_number       text,
  amount_minor       bigint,
  currency           text,
  customer_email     text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid := public.require_active_customer();
  v_order    public.orders;
  v_open     public.payment_attempts;
  v_count    integer;
  v_session  integer := greatest(public.platform_setting_int('payments.session_minutes', 30), 30);
  v_grace    integer := public.platform_setting_int('payments.reservation_grace_minutes', 5);
  v_max_hold integer := public.platform_setting_int('payments.max_hold_minutes', 120);
  v_expires  timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.customer_id <> v_profile then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.payment_status = 'processing' then
    raise exception 'Your payment is already being processed.';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'This order can no longer be paid.';
  end if;
  if v_order.reservation_expires_at is null or v_order.reservation_expires_at <= now() then
    raise exception 'The payment window for this order has closed. Restore your bag to check out again.';
  end if;

  select * into v_open from public.payment_attempts a
   where a.order_id = p_order_id and a.status = 'open' and a.expires_at > now() + interval '2 minutes';
  if found then
    return query select 'reuse'::text, v_open.attempt_no, v_open.checkout_url, v_open.expires_at,
                        v_order.order_number, v_order.total_minor::bigint, v_order.currency::text, v_order.customer_email::text;
    return;
  end if;

  -- A stale open attempt (about to expire) no longer counts as open.
  update public.payment_attempts set status = 'expired'
   where order_id = p_order_id and status = 'open';

  select count(*) into v_count from public.payment_attempts a where a.order_id = p_order_id;
  if v_count >= public.platform_setting_int('payments.max_attempts', 3) then
    raise exception 'This order has reached the maximum number of payment attempts. Restore your bag to check out again.';
  end if;

  v_expires := date_trunc('second', now()) + make_interval(mins => v_session);
  if v_expires + make_interval(mins => v_grace) > v_order.placed_at + make_interval(mins => v_max_hold) then
    raise exception 'The payment window for this order has closed. Restore your bag to check out again.';
  end if;

  return query select 'create'::text, v_count + 1, null::text, v_expires,
                      v_order.order_number, v_order.total_minor::bigint, v_order.currency::text, v_order.customer_email::text;
end;
$$;

-- Records a created hosted-checkout session (platform only) and extends the
-- stock hold to the session expiry plus the grace period.
create or replace function public.record_checkout_session(
  p_order_id     uuid,
  p_attempt_no   integer,
  p_provider     public.payment_provider,
  p_session_id   text,
  p_checkout_url text,
  p_expires_at   timestamptz,
  p_amount_minor bigint,
  p_currency     text,
  p_livemode     boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders;
  v_id       uuid;
  v_grace    integer := public.platform_setting_int('payments.reservation_grace_minutes', 5);
  v_max_hold integer := public.platform_setting_int('payments.max_hold_minutes', 120);
begin
  perform public.assert_platform_caller();
  perform public.assert_payment_mode(p_livemode);
  if p_session_id is null or char_length(p_session_id) < 3 then
    raise exception 'a provider session id is required' using errcode = 'check_violation';
  end if;

  select id into v_id from public.payment_attempts where provider_session_id = p_session_id;
  if found then
    return v_id;  -- idempotent replay
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % does not exist', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'pending' or v_order.payment_status <> 'pending' then
    raise exception 'order % is not awaiting payment', v_order.order_number using errcode = 'check_violation';
  end if;
  if p_amount_minor <> v_order.total_minor or p_currency <> v_order.currency::text then
    raise exception 'session amount % % does not match order total % %', p_amount_minor, p_currency, v_order.total_minor, v_order.currency
      using errcode = 'check_violation';
  end if;
  if p_expires_at + make_interval(mins => v_grace) > v_order.placed_at + make_interval(mins => v_max_hold) then
    raise exception 'session expiry exceeds the maximum stock hold' using errcode = 'check_violation';
  end if;

  update public.payment_attempts set status = 'expired' where order_id = p_order_id and status = 'open';
  insert into public.payment_attempts (order_id, attempt_no, provider, provider_session_id, status, currency,
                                       amount_minor, checkout_url, livemode, expires_at)
  values (p_order_id, p_attempt_no, p_provider, p_session_id, 'open', v_order.currency, p_amount_minor,
          p_checkout_url, coalesce(p_livemode, false), p_expires_at)
  returning id into v_id;

  update public.orders
     set reservation_expires_at = greatest(reservation_expires_at, p_expires_at + make_interval(mins => v_grace))
   where id = p_order_id;
  return v_id;
end;
$$;

-- Closes an open attempt without touching the order (the application expired
-- the provider session, e.g. before a customer cancels).
create or replace function public.close_payment_attempt(p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_caller();
  update public.payment_attempts set status = 'cancelled' where provider_session_id = p_session_id and status = 'open';
end;
$$;

-- Provider reports a session expired: the attempt closes, and the order is
-- released if nothing else can still pay it. Returns what happened.
create or replace function public.expire_payment_attempt(p_session_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
  v_order   public.orders;
begin
  perform public.assert_platform_caller();
  select * into v_attempt from public.payment_attempts where provider_session_id = p_session_id;
  if not found then
    return 'unknown_session';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  update public.payment_attempts set status = 'expired'
   where id = v_attempt.id and status = 'open';
  if v_order.status = 'pending' and v_order.payment_status = 'pending'
     and not exists (select 1 from public.payment_attempts a
                      where a.order_id = v_order.id and a.status = 'open' and a.expires_at > now()) then
    perform public.release_order_reservations_internal(v_order.id, 'checkout_expired', 'expired');
    return 'order_expired';
  end if;
  return 'attempt_expired';
end;
$$;

-- Provider reports checkout completed but the money is not settled yet.
create or replace function public.mark_payment_processing(p_session_id text, p_payment_intent_id text, p_livemode boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
  v_order   public.orders;
begin
  perform public.assert_platform_caller();
  perform public.assert_payment_mode(p_livemode);
  select * into v_attempt from public.payment_attempts where provider_session_id = p_session_id;
  if not found then
    return 'unknown_session';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  update public.payment_attempts
     set status = 'complete', provider_payment_intent_id = coalesce(p_payment_intent_id, provider_payment_intent_id),
         completed_at = coalesce(completed_at, now())
   where id = v_attempt.id and status in ('open', 'expired');
  if v_order.status = 'pending' and v_order.payment_status = 'pending' then
    update public.orders set payment_status = 'processing' where id = v_order.id;
    return 'processing';
  end if;
  return 'ignored';
end;
$$;

-- Provider reports a delayed payment failed: release the order.
create or replace function public.fail_payment_attempt(p_session_id text, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.payment_attempts;
  v_order   public.orders;
begin
  perform public.assert_platform_caller();
  select * into v_attempt from public.payment_attempts where provider_session_id = p_session_id;
  if not found then
    return 'unknown_session';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  update public.payment_attempts set status = 'failed' where id = v_attempt.id;
  if v_order.status = 'pending' and v_order.payment_status in ('pending', 'processing') then
    perform public.release_order_reservations_internal(v_order.id, left(coalesce(p_reason, 'payment_failed'), 200), 'failed');
    return 'order_failed';
  end if;
  return 'ignored';
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment confirmation boundary (replaces the Phase 3 signature)
-- -----------------------------------------------------------------------------
drop function if exists public.confirm_order_payment(uuid, public.payment_provider, text, bigint, text, bigint, jsonb);

-- Splits a provider fee across an order's vendor orders when vendors bear fees
-- (largest remainder by vendor order total, ties by vendor order number).
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
         vendor_earnings_minor = vo.total_minor - vo.commission_minor - (r.share + case when r.rk <= r.leftover then 1 else 0 end)
    from ranked r
   where vo.id = r.id;
end;
$$;

-- The ONLY path that turns reserved stock into a sale. Called by the verified
-- provider webhook (service role). Idempotent per provider payment reference.
-- Outcomes: 'confirmed' | 'duplicate' | 'refund_required' (money arrived for an
-- order that can no longer be fulfilled; the caller must refund it).
create or replace function public.confirm_order_payment(
  p_order_id            uuid,
  p_provider            public.payment_provider,
  p_provider_payment_id text,
  p_amount_minor        bigint,
  p_currency            text,
  p_fee_minor           bigint default null,     -- null: not known yet (record_payment_fee later)
  p_tax_minor           bigint default 0,        -- Stripe Tax is disabled: must be 0
  p_session_id          text default null,
  p_livemode            boolean default false,
  p_raw_payload         jsonb default null
)
returns table (payment_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders;
  v_payment_id uuid;
  v_item       record;
  v_late       boolean;
begin
  perform public.assert_platform_caller();
  perform public.assert_payment_mode(p_livemode);
  if p_provider_payment_id is null or char_length(p_provider_payment_id) < 3 then
    raise exception 'a provider payment reference is required' using errcode = 'check_violation';
  end if;
  if coalesce(p_tax_minor, 0) <> 0 then
    raise exception 'tax collection is not enabled' using errcode = 'check_violation';
  end if;
  if p_fee_minor is not null and (p_fee_minor < 0 or p_fee_minor > p_amount_minor) then
    raise exception 'invalid payment fee' using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % does not exist', p_order_id using errcode = 'no_data_found';
  end if;

  -- Idempotency: the same provider payment is recorded once.
  select p.id into v_payment_id from public.payments p
   where p.provider = p_provider and p.provider_payment_id = p_provider_payment_id;
  if found then
    return query select v_payment_id, 'duplicate'::text;
    return;
  end if;

  if p_amount_minor <> v_order.total_minor or p_currency <> v_order.currency::text then
    raise exception 'payment % % does not match order total % %', p_amount_minor, p_currency, v_order.total_minor, v_order.currency
      using errcode = 'check_violation';
  end if;

  v_late := not (v_order.status = 'pending' and v_order.payment_status in ('pending', 'processing'));

  insert into public.payments (order_id, provider, provider_payment_id, status, currency, amount_minor, fee_minor,
                               authorized_at, captured_at, metadata)
  values (p_order_id, p_provider, p_provider_payment_id, 'paid', v_order.currency, p_amount_minor, coalesce(p_fee_minor, 0),
          now(), now(),
          -- customer-visible row: identifiers only, never the raw provider payload
          jsonb_strip_nulls(jsonb_build_object('session_id', p_session_id, 'livemode', coalesce(p_livemode, false),
                                               'fee_pending', p_fee_minor is null, 'late', v_late)))
  returning id into v_payment_id;

  insert into public.payment_transactions (payment_id, type, status, amount_minor, currency, provider_transaction_id, raw_payload)
  values (v_payment_id, 'capture', 'succeeded', p_amount_minor, v_order.currency, p_provider_payment_id, p_raw_payload);
  if coalesce(p_fee_minor, 0) > 0 then
    insert into public.payment_transactions (payment_id, type, status, amount_minor, currency)
    values (v_payment_id, 'fee', 'succeeded', -p_fee_minor, v_order.currency);
  end if;

  update public.payment_attempts
     set status = 'complete', completed_at = coalesce(completed_at, now()),
         provider_payment_intent_id = coalesce(provider_payment_intent_id, p_provider_payment_id)
   where order_id = p_order_id
     and (provider_session_id = p_session_id or (p_session_id is null and status = 'open'));

  if v_late then
    perform public.log_audit_event('payment.late_received', 'order', p_order_id::text,
      jsonb_build_object('order_number', v_order.order_number, 'payment_id', v_payment_id,
                         'amount_minor', p_amount_minor, 'order_status', v_order.status, 'payment_status', v_order.payment_status));
    return query select v_payment_id, 'refund_required'::text;
    return;
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

  -- Processing fees are borne by the platform unless configured otherwise.
  if public.platform_setting_text('payments.fee_bearer', 'platform') = 'vendor' and coalesce(p_fee_minor, 0) > 0 then
    perform public.allocate_payment_fee_internal(p_order_id, p_fee_minor);
  end if;

  update public.vendor_orders set status = 'confirmed' where order_id = p_order_id;
  update public.orders
     set status = 'confirmed', payment_status = 'paid', confirmed_at = now(), reservation_expires_at = null
   where id = p_order_id;

  return query select v_payment_id, 'confirmed'::text;
end;
$$;

-- Records the processing fee once the provider reports it (it can arrive after
-- the payment). Idempotent: a payment's fee is recorded once.
create or replace function public.record_payment_fee(p_provider public.payment_provider, p_provider_payment_id text, p_fee_minor bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  perform public.assert_platform_caller();
  select * into v_payment from public.payments
   where provider = p_provider and provider_payment_id = p_provider_payment_id for update;
  if not found then
    return 'unknown_payment';
  end if;
  if p_fee_minor is null or p_fee_minor < 0 or p_fee_minor > v_payment.amount_minor then
    raise exception 'invalid payment fee' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.payment_transactions t where t.payment_id = v_payment.id and t.type = 'fee') then
    return 'duplicate';
  end if;
  update public.payments
     set fee_minor = p_fee_minor, metadata = metadata - 'fee_pending'
   where id = v_payment.id;
  if p_fee_minor > 0 then
    insert into public.payment_transactions (payment_id, type, status, amount_minor, currency)
    values (v_payment.id, 'fee', 'succeeded', -p_fee_minor, v_payment.currency);
    if public.platform_setting_text('payments.fee_bearer', 'platform') = 'vendor'
       and not exists (select 1 from public.vendor_orders vo where vo.order_id = v_payment.order_id and vo.payment_fee_minor <> 0)
       and exists (select 1 from public.orders o where o.id = v_payment.order_id and o.payment_status = 'paid') then
      perform public.allocate_payment_fee_internal(v_payment.order_id, p_fee_minor);
    end if;
  end if;
  return 'recorded';
end;
$$;

-- Records the automatic refund of a payment that arrived for an order that
-- could no longer be fulfilled (see confirm_order_payment 'refund_required').
create or replace function public.record_late_payment_refund(p_payment_id uuid, p_provider_refund_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
begin
  perform public.assert_platform_caller();
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % does not exist', p_payment_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.payment_transactions t where t.provider_transaction_id = p_provider_refund_id) then
    return 'duplicate';
  end if;
  update public.payments
     set status = 'refunded', refunded_minor = amount_minor
   where id = v_payment.id;
  insert into public.payment_transactions (payment_id, type, status, amount_minor, currency, provider_transaction_id)
  values (v_payment.id, 'refund', 'succeeded', -v_payment.amount_minor, v_payment.currency, p_provider_refund_id);
  insert into public.refunds (order_id, payment_id, status, currency, amount_minor, reason, processed_at, provider_refund_id)
  values (v_payment.order_id, v_payment.id, 'completed', v_payment.currency, v_payment.amount_minor,
          'Automatic refund: payment received after the order was closed.', now(), p_provider_refund_id);
  perform public.log_audit_event('payment.late_refunded', 'payment', v_payment.id::text,
    jsonb_build_object('order_id', v_payment.order_id, 'amount_minor', v_payment.amount_minor, 'provider_refund_id', p_provider_refund_id));
  return 'recorded';
end;
$$;

-- -----------------------------------------------------------------------------
-- Webhook de-duplication
-- -----------------------------------------------------------------------------
-- Returns 'process' when the event should be handled now, 'duplicate' when it
-- was already handled, or 'busy' when another delivery is handling it.
create or replace function public.begin_webhook_event(
  p_event_id    text,
  p_provider    public.payment_provider,
  p_type        text,
  p_livemode    boolean,
  p_api_version text,
  p_payload     jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.payment_webhook_events;
begin
  perform public.assert_platform_caller();
  perform public.assert_payment_mode(p_livemode);
  insert into public.payment_webhook_events (event_id, provider, type, livemode, api_version, payload)
  values (p_event_id, p_provider, p_type, coalesce(p_livemode, false), p_api_version, p_payload)
  on conflict (event_id) do nothing;
  if found then
    return 'process';
  end if;

  select * into v_event from public.payment_webhook_events where event_id = p_event_id for update;
  if v_event.status in ('processed', 'ignored') then
    return 'duplicate';
  end if;
  if v_event.status = 'received' and v_event.last_attempt_at > now() - interval '2 minutes' then
    return 'busy';
  end if;
  update public.payment_webhook_events
     set attempts = attempts + 1, last_attempt_at = now(), status = 'received'
   where event_id = p_event_id;
  return 'process';
end;
$$;

create or replace function public.finish_webhook_event(
  p_event_id text,
  p_status   public.webhook_event_status,
  p_error    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_caller();
  update public.payment_webhook_events
     set status = p_status,
         last_error = left(p_error, 1000),
         processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end
   where event_id = p_event_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Failed-payment recovery: put a closed order's items back in the bag
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

  update public.orders set metadata = metadata || jsonb_build_object('cart_restored_at', now()) where id = p_order_id;
  return query select v_restored, v_skipped;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function
  public.platform_setting_int(text, integer),
  public.platform_setting_text(text, text),
  public.assert_payment_mode(boolean),
  public.release_order_reservations_internal(uuid, text, public.payment_status),
  public.allocate_payment_fee_internal(uuid, bigint),
  public.enforce_platform_currency(),
  public.enforce_cart_line_limit()
from public, anon, authenticated, service_role;

revoke all on function
  public.record_checkout_session(uuid, integer, public.payment_provider, text, text, timestamptz, bigint, text, boolean),
  public.close_payment_attempt(text),
  public.expire_payment_attempt(text),
  public.mark_payment_processing(text, text, boolean),
  public.fail_payment_attempt(text, text),
  public.confirm_order_payment(uuid, public.payment_provider, text, bigint, text, bigint, bigint, text, boolean, jsonb),
  public.record_payment_fee(public.payment_provider, text, bigint),
  public.record_late_payment_refund(uuid, text),
  public.begin_webhook_event(text, public.payment_provider, text, boolean, text, jsonb),
  public.finish_webhook_event(text, public.webhook_event_status, text),
  public.begin_payment_attempt(uuid),
  public.restore_cart_from_order(uuid),
  public.assert_platform_caller()
from public, anon;

grant execute on function
  public.begin_payment_attempt(uuid),
  public.restore_cart_from_order(uuid),
  public.cancel_pending_order(uuid)
to authenticated;

grant execute on function
  public.record_checkout_session(uuid, integer, public.payment_provider, text, text, timestamptz, bigint, text, boolean),
  public.close_payment_attempt(text),
  public.expire_payment_attempt(text),
  public.mark_payment_processing(text, text, boolean),
  public.fail_payment_attempt(text, text),
  public.confirm_order_payment(uuid, public.payment_provider, text, bigint, text, bigint, bigint, text, boolean, jsonb),
  public.record_payment_fee(public.payment_provider, text, bigint),
  public.record_late_payment_refund(uuid, text),
  public.begin_webhook_event(text, public.payment_provider, text, boolean, text, jsonb),
  public.finish_webhook_event(text, public.webhook_event_status, text),
  public.expire_stale_checkouts(uuid[]),
  public.cancel_pending_order(uuid)
to service_role;

-- Platform-only functions must not be callable by signed-in users either.
revoke execute on function
  public.record_checkout_session(uuid, integer, public.payment_provider, text, text, timestamptz, bigint, text, boolean),
  public.close_payment_attempt(text),
  public.expire_payment_attempt(text),
  public.mark_payment_processing(text, text, boolean),
  public.fail_payment_attempt(text, text),
  public.confirm_order_payment(uuid, public.payment_provider, text, bigint, text, bigint, bigint, text, boolean, jsonb),
  public.record_payment_fee(public.payment_provider, text, bigint),
  public.record_late_payment_refund(uuid, text),
  public.begin_webhook_event(text, public.payment_provider, text, boolean, text, jsonb),
  public.finish_webhook_event(text, public.webhook_event_status, text)
from authenticated;
