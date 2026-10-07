-- =============================================================================
-- Migration 0019 (Phase 4b): refunds, finance ledgers and payouts (TEST MODE).
-- -----------------------------------------------------------------------------
-- Money movements are recorded in two append-only ledgers:
--   * vendor_ledger_entries   — what Luxora owes each vendor (earnings, debits,
--                               payouts). Vendors never need a payment account:
--                               payouts are made by Luxora outside Stripe and
--                               recorded here by an administrator.
--   * platform_ledger_entries — Luxora's own result per order: commission
--                               earned/reversed, processing fees, refund and
--                               dispute losses.
-- Policy is configuration, not code (platform_settings):
--   payments.fee_bearer                    platform (initial) | vendor
--   refunds.vendor_liability               none (initial: platform bears refunds)
--                                          | net_of_commission
--   refunds.shipping_on_partial            false — partial refunds keep shipping
--   refunds.shipping_on_full_cancellation  true
--   refunds.shipping_on_full_return        false
--   payouts.hold_days_after_delivery       14 — earnings become payable then
-- Refunds, payouts and ledger rows are written only by the functions below;
-- administrators no longer write the finance tables directly.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('refunds.vendor_liability', '"none"', 'Who bears refunds: "none" (platform) or "net_of_commission" (vendor repays its earnings on the refunded part).', false),
  ('refunds.shipping_on_partial', 'false', 'Refund the shipping charge on partial refunds of a vendor order.', false),
  ('refunds.shipping_on_full_cancellation', 'true', 'Refund the shipping charge when a whole vendor order is cancelled after payment.', false),
  ('refunds.shipping_on_full_return', 'false', 'Refund the shipping charge when every item of a vendor order is returned.', false),
  ('disputes.vendor_liability', '"none"', 'Who bears chargebacks: "none" (platform).', false),
  ('payouts.hold_days_after_delivery', '14', 'Days after delivery before vendor earnings become available for payout.', false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Types and tables
-- -----------------------------------------------------------------------------
create type public.vendor_ledger_entry_type as enum (
  'order_earning', 'fee_adjustment', 'refund_debit', 'adjustment', 'payout', 'payout_reversal'
);
create type public.platform_ledger_entry_type as enum (
  'commission_earned', 'commission_reversed', 'processing_fee', 'refund_loss',
  'dispute_loss', 'dispute_fee', 'dispute_recovered', 'adjustment'
);
create type public.refund_kind as enum ('cancellation', 'return', 'goodwill', 'late_payment', 'external');

alter table public.refunds
  add column kind public.refund_kind not null default 'goodwill',
  add column shipping_minor public.money_minor not null default 0,
  add column provider_status text;

create unique index refunds_provider_refund_idx on public.refunds (provider_refund_id) where provider_refund_id is not null;

-- Which items (and how many) a refund covers, with the commission attributable to them.
create table public.refund_items (
  id               uuid primary key default gen_random_uuid(),
  refund_id        uuid not null references public.refunds (id) on delete restrict,
  order_item_id    uuid not null references public.order_items (id) on delete restrict,
  quantity         integer not null check (quantity > 0),
  amount_minor     public.money_minor not null,
  commission_minor public.money_minor not null default 0,
  created_at       timestamptz not null default now(),
  unique (refund_id, order_item_id)
);

create index refund_items_order_item_idx on public.refund_items (order_item_id);

create table public.vendor_ledger_entries (
  id               bigint generated always as identity primary key,
  vendor_id        uuid not null references public.vendors (id) on delete restrict,
  entry_type       public.vendor_ledger_entry_type not null,
  amount_minor     bigint not null,          -- signed: positive = owed to the vendor
  currency         public.currency_code not null,
  vendor_order_id  uuid references public.vendor_orders (id) on delete restrict,
  refund_id        uuid references public.refunds (id) on delete restrict,
  payout_id        uuid references public.payouts (id) on delete restrict,
  description      text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint vendor_ledger_reference check (
    (entry_type in ('order_earning', 'fee_adjustment') and vendor_order_id is not null) or
    (entry_type = 'refund_debit' and refund_id is not null) or
    (entry_type in ('payout', 'payout_reversal') and payout_id is not null) or
    (entry_type = 'adjustment' and description is not null)
  )
);

create index vendor_ledger_vendor_idx on public.vendor_ledger_entries (vendor_id, created_at desc);
create unique index vendor_ledger_one_earning_idx on public.vendor_ledger_entries (vendor_order_id)
  where entry_type = 'order_earning';

create trigger vendor_ledger_entries_immutable
  before update or delete on public.vendor_ledger_entries
  for each row execute function public.prevent_mutation();

create table public.platform_ledger_entries (
  id               bigint generated always as identity primary key,
  entry_type       public.platform_ledger_entry_type not null,
  amount_minor     bigint not null,          -- signed: positive = income to the platform
  currency         public.currency_code not null,
  order_id         uuid references public.orders (id) on delete restrict,
  vendor_order_id  uuid references public.vendor_orders (id) on delete restrict,
  payment_id       uuid references public.payments (id) on delete restrict,
  refund_id        uuid references public.refunds (id) on delete restrict,
  reference        text,                     -- provider reference (dispute id, …)
  description      text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index platform_ledger_type_idx on public.platform_ledger_entries (entry_type, created_at desc);
create index platform_ledger_order_idx on public.platform_ledger_entries (order_id);

create trigger platform_ledger_entries_immutable
  before update or delete on public.platform_ledger_entries
  for each row execute function public.prevent_mutation();

create table public.payment_disputes (
  id                   uuid primary key default gen_random_uuid(),
  payment_id           uuid not null references public.payments (id) on delete restrict,
  order_id             uuid not null references public.orders (id) on delete restrict,
  provider_dispute_id  text not null unique,
  status               text not null,
  reason               text,
  currency             public.currency_code not null,
  amount_minor         public.money_minor not null,
  fee_minor            public.money_minor not null default 0,
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  updated_at           timestamptz not null default now()
);

create trigger payment_disputes_set_updated_at
  before update on public.payment_disputes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Ledger postings driven by payment state
-- -----------------------------------------------------------------------------
-- When an order becomes paid, each vendor order's earnings are owed to the
-- vendor and the commission is the platform's income.
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
  end if;
  return null;
end;
$$;

create trigger orders_post_paid_ledger
  after update of payment_status on public.orders
  for each row execute function public.post_paid_order_ledger();

-- A fee allocated to vendors after their earnings were posted (vendor-borne fees
-- recorded late) adjusts the vendor ledger by the difference.
create or replace function public.post_vendor_fee_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_fee_minor <> old.payment_fee_minor
     and exists (select 1 from public.vendor_ledger_entries e
                  where e.vendor_order_id = new.id and e.entry_type = 'order_earning') then
    insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, vendor_order_id, description)
    values (new.vendor_id, 'fee_adjustment', old.payment_fee_minor - new.payment_fee_minor, new.currency, new.id,
            'Payment processing fee for ' || new.vendor_order_number);
  end if;
  return null;
end;
$$;

create trigger vendor_orders_post_fee_adjustment
  after update of payment_fee_minor on public.vendor_orders
  for each row execute function public.post_vendor_fee_adjustment();

-- Processing fees borne by the platform are platform costs.
create or replace function public.post_processing_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if new.type = 'fee' and public.platform_setting_text('payments.fee_bearer', 'platform') = 'platform' then
    select order_id into v_order_id from public.payments where id = new.payment_id;
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, payment_id, description)
    values ('processing_fee', new.amount_minor, new.currency, v_order_id, new.payment_id, 'Payment processing fee');
  end if;
  return null;
end;
$$;

create trigger payment_transactions_post_fee
  after insert on public.payment_transactions
  for each row execute function public.post_processing_fee();

-- -----------------------------------------------------------------------------
-- Refunds
-- -----------------------------------------------------------------------------
-- Admin requests a refund of items (and possibly shipping) of one vendor order.
-- The application then submits it to the provider with the refund id as the
-- idempotency key. Returns what the provider call needs.
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
  v_vo          public.vendor_orders;
  v_order       public.orders;
  v_payment     public.payments;
  v_refund_id   uuid;
  v_req         record;
  v_item        public.order_items;
  v_in_flight   integer;
  v_items_total bigint := 0;
  v_commission  bigint := 0;
  v_line_comm   bigint;
  v_shipping    bigint := 0;
  v_ship_left   bigint;
  v_full        boolean;
  v_include     boolean;
  v_amount      bigint;
  v_refundable  bigint;
  v_liability   text := public.platform_setting_text('refunds.vendor_liability', 'none');
  v_vendor_debit bigint := 0;
  v_comm_rev    bigint := 0;
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
    -- Commission attributable to these units: cumulative split so partial refunds never exceed the line's commission.
    v_line_comm := (v_item.commission_minor * (v_item.refunded_quantity + v_in_flight + v_req.quantity)) / v_item.quantity
                 - (v_item.commission_minor * (v_item.refunded_quantity + v_in_flight)) / v_item.quantity;
    insert into public.refund_items (refund_id, order_item_id, quantity, amount_minor, commission_minor)
    values (v_refund_id, v_item.id, v_req.quantity, v_item.unit_price_minor * v_req.quantity, v_line_comm);
    v_items_total := v_items_total + v_item.unit_price_minor * v_req.quantity;
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

  select v_vo.shipping_minor - coalesce(sum(r.shipping_minor), 0) into v_ship_left
    from public.refunds r
   where r.vendor_order_id = v_vo.id and r.status in ('requested', 'approved', 'processing', 'completed') and r.id <> v_refund_id;
  v_include := coalesce(p_include_shipping, case
    when not v_full then public.platform_setting_text('refunds.shipping_on_partial', 'false') = 'true'
    when p_kind = 'cancellation' then public.platform_setting_text('refunds.shipping_on_full_cancellation', 'true') = 'true'
    when p_kind = 'return' then public.platform_setting_text('refunds.shipping_on_full_return', 'false') = 'true'
    else false end);
  if v_include then
    v_shipping := greatest(v_ship_left, 0);
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
    v_comm_rev := v_commission;
    v_vendor_debit := v_amount - v_commission;
  end if;

  update public.refunds
     set amount_minor = v_amount, shipping_minor = v_shipping,
         commission_reversed_minor = v_comm_rev, vendor_debit_minor = v_vendor_debit
   where id = v_refund_id;

  perform public.log_audit_event('refund.requested', 'refund', v_refund_id::text,
    jsonb_build_object('order_id', v_order.id, 'vendor_order_id', v_vo.id, 'amount_minor', v_amount,
                       'shipping_minor', v_shipping, 'kind', p_kind, 'vendor_liability', v_liability));

  return query select v_refund_id, v_amount, v_order.currency::text, v_payment.provider_payment_id, v_order.id;
end;
$$;

-- Applies a refund the provider reports as succeeded (idempotent).
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
  if v_refund.amount_minor - v_refund.vendor_debit_minor - v_refund.commission_reversed_minor > 0 then
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, vendor_order_id, payment_id, refund_id, description)
    values ('refund_loss', -(v_refund.amount_minor - v_refund.vendor_debit_minor - v_refund.commission_reversed_minor),
            v_refund.currency, v_refund.order_id, v_refund.vendor_order_id, v_refund.payment_id, v_refund.id,
            'Refund borne by the platform (' || v_refund.kind || ')');
  end if;

  perform public.log_audit_event('refund.completed', 'refund', v_refund.id::text,
    jsonb_build_object('order_id', v_refund.order_id, 'amount_minor', v_refund.amount_minor, 'provider_refund_id', v_refund.provider_refund_id));
  return 'completed';
end;
$$;

-- The provider accepted (or immediately settled) a submitted refund.
create or replace function public.mark_refund_submitted(p_refund_id uuid, p_provider_refund_id text, p_provider_status text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.refunds;
begin
  perform public.assert_platform_caller();
  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund % does not exist', p_refund_id using errcode = 'no_data_found';
  end if;
  update public.refunds
     set provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id), provider_status = p_provider_status
   where id = p_refund_id;
  if p_provider_status = 'succeeded' then
    return public.complete_refund_internal(p_refund_id);
  end if;
  if p_provider_status in ('failed', 'canceled') then
    update public.refunds set status = 'failed', failure_message = 'Refund ' || p_provider_status || ' by the provider'
     where id = p_refund_id and status <> 'completed';
    return 'failed';
  end if;
  return 'submitted';
end;
$$;

-- Provider webhook for a refund: finds it by provider id or by the Luxora refund
-- id in its metadata and applies the reported status. Unknown refunds (made in
-- the provider dashboard) are recorded as platform-borne external refunds.
create or replace function public.apply_provider_refund(
  p_provider_refund_id  text,
  p_refund_id           uuid,
  p_provider_payment_id text,
  p_status              text,
  p_amount_minor        bigint,
  p_currency            text,
  p_failure_reason      text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund  public.refunds;
  v_payment public.payments;
  v_id      uuid;
begin
  perform public.assert_platform_caller();
  select * into v_refund from public.refunds
   where provider_refund_id = p_provider_refund_id or (p_refund_id is not null and id = p_refund_id)
   order by (provider_refund_id = p_provider_refund_id) desc nulls last
   limit 1 for update;

  if found then
    update public.refunds
       set provider_refund_id = coalesce(provider_refund_id, p_provider_refund_id), provider_status = p_status
     where id = v_refund.id;
    if p_status = 'succeeded' then
      return public.complete_refund_internal(v_refund.id);
    end if;
    if p_status in ('failed', 'canceled') then
      if v_refund.status = 'completed' then
        -- A settled refund later failed at the bank: put the money back on the payment.
        update public.refunds set status = 'failed', failure_message = coalesce(p_failure_reason, 'Refund failed after settlement')
         where id = v_refund.id;
        update public.payments set refunded_minor = greatest(refunded_minor - v_refund.amount_minor, 0),
               status = case when refunded_minor - v_refund.amount_minor <= 0 then 'paid'::public.payment_status
                             else 'partially_refunded'::public.payment_status end
         where id = v_refund.payment_id;
        perform public.log_audit_event('refund.reversed', 'refund', v_refund.id::text,
          jsonb_build_object('provider_refund_id', p_provider_refund_id, 'reason', p_failure_reason));
        return 'reversed';
      end if;
      update public.refunds set status = 'failed', failure_message = coalesce(p_failure_reason, 'Refund ' || p_status)
       where id = v_refund.id;
      return 'failed';
    end if;
    return 'pending';
  end if;

  -- Not created by Luxora: record it so the books match the provider.
  if p_status not in ('succeeded', 'pending') then
    return 'ignored';
  end if;
  select * into v_payment from public.payments where provider = 'stripe' and provider_payment_id = p_provider_payment_id for update;
  if not found then
    return 'unknown_payment';
  end if;
  insert into public.refunds (order_id, payment_id, status, currency, amount_minor, reason, kind, provider_refund_id, provider_status)
  values (v_payment.order_id, v_payment.id, 'processing', upper(p_currency), p_amount_minor,
          'Refund issued outside Luxora (payment provider dashboard).', 'external', p_provider_refund_id, p_status)
  returning id into v_id;
  perform public.log_audit_event('refund.external', 'refund', v_id::text,
    jsonb_build_object('order_id', v_payment.order_id, 'amount_minor', p_amount_minor, 'provider_refund_id', p_provider_refund_id));
  if p_status = 'succeeded' then
    return public.complete_refund_internal(v_id);
  end if;
  return 'external_pending';
end;
$$;

-- The application could not submit a refund to the provider.
create or replace function public.fail_refund(p_refund_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_caller();
  update public.refunds set status = 'failed', failure_message = left(p_message, 500)
   where id = p_refund_id and status in ('requested', 'approved', 'processing');
end;
$$;

-- The late-payment refund from migration 0018 now also posts the platform loss.
create or replace function public.record_late_payment_refund(p_payment_id uuid, p_provider_refund_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_refund_id uuid;
begin
  perform public.assert_platform_caller();
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment % does not exist', p_payment_id using errcode = 'no_data_found';
  end if;
  if exists (select 1 from public.refunds r where r.provider_refund_id = p_provider_refund_id) then
    return 'duplicate';
  end if;
  update public.payments set status = 'refunded', refunded_minor = amount_minor where id = v_payment.id;
  insert into public.payment_transactions (payment_id, type, status, amount_minor, currency, provider_transaction_id)
  values (v_payment.id, 'refund', 'succeeded', -v_payment.amount_minor, v_payment.currency, p_provider_refund_id);
  insert into public.refunds (order_id, payment_id, status, currency, amount_minor, reason, kind, processed_at, provider_refund_id, provider_status)
  values (v_payment.order_id, v_payment.id, 'completed', v_payment.currency, v_payment.amount_minor,
          'Automatic refund: payment received after the order was closed.', 'late_payment', now(), p_provider_refund_id, 'submitted')
  returning id into v_refund_id;
  -- The money goes back in full; only the (unreturned) processing fee is a platform cost, posted with the fee.
  perform public.log_audit_event('payment.late_refunded', 'payment', v_payment.id::text,
    jsonb_build_object('order_id', v_payment.order_id, 'amount_minor', v_payment.amount_minor, 'provider_refund_id', p_provider_refund_id,
                       'refund_id', v_refund_id));
  return 'recorded';
end;
$$;

-- -----------------------------------------------------------------------------
-- Disputes (chargebacks): borne by the platform, recorded in its ledger
-- -----------------------------------------------------------------------------
create or replace function public.record_dispute(
  p_provider_dispute_id text,
  p_provider_payment_id text,
  p_status              text,
  p_reason              text,
  p_amount_minor        bigint,
  p_currency            text,
  p_fee_minor           bigint
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments;
  v_dispute public.payment_disputes;
  v_closed  boolean := p_status in ('won', 'lost', 'warning_closed', 'prevented');
begin
  perform public.assert_platform_caller();
  select * into v_payment from public.payments where provider = 'stripe' and provider_payment_id = p_provider_payment_id;
  if not found then
    return 'unknown_payment';
  end if;

  select * into v_dispute from public.payment_disputes where provider_dispute_id = p_provider_dispute_id for update;
  if not found then
    insert into public.payment_disputes (payment_id, order_id, provider_dispute_id, status, reason, currency, amount_minor, fee_minor)
    values (v_payment.id, v_payment.order_id, p_provider_dispute_id, p_status, p_reason, upper(p_currency), p_amount_minor,
            coalesce(p_fee_minor, 0))
    returning * into v_dispute;
    insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, payment_id, reference, description)
    values ('dispute_loss', -p_amount_minor, upper(p_currency), v_payment.order_id, v_payment.id, p_provider_dispute_id,
            'Disputed payment (' || coalesce(p_reason, 'unknown reason') || ')');
    if coalesce(p_fee_minor, 0) > 0 then
      insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, payment_id, reference, description)
      values ('dispute_fee', -p_fee_minor, upper(p_currency), v_payment.order_id, v_payment.id, p_provider_dispute_id, 'Dispute fee');
    end if;
    update public.orders set metadata = metadata || jsonb_build_object('disputed', true) where id = v_payment.order_id;
    perform public.log_audit_event('dispute.opened', 'order', v_payment.order_id::text,
      jsonb_build_object('provider_dispute_id', p_provider_dispute_id, 'amount_minor', p_amount_minor, 'reason', p_reason));
  end if;

  if v_closed and v_dispute.closed_at is null then
    update public.payment_disputes set status = p_status, closed_at = now() where id = v_dispute.id;
    if p_status = 'won' then
      insert into public.platform_ledger_entries (entry_type, amount_minor, currency, order_id, payment_id, reference, description)
      values ('dispute_recovered', v_dispute.amount_minor, v_dispute.currency, v_dispute.order_id, v_dispute.payment_id,
              p_provider_dispute_id, 'Dispute won: funds returned');
    end if;
    perform public.log_audit_event('dispute.closed', 'order', v_dispute.order_id::text,
      jsonb_build_object('provider_dispute_id', p_provider_dispute_id, 'status', p_status));
    return 'closed';
  end if;
  update public.payment_disputes set status = p_status where id = v_dispute.id and status <> p_status and closed_at is null;
  return 'recorded';
end;
$$;

-- -----------------------------------------------------------------------------
-- Vendor balances and payouts
-- -----------------------------------------------------------------------------
-- Payout hold in days (readable by the API roles; the setting itself is not public).
create or replace function public.payout_hold_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_setting_int('payouts.hold_days_after_delivery', 14);
$$;

-- Earnings become available `payouts.hold_days_after_delivery` days after the
-- vendor order is delivered; every other entry counts immediately.
create or replace view public.vendor_ledger_view
with (security_invoker = true)
as
select
  e.id, e.vendor_id, e.entry_type, e.amount_minor, e.currency, e.vendor_order_id, e.refund_id, e.payout_id,
  e.description, e.created_at,
  vo.vendor_order_number,
  case
    when e.entry_type in ('order_earning', 'fee_adjustment')
      then vo.delivered_at + make_interval(days => public.payout_hold_days())
    else e.created_at
  end as available_at
from public.vendor_ledger_entries e
left join public.vendor_orders vo on vo.id = e.vendor_order_id;

create or replace view public.vendor_balances
with (security_invoker = true)
as
select
  l.vendor_id,
  l.currency,
  coalesce(sum(l.amount_minor) filter (where l.available_at is not null and l.available_at <= now()), 0)::bigint as available_minor,
  coalesce(sum(l.amount_minor) filter (where l.available_at is null or l.available_at > now()), 0)::bigint as pending_minor,
  coalesce(-sum(l.amount_minor) filter (where l.entry_type in ('payout', 'payout_reversal')), 0)::bigint as paid_out_minor,
  coalesce(sum(l.amount_minor) filter (where l.entry_type in ('order_earning', 'fee_adjustment')), 0)::bigint as lifetime_earnings_minor
from public.vendor_ledger_view l
group by l.vendor_id, l.currency;

-- Admin records a payout made outside Stripe (bank transfer, Wise, …).
-- The amount is reserved in the ledger immediately and cannot exceed the
-- vendor's available balance.
create or replace function public.record_vendor_payout(
  p_vendor_id    uuid,
  p_amount_minor bigint,
  p_method       text,
  p_reference    text,
  p_notes        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency  text := public.platform_setting_text('platform.default_currency', 'USD');
  v_available bigint;
  v_payout_id uuid;
begin
  if not public.is_admin() then
    raise exception 'only administrators can record payouts' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'The payout amount must be greater than zero.';
  end if;
  if p_method is null or char_length(trim(p_method)) < 2 or char_length(p_method) > 60 then
    raise exception 'Describe the payout method (e.g. bank transfer).';
  end if;
  if p_reference is null or char_length(trim(p_reference)) < 2 or char_length(p_reference) > 120 then
    raise exception 'Enter the transfer reference.';
  end if;
  -- Serialise payouts per vendor.
  perform 1 from public.vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'Vendor not found.' using errcode = 'no_data_found';
  end if;
  select coalesce(available_minor, 0) into v_available from public.vendor_balances
   where vendor_id = p_vendor_id and currency = v_currency;
  if p_amount_minor > coalesce(v_available, 0) then
    raise exception 'The payout exceeds the vendor''s available balance.';
  end if;

  insert into public.payouts (vendor_id, status, currency, period_start, period_end, gross_minor, net_minor, method, reference,
                              paid_at, processed_by, notes)
  values (p_vendor_id, 'paid', v_currency,
          least(coalesce((select min(created_at) from public.vendor_ledger_entries where vendor_id = p_vendor_id), now()),
                now() - interval '1 second'),
          now(), p_amount_minor, p_amount_minor, trim(p_method), trim(p_reference), now(), public.current_profile_id(),
          nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_payout_id;
  insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, payout_id, description, created_by)
  values (p_vendor_id, 'payout', -p_amount_minor, v_currency, v_payout_id, 'Payout via ' || trim(p_method), public.current_profile_id());
  perform public.log_audit_event('payout.recorded', 'payout', v_payout_id::text,
    jsonb_build_object('vendor_id', p_vendor_id, 'amount_minor', p_amount_minor, 'method', p_method, 'reference', p_reference));
  return v_payout_id;
end;
$$;

-- Admin reverses a recorded payout that did not reach the vendor.
create or replace function public.reverse_vendor_payout(p_payout_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts;
begin
  if not public.is_admin() then
    raise exception 'only administrators can reverse payouts' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Give a reason for reversing the payout.';
  end if;
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout not found.' using errcode = 'no_data_found';
  end if;
  if v_payout.status <> 'paid' then
    raise exception 'Only paid payouts can be reversed.';
  end if;
  update public.payouts set status = 'failed', notes = trim(coalesce(notes || E'\n', '') || 'Reversed: ' || trim(p_reason))
   where id = p_payout_id;
  insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, payout_id, description, created_by)
  values (v_payout.vendor_id, 'payout_reversal', v_payout.net_minor, v_payout.currency, p_payout_id,
          'Payout reversed: ' || trim(p_reason), public.current_profile_id());
  perform public.log_audit_event('payout.reversed', 'payout', p_payout_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

-- Admin adjustment of a vendor balance (with a mandatory reason).
create or replace function public.adjust_vendor_balance(p_vendor_id uuid, p_amount_minor bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only administrators can adjust balances' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_minor is null or p_amount_minor = 0 then
    raise exception 'The adjustment cannot be zero.';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Give a reason for the adjustment.';
  end if;
  insert into public.vendor_ledger_entries (vendor_id, entry_type, amount_minor, currency, description, created_by)
  values (p_vendor_id, 'adjustment', p_amount_minor, public.platform_setting_text('platform.default_currency', 'USD'),
          trim(p_reason), public.current_profile_id());
  perform public.log_audit_event('ledger.adjustment', 'vendor', p_vendor_id::text,
    jsonb_build_object('amount_minor', p_amount_minor, 'reason', p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.refund_items enable row level security;
alter table public.vendor_ledger_entries enable row level security;
alter table public.platform_ledger_entries enable row level security;
alter table public.payment_disputes enable row level security;

create policy refund_items_select_customer on public.refund_items
  for select to authenticated
  using (exists (select 1 from public.refunds r where r.id = refund_id
                  and (select public.order_customer_id(r.order_id)) = (select public.current_profile_id())));
create policy refund_items_select_vendor on public.refund_items
  for select to authenticated
  using (exists (select 1 from public.order_items oi where oi.id = order_item_id and (select public.is_vendor_member(oi.vendor_id))));
create policy refund_items_select_admin on public.refund_items
  for select to authenticated using ((select public.is_admin()));

create policy vendor_ledger_select_vendor on public.vendor_ledger_entries
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy vendor_ledger_select_admin on public.vendor_ledger_entries
  for select to authenticated using ((select public.is_admin()));

create policy platform_ledger_select_admin on public.platform_ledger_entries
  for select to authenticated using ((select public.is_admin()));
create policy payment_disputes_select_admin on public.payment_disputes
  for select to authenticated using ((select public.is_admin()));

-- Finance tables become read-only for API roles: functions write them.
drop policy refunds_admin_all on public.refunds;
create policy refunds_select_admin on public.refunds
  for select to authenticated using ((select public.is_admin()));
drop policy payouts_admin_all on public.payouts;
create policy payouts_select_admin on public.payouts
  for select to authenticated using ((select public.is_admin()));
drop policy payout_items_admin_all on public.payout_items;
create policy payout_items_select_admin on public.payout_items
  for select to authenticated using ((select public.is_admin()));
drop policy commissions_admin_all on public.commissions;
create policy commissions_select_admin on public.commissions
  for select to authenticated using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.refund_items, public.vendor_ledger_entries, public.platform_ledger_entries, public.payment_disputes
  from anon, authenticated;
revoke all on public.vendor_ledger_view, public.vendor_balances from anon, authenticated;
revoke insert, update, delete on public.refunds, public.payouts, public.payout_items, public.commissions from authenticated;

grant select on public.refund_items, public.vendor_ledger_entries, public.platform_ledger_entries, public.payment_disputes
  to authenticated;
grant select on public.vendor_ledger_view, public.vendor_balances to authenticated;
grant all on public.refund_items, public.vendor_ledger_entries, public.platform_ledger_entries, public.payment_disputes,
  public.vendor_ledger_view, public.vendor_balances to service_role;

revoke all on function
  public.post_paid_order_ledger(),
  public.post_vendor_fee_adjustment(),
  public.post_processing_fee(),
  public.complete_refund_internal(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.request_refund(uuid, jsonb, public.refund_kind, text, boolean),
  public.mark_refund_submitted(uuid, text, text),
  public.apply_provider_refund(text, uuid, text, text, bigint, text, text),
  public.fail_refund(uuid, text),
  public.record_dispute(text, text, text, text, bigint, text, bigint),
  public.record_vendor_payout(uuid, bigint, text, text, text),
  public.reverse_vendor_payout(uuid, text),
  public.adjust_vendor_balance(uuid, bigint, text)
from public, anon;

grant execute on function public.payout_hold_days() to authenticated, service_role;

-- Administrators (checked inside each function).
grant execute on function
  public.request_refund(uuid, jsonb, public.refund_kind, text, boolean),
  public.record_vendor_payout(uuid, bigint, text, text, text),
  public.reverse_vendor_payout(uuid, text),
  public.adjust_vendor_balance(uuid, bigint, text)
to authenticated;

-- Platform only (provider webhooks / server).
revoke execute on function
  public.mark_refund_submitted(uuid, text, text),
  public.apply_provider_refund(text, uuid, text, text, bigint, text, text),
  public.fail_refund(uuid, text),
  public.record_dispute(text, text, text, text, bigint, text, bigint)
from authenticated;
grant execute on function
  public.mark_refund_submitted(uuid, text, text),
  public.apply_provider_refund(text, uuid, text, text, bigint, text, text),
  public.fail_refund(uuid, text),
  public.record_dispute(text, text, text, text, bigint, text, bigint),
  public.record_late_payment_refund(uuid, text)
to service_role;
