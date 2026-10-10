-- =============================================================================
-- Migration 0025 (Phase 7): operations and insights.
-- -----------------------------------------------------------------------------
-- Additive: no change to checkout, payments, refunds, returns, reviews,
-- promotions, ledgers or the commission resolver. Contents:
--
-- 1. Commission rules are written only through audited functions
--    (save_commission_rule / set_commission_rule_active). Overlapping active
--    rules for the same target are refused, so resolve_commission_rate_bps()
--    (unchanged) never has to choose between two rules. Orders keep the rate
--    snapshot taken when they were placed. explain_commission_rate() mirrors
--    the resolver's precedence for an admin preview:
--      vendor rule → vendor override (vendors.commission_rate_bps) →
--      for each category up the tree: category rule, then the category's own
--      rate → global rule → platform setting commission.default_bps.
-- 2. Customer accounts are suspended/reactivated with set_account_status()
--    (admins, customer accounts only, reason required, audited). Direct admin
--    status edits (allowed since Phase 1) remain possible but are now audited.
-- 3. Reporting functions (admins; vendor members for their own vendor), UTC
--    date ranges of at most 366 days. Definitions:
--      paid order       confirmed_at set (only confirm_order_payment sets it)
--                       and payment_status paid / partially_refunded / refunded;
--                       dated by confirmed_at
--      gross sales      orders.total_minor of paid orders (after discounts,
--                       including shipping)
--      refunds          completed refunds (processed_at in the range) of paid
--                       orders — late-payment refunds of never-paid orders are
--                       excluded
--      net sales        gross sales − refunds (same range; can be negative)
--      units            order_items.quantity of paid orders
--      AOV              gross sales ÷ paid orders (rounded half-up)
--      new customers    customers whose first paid order is in the range
--      return rate      units in return requests opened in the range (not
--                       cancelled or rejected) ÷ units sold in the range
--      Luxora revenue   sum of platform_ledger_entries created in the range
--                       (the ledger already nets commission, fees, refund
--                       losses, disputes and Luxora-funded promotions)
--      vendor sales     vendor_orders.total + platform_funded (what the vendor
--                       sold, before Luxora-funded discounts; = earnings +
--                       commission + fee)
--      vendor earnings  vendor ledger order_earning + fee_adjustment +
--                       refund_debit created in the range (payouts and manual
--                       adjustments excluded)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Commission rules
-- -----------------------------------------------------------------------------
-- Two rules for the same target overlap when both are active and their windows
-- ([starts_at, ends_at), open-ended when ends_at is null) intersect.
create or replace function public.commission_rule_overlaps_internal(
  p_rule_id     uuid,
  p_scope       public.commission_rule_scope,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz
)
returns uuid
language sql
stable
set search_path = public
as $$
  select r.id from public.commission_rules r
   where r.is_active
     and r.id is distinct from p_rule_id
     and r.scope = p_scope
     and r.vendor_id is not distinct from p_vendor_id
     and r.category_id is not distinct from p_category_id
     and r.starts_at < coalesce(p_ends_at, 'infinity'::timestamptz)
     and coalesce(r.ends_at, 'infinity'::timestamptz) > p_starts_at
   limit 1;
$$;

create or replace function public.save_commission_rule(
  p_rule_id     uuid,
  p_scope       public.commission_rule_scope,
  p_vendor_id   uuid,
  p_category_id uuid,
  p_rate_bps    integer,
  p_name        text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.commission_rules;
  v_starts   timestamptz := coalesce(p_starts_at, now());
  v_clash    uuid;
  v_id       uuid;
begin
  if not public.is_admin() then
    raise exception 'only administrators can manage commission rules' using errcode = 'insufficient_privilege';
  end if;
  if p_scope is null then
    raise exception 'Choose global, category or vendor.';
  end if;
  if p_scope = 'global' and (p_vendor_id is not null or p_category_id is not null) then
    raise exception 'A global rule has no vendor or category.';
  end if;
  if p_scope = 'vendor' and (p_vendor_id is null or p_category_id is not null) then
    raise exception 'Choose the vendor this rule applies to.';
  end if;
  if p_scope = 'category' and (p_category_id is null or p_vendor_id is not null) then
    raise exception 'Choose the category this rule applies to.';
  end if;
  if p_vendor_id is not null and not exists (select 1 from public.vendors where id = p_vendor_id) then
    raise exception 'Vendor not found.' using errcode = 'no_data_found';
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id = p_category_id) then
    raise exception 'Category not found.' using errcode = 'no_data_found';
  end if;
  if p_rate_bps is null or p_rate_bps not between 0 and 10000 then
    raise exception 'Enter a rate between 0%% and 100%%.';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'Give the rule a name (2–120 characters).';
  end if;
  if p_ends_at is not null and p_ends_at <= v_starts then
    raise exception 'The end must be after the start.';
  end if;

  -- One writer per target at a time, so two saves cannot both pass the overlap check.
  perform pg_advisory_xact_lock(hashtext('commission_rule:' || p_scope || ':' || coalesce(p_vendor_id::text, '') || ':' || coalesce(p_category_id::text, '')));

  if p_rule_id is not null then
    select * into v_existing from public.commission_rules where id = p_rule_id for update;
    if not found then
      raise exception 'Commission rule not found.' using errcode = 'no_data_found';
    end if;
    if v_existing.scope <> p_scope or v_existing.vendor_id is distinct from p_vendor_id
       or v_existing.category_id is distinct from p_category_id then
      raise exception 'A rule''s target cannot change. Deactivate it and create a new rule instead.';
    end if;
  end if;

  if coalesce(v_existing.is_active, true) then
    v_clash := public.commission_rule_overlaps_internal(p_rule_id, p_scope, p_vendor_id, p_category_id, v_starts, p_ends_at);
    if v_clash is not null then
      raise exception 'Another active rule for the same target overlaps these dates. Change the dates or deactivate that rule first.';
    end if;
  end if;

  if p_rule_id is null then
    insert into public.commission_rules (scope, vendor_id, category_id, rate_bps, name, is_active, starts_at, ends_at, created_by)
    values (p_scope, p_vendor_id, p_category_id, p_rate_bps, trim(p_name), true, v_starts, p_ends_at, public.current_profile_id())
    returning id into v_id;
    perform public.log_audit_event('commission.rule_created', 'commission_rule', v_id::text,
      jsonb_build_object('scope', p_scope, 'vendor_id', p_vendor_id, 'category_id', p_category_id,
                         'rate_bps', p_rate_bps, 'starts_at', v_starts, 'ends_at', p_ends_at));
  else
    update public.commission_rules
       set rate_bps = p_rate_bps, name = trim(p_name), starts_at = v_starts, ends_at = p_ends_at
     where id = p_rule_id;
    v_id := p_rule_id;
    perform public.log_audit_event('commission.rule_updated', 'commission_rule', v_id::text,
      jsonb_build_object('scope', p_scope, 'vendor_id', p_vendor_id, 'category_id', p_category_id,
                         'from', jsonb_build_object('rate_bps', v_existing.rate_bps, 'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at),
                         'to', jsonb_build_object('rate_bps', p_rate_bps, 'starts_at', v_starts, 'ends_at', p_ends_at)));
  end if;
  return v_id;
end;
$$;

create or replace function public.set_commission_rule_active(p_rule_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.commission_rules;
begin
  if not public.is_admin() then
    raise exception 'only administrators can manage commission rules' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rule from public.commission_rules where id = p_rule_id;
  if not found then
    raise exception 'Commission rule not found.' using errcode = 'no_data_found';
  end if;
  perform pg_advisory_xact_lock(hashtext('commission_rule:' || v_rule.scope || ':' || coalesce(v_rule.vendor_id::text, '') || ':' || coalesce(v_rule.category_id::text, '')));
  select * into v_rule from public.commission_rules where id = p_rule_id for update;
  if v_rule.is_active = p_active then
    return;
  end if;
  if p_active and public.commission_rule_overlaps_internal(v_rule.id, v_rule.scope, v_rule.vendor_id, v_rule.category_id,
                                                           v_rule.starts_at, v_rule.ends_at) is not null then
    raise exception 'Another active rule for the same target overlaps these dates. Change the dates or deactivate that rule first.';
  end if;
  update public.commission_rules set is_active = p_active where id = v_rule.id;
  perform public.log_audit_event(case when p_active then 'commission.rule_activated' else 'commission.rule_deactivated' end,
    'commission_rule', v_rule.id::text,
    jsonb_build_object('scope', v_rule.scope, 'vendor_id', v_rule.vendor_id, 'category_id', v_rule.category_id, 'rate_bps', v_rule.rate_bps));
end;
$$;

-- Admin preview: the rate resolve_commission_rate_bps() would apply right now,
-- and which level of the precedence supplied it. Mirrors the resolver.
create or replace function public.explain_commission_rate(p_vendor_id uuid, p_category_id uuid default null)
returns table (rate_bps integer, source text, rule_id uuid, category_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_rate  integer;
  v_rule  uuid;
  v_cat   uuid := p_category_id;
  v_next  uuid;
  v_depth integer := 0;
begin
  if not public.is_admin() then
    raise exception 'only administrators can preview commission' using errcode = 'insufficient_privilege';
  end if;

  select r.rate_bps, r.id into v_rate, v_rule from public.commission_rules r
   where r.scope = 'vendor' and r.vendor_id = p_vendor_id and r.is_active
     and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
   order by r.starts_at desc limit 1;
  if v_rate is not null then
    return query select v_rate, 'vendor_rule'::text, v_rule, null::uuid;
    return;
  end if;

  select v.commission_rate_bps into v_rate from public.vendors v where v.id = p_vendor_id;
  if v_rate is not null then
    return query select v_rate, 'vendor_override'::text, null::uuid, null::uuid;
    return;
  end if;

  while v_cat is not null and v_depth < 20 loop
    select r.rate_bps, r.id into v_rate, v_rule from public.commission_rules r
     where r.scope = 'category' and r.category_id = v_cat and r.is_active
       and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
     order by r.starts_at desc limit 1;
    if v_rate is not null then
      return query select v_rate, 'category_rule'::text, v_rule, v_cat;
      return;
    end if;
    select c.commission_rate_bps, c.parent_id into v_rate, v_next from public.categories c where c.id = v_cat;
    if v_rate is not null then
      return query select v_rate, 'category_rate'::text, null::uuid, v_cat;
      return;
    end if;
    v_cat := v_next;
    v_depth := v_depth + 1;
  end loop;

  select r.rate_bps, r.id into v_rate, v_rule from public.commission_rules r
   where r.scope = 'global' and r.is_active and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now())
   order by r.starts_at desc limit 1;
  if v_rate is not null then
    return query select v_rate, 'global_rule'::text, v_rule, null::uuid;
    return;
  end if;

  select (s.value #>> '{}')::integer into v_rate from public.platform_settings s where s.key = 'commission.default_bps';
  return query select coalesce(v_rate, 0), 'platform_default'::text, null::uuid, null::uuid;
end;
$$;

drop policy commission_rules_admin_all on public.commission_rules;
create policy commission_rules_select_admin on public.commission_rules
  for select to authenticated using ((select public.is_admin()));
revoke insert, update, delete on public.commission_rules from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Customer account status
-- -----------------------------------------------------------------------------
create or replace function public.set_account_status(p_profile_id uuid, p_status public.account_status, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
begin
  if not public.is_admin() then
    raise exception 'only administrators can change account status' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'Choose suspend or reactivate.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Give a reason (3–500 characters).';
  end if;
  select * into v_profile from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Customer not found.' using errcode = 'no_data_found';
  end if;
  -- Vendors keep their own lifecycle (set_vendor_status); staff accounts are out of scope.
  if v_profile.role <> 'customer' then
    raise exception 'Only customer accounts can be suspended here.';
  end if;
  if v_profile.status = p_status then
    raise exception 'This account is already %.', p_status;
  end if;
  update public.profiles set status = p_status where id = v_profile.id;
  perform public.log_audit_event(case when p_status = 'suspended' then 'account.suspended' else 'account.reactivated' end,
    'profile', v_profile.id::text,
    jsonb_build_object('from', v_profile.status, 'to', p_status, 'reason', left(trim(p_reason), 500)));
end;
$$;

-- Phase 1 lets admins edit profiles directly; such status changes are now audited
-- too (set_account_status logs its own entry and runs in a trusted context).
create or replace function public.audit_direct_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status and not public.in_trusted_context() then
    perform public.log_audit_event('account.status_changed', 'profile', new.id::text,
      jsonb_build_object('from', old.status, 'to', new.status, 'via', 'direct_update'));
  end if;
  return null;
end;
$$;

create trigger profiles_audit_status_change
  after update of status on public.profiles
  for each row execute function public.audit_direct_status_change();

-- -----------------------------------------------------------------------------
-- 3. Reporting
-- -----------------------------------------------------------------------------
-- UTC date range [from 00:00, to + 1 day 00:00), at most 366 days.
create or replace function public.report_range_internal(p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
immutable
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a valid date range.';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception 'Reports cover at most 366 days.';
  end if;
  return query select (p_from::timestamp at time zone 'UTC'), ((p_to + 1)::timestamp at time zone 'UTC');
end;
$$;

create or replace function public.assert_report_access_internal(p_vendor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_vendor_id is null then
    if not public.is_admin() then
      raise exception 'only administrators can view platform reports' using errcode = 'insufficient_privilege';
    end if;
  elsif not (public.is_admin() or public.is_vendor_member(p_vendor_id)) then
    raise exception 'you can only view reports for your own store' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Paid orders (see the definition above) — internal, not granted.
create or replace view public.report_paid_orders as
select o.id, o.customer_id, o.confirmed_at, o.total_minor, o.coupon_id
  from public.orders o
 where o.confirmed_at is not null
   and o.payment_status in ('paid', 'partially_refunded', 'refunded');

create or replace function public.admin_sales_summary(p_from date, p_to date)
returns table (
  gross_sales_minor          bigint,
  refunds_minor              bigint,
  net_sales_minor            bigint,
  paid_orders                integer,
  units                      bigint,
  average_order_value_minor  bigint,
  new_customers              integer,
  returned_units             bigint,
  luxora_net_revenue_minor   bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_gross bigint;
  v_orders integer;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;

  select coalesce(sum(o.total_minor), 0)::bigint, count(*)::integer into v_gross, v_orders
    from public.report_paid_orders o where o.confirmed_at >= v_from and o.confirmed_at < v_to;

  return query
  with refunds as (
    select coalesce(sum(f.amount_minor), 0)::bigint as amount
      from public.refunds f
      join public.report_paid_orders o on o.id = f.order_id
     where f.status = 'completed' and f.processed_at >= v_from and f.processed_at < v_to
  ), units as (
    select coalesce(sum(oi.quantity), 0)::bigint as n
      from public.order_items oi
      join public.report_paid_orders o on o.id = oi.order_id
     where o.confirmed_at >= v_from and o.confirmed_at < v_to
  ), firsts as (
    select o.customer_id, min(o.confirmed_at) as first_paid
      from public.report_paid_orders o group by o.customer_id
  ), returned as (
    select coalesce(sum(ri.quantity), 0)::bigint as n
      from public.return_request_items ri
      join public.return_requests rr on rr.id = ri.return_request_id
     where rr.requested_at >= v_from and rr.requested_at < v_to and rr.status not in ('cancelled', 'rejected')
  ), revenue as (
    select coalesce(sum(e.amount_minor), 0)::bigint as amount
      from public.platform_ledger_entries e
     where e.created_at >= v_from and e.created_at < v_to
  )
  select v_gross,
         (select amount from refunds),
         v_gross - (select amount from refunds),
         v_orders,
         (select n from units),
         case when v_orders > 0 then round(v_gross::numeric / v_orders)::bigint else 0::bigint end,
         (select count(*)::integer from firsts f where f.first_paid >= v_from and f.first_paid < v_to),
         (select n from returned),
         (select amount from revenue);
end;
$$;

-- Luxora's ledger result by entry type (sums to luxora_net_revenue_minor).
create or replace function public.admin_revenue_breakdown(p_from date, p_to date)
returns table (entry_type text, amount_minor bigint, entries integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  select e.entry_type::text, sum(e.amount_minor)::bigint, count(*)::integer
    from public.platform_ledger_entries e
   where e.created_at >= v_from and e.created_at < v_to
   group by e.entry_type
   order by e.entry_type::text;
end;
$$;

create or replace function public.admin_sales_daily(p_from date, p_to date)
returns table (day date, gross_sales_minor bigint, refunds_minor bigint, paid_orders integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  with days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ), sales as (
    select (o.confirmed_at at time zone 'UTC')::date as day, sum(o.total_minor)::bigint as gross, count(*)::integer as n
      from public.report_paid_orders o
     where o.confirmed_at >= v_from and o.confirmed_at < v_to
     group by 1
  ), refunds as (
    select (f.processed_at at time zone 'UTC')::date as day, sum(f.amount_minor)::bigint as amount
      from public.refunds f
      join public.report_paid_orders o on o.id = f.order_id
     where f.status = 'completed' and f.processed_at >= v_from and f.processed_at < v_to
     group by 1
  )
  select d.day, coalesce(s.gross, 0)::bigint, coalesce(f.amount, 0)::bigint, coalesce(s.n, 0)::integer
    from days d
    left join sales s on s.day = d.day
    left join refunds f on f.day = d.day
   order by d.day;
end;
$$;

create or replace function public.admin_top_vendors(p_from date, p_to date, p_limit integer default 10)
returns table (vendor_id uuid, vendor_name text, paid_orders integer, sales_minor bigint, commission_minor bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  select vo.vendor_id, coalesce(min(s.name), min(v.display_name)), count(*)::integer,
         sum(vo.total_minor)::bigint, sum(vo.commission_minor)::bigint
    from public.vendor_orders vo
    join public.report_paid_orders o on o.id = vo.order_id
    join public.vendors v on v.id = vo.vendor_id
    left join public.stores s on s.vendor_id = v.id
   where o.confirmed_at >= v_from and o.confirmed_at < v_to
   group by vo.vendor_id
   order by 4 desc, 2
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

create or replace function public.admin_top_products(p_from date, p_to date, p_limit integer default 10)
returns table (product_id uuid, product_name text, vendor_name text, units bigint, sales_minor bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  select oi.product_id, max(oi.product_name), coalesce(min(s.name), min(v.display_name)),
         sum(oi.quantity)::bigint, sum(oi.total_minor)::bigint
    from public.order_items oi
    join public.report_paid_orders o on o.id = oi.order_id
    join public.vendors v on v.id = oi.vendor_id
    left join public.stores s on s.vendor_id = v.id
   where o.confirmed_at >= v_from and o.confirmed_at < v_to and oi.product_id is not null
   group by oi.product_id
   order by 5 desc, 2
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- Discounts on paid orders by who funded them.
create or replace function public.admin_discount_usage(p_from date, p_to date)
returns table (
  orders_with_code          integer,
  luxora_funded_minor       bigint,
  vendor_code_minor         bigint,
  flash_sale_savings_minor  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(null);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  select
    (select count(*)::integer from public.report_paid_orders o
      where o.confirmed_at >= v_from and o.confirmed_at < v_to and o.coupon_id is not null),
    (select coalesce(sum(vo.platform_funded_minor), 0)::bigint
       from public.vendor_orders vo join public.report_paid_orders o on o.id = vo.order_id
      where o.confirmed_at >= v_from and o.confirmed_at < v_to),
    (select coalesce(sum(vo.discount_minor + vo.shipping_discount_minor - vo.platform_funded_minor), 0)::bigint
       from public.vendor_orders vo join public.report_paid_orders o on o.id = vo.order_id
      where o.confirmed_at >= v_from and o.confirmed_at < v_to),
    (select coalesce(sum((oi.list_price_minor - oi.unit_price_minor) * oi.quantity), 0)::bigint
       from public.order_items oi join public.report_paid_orders o on o.id = oi.order_id
      where o.confirmed_at >= v_from and o.confirmed_at < v_to
        and oi.flash_sale_item_id is not null and oi.list_price_minor > oi.unit_price_minor);
end;
$$;

-- Vendor-scoped summary (vendor members and admins).
create or replace function public.vendor_sales_summary(p_vendor_id uuid, p_from date, p_to date)
returns table (
  sales_minor           bigint,
  customer_paid_minor   bigint,
  paid_orders           integer,
  units                 bigint,
  commission_minor      bigint,
  earnings_minor        bigint,
  refunds_minor         bigint,
  return_requests       integer,
  returned_units        bigint,
  review_count          integer,
  rating_sum            bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(p_vendor_id);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  with sold as (
    select vo.id, vo.total_minor, vo.platform_funded_minor, vo.commission_minor
      from public.vendor_orders vo
      join public.report_paid_orders o on o.id = vo.order_id
     where vo.vendor_id = p_vendor_id and o.confirmed_at >= v_from and o.confirmed_at < v_to
  ), returns_opened as (
    select rr.id, coalesce((select sum(ri.quantity) from public.return_request_items ri where ri.return_request_id = rr.id), 0) as units
      from public.return_requests rr
     where rr.vendor_id = p_vendor_id and rr.requested_at >= v_from and rr.requested_at < v_to
       and rr.status not in ('cancelled', 'rejected')
  )
  select
    (select coalesce(sum(s.total_minor + s.platform_funded_minor), 0)::bigint from sold s),
    (select coalesce(sum(s.total_minor), 0)::bigint from sold s),
    (select count(*)::integer from sold),
    (select coalesce(sum(oi.quantity), 0)::bigint from public.order_items oi where oi.vendor_order_id in (select s.id from sold s)),
    (select coalesce(sum(s.commission_minor), 0)::bigint from sold s),
    (select coalesce(sum(e.amount_minor), 0)::bigint from public.vendor_ledger_entries e
      where e.vendor_id = p_vendor_id and e.entry_type in ('order_earning', 'fee_adjustment', 'refund_debit')
        and e.created_at >= v_from and e.created_at < v_to),
    (select coalesce(sum(f.amount_minor), 0)::bigint from public.refunds f
       join public.vendor_orders vo on vo.id = f.vendor_order_id
       join public.report_paid_orders o on o.id = vo.order_id
      where vo.vendor_id = p_vendor_id and f.status = 'completed' and f.processed_at >= v_from and f.processed_at < v_to),
    (select count(*)::integer from returns_opened),
    (select coalesce(sum(r.units), 0)::bigint from returns_opened r),
    (select coalesce(sum(st.review_count), 0)::integer from public.product_review_stats st
       join public.products p on p.id = st.product_id where p.vendor_id = p_vendor_id),
    (select coalesce(sum(st.rating_sum), 0)::bigint from public.product_review_stats st
       join public.products p on p.id = st.product_id where p.vendor_id = p_vendor_id);
end;
$$;

create or replace function public.vendor_sales_daily(p_vendor_id uuid, p_from date, p_to date)
returns table (day date, sales_minor bigint, paid_orders integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(p_vendor_id);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  with days as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ), sales as (
    select (o.confirmed_at at time zone 'UTC')::date as day,
           sum(vo.total_minor + vo.platform_funded_minor)::bigint as amount, count(*)::integer as n
      from public.vendor_orders vo
      join public.report_paid_orders o on o.id = vo.order_id
     where vo.vendor_id = p_vendor_id and o.confirmed_at >= v_from and o.confirmed_at < v_to
     group by 1
  )
  select d.day, coalesce(s.amount, 0)::bigint, coalesce(s.n, 0)::integer
    from days d left join sales s on s.day = d.day
   order by d.day;
end;
$$;

create or replace function public.vendor_top_products(p_vendor_id uuid, p_from date, p_to date, p_limit integer default 10)
returns table (product_id uuid, product_name text, units bigint, sales_minor bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_from timestamptz;
  v_to   timestamptz;
begin
  perform public.assert_report_access_internal(p_vendor_id);
  select r.starts_at, r.ends_at into v_from, v_to from public.report_range_internal(p_from, p_to) r;
  return query
  select oi.product_id, max(oi.product_name), sum(oi.quantity)::bigint,
         sum(oi.total_minor + oi.platform_discount_minor)::bigint
    from public.order_items oi
    join public.report_paid_orders o on o.id = oi.order_id
   where oi.vendor_id = p_vendor_id and o.confirmed_at >= v_from and o.confirmed_at < v_to and oi.product_id is not null
   group by oi.product_id
   order by 4 desc, 2
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

-- Customers of one vendor (all time): only name and city/country from the
-- latest shipping address, order count, spend with this vendor net of
-- completed refunds, and last order date. No email, phone or profile id: the
-- row key is a per-vendor hash.
create or replace function public.vendor_customers(
  p_vendor_id uuid,
  p_search    text default null,
  p_limit     integer default 25,
  p_offset    integer default 0
)
returns table (
  customer_key   text,
  customer_name  text,
  city           text,
  country_code   text,
  paid_orders    integer,
  spent_minor    bigint,
  last_order_at  timestamptz,
  total_count    integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
begin
  perform public.assert_report_access_internal(p_vendor_id);
  return query
  with mine as (
    select o.customer_id, vo.id as vendor_order_id, vo.total_minor, o.confirmed_at, vo.shipping_address
      from public.vendor_orders vo
      join public.report_paid_orders o on o.id = vo.order_id
     where vo.vendor_id = p_vendor_id
  ), refunded as (
    select m.customer_id, sum(f.amount_minor)::bigint as amount
      from public.refunds f join mine m on m.vendor_order_id = f.vendor_order_id
     where f.status = 'completed'
     group by m.customer_id
  ), per_customer as (
    select m.customer_id, count(*)::integer as n, sum(m.total_minor)::bigint as paid, max(m.confirmed_at) as last_at
      from mine m group by m.customer_id
  ), latest as (
    select distinct on (m.customer_id) m.customer_id, m.shipping_address
      from mine m order by m.customer_id, m.confirmed_at desc
  ), rows as (
    select md5(p.customer_id::text || ':' || p_vendor_id::text) as key,
           nullif(trim(l.shipping_address ->> 'full_name'), '') as name,
           nullif(trim(l.shipping_address ->> 'city'), '') as city,
           nullif(trim(l.shipping_address ->> 'country_code'), '') as country,
           p.n, p.paid - coalesce(r.amount, 0) as spent, p.last_at
      from per_customer p
      join latest l on l.customer_id = p.customer_id
      left join refunded r on r.customer_id = p.customer_id
  ), filtered as (
    select * from rows x
     where p_search is null or trim(p_search) = '' or x.name ilike '%' || trim(p_search) || '%'
  )
  select f.key, f.name, f.city, f.country, f.n, f.spent, f.last_at, (count(*) over ())::integer
    from filtered f
   order by f.last_at desc, f.key
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Admin customer directory (customer accounts): email from auth, paid orders,
-- spend net of completed refunds, return requests and join date.
create or replace function public.admin_customers(
  p_search     text default null,
  p_status     public.account_status default null,
  p_profile_id uuid default null,
  p_limit      integer default 25,
  p_offset     integer default 0
)
returns table (
  profile_id    uuid,
  full_name     text,
  email         text,
  status        public.account_status,
  joined_at     timestamptz,
  paid_orders   integer,
  spent_minor   bigint,
  return_requests integer,
  total_count   integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
begin
  perform public.assert_report_access_internal(null);
  return query
  with base as (
    select p.id, p.full_name, u.email::text as email, p.status, p.created_at
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where p.role = 'customer'
       and (p_profile_id is null or p.id = p_profile_id)
       and (p_status is null or p.status = p_status)
       and (p_search is null or trim(p_search) = ''
            or p.full_name ilike '%' || trim(p_search) || '%'
            or u.email::text ilike '%' || trim(p_search) || '%')
  ), counted as (
    select b.*, (count(*) over ())::integer as total
      from base b
     order by b.created_at desc, b.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select c.id, c.full_name, c.email, c.status, c.created_at,
         (select count(*)::integer from public.report_paid_orders o where o.customer_id = c.id),
         (select coalesce(sum(o.total_minor), 0)::bigint from public.report_paid_orders o where o.customer_id = c.id)
           - (select coalesce(sum(f.amount_minor), 0)::bigint from public.refunds f
                join public.report_paid_orders o on o.id = f.order_id
               where o.customer_id = c.id and f.status = 'completed'),
         (select count(*)::integer from public.return_requests rr where rr.customer_id = c.id),
         c.total
    from counted c
   order by c.created_at desc, c.id;
end;
$$;

-- Indexes for the reporting date filters.
create index orders_confirmed_at_idx on public.orders (confirmed_at) where confirmed_at is not null;
create index refunds_processed_at_idx on public.refunds (processed_at) where status = 'completed';
create index platform_ledger_created_idx on public.platform_ledger_entries (created_at);
create index return_requests_requested_idx on public.return_requests (requested_at);

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.report_paid_orders from anon, authenticated;

revoke all on function
  public.commission_rule_overlaps_internal(uuid, public.commission_rule_scope, uuid, uuid, timestamptz, timestamptz),
  public.audit_direct_status_change(),
  public.report_range_internal(date, date),
  public.assert_report_access_internal(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.save_commission_rule(uuid, public.commission_rule_scope, uuid, uuid, integer, text, timestamptz, timestamptz),
  public.set_commission_rule_active(uuid, boolean),
  public.explain_commission_rate(uuid, uuid),
  public.set_account_status(uuid, public.account_status, text),
  public.admin_sales_summary(date, date),
  public.admin_revenue_breakdown(date, date),
  public.admin_sales_daily(date, date),
  public.admin_top_vendors(date, date, integer),
  public.admin_top_products(date, date, integer),
  public.admin_discount_usage(date, date),
  public.vendor_sales_summary(uuid, date, date),
  public.vendor_sales_daily(uuid, date, date),
  public.vendor_top_products(uuid, date, date, integer),
  public.vendor_customers(uuid, text, integer, integer),
  public.admin_customers(text, public.account_status, uuid, integer, integer)
from public, anon;

grant execute on function
  public.save_commission_rule(uuid, public.commission_rule_scope, uuid, uuid, integer, text, timestamptz, timestamptz),
  public.set_commission_rule_active(uuid, boolean),
  public.explain_commission_rate(uuid, uuid),
  public.set_account_status(uuid, public.account_status, text),
  public.admin_sales_summary(date, date),
  public.admin_revenue_breakdown(date, date),
  public.admin_sales_daily(date, date),
  public.admin_top_vendors(date, date, integer),
  public.admin_top_products(date, date, integer),
  public.admin_discount_usage(date, date),
  public.vendor_sales_summary(uuid, date, date),
  public.vendor_sales_daily(uuid, date, date),
  public.vendor_top_products(uuid, date, date, integer),
  public.vendor_customers(uuid, text, integer, integer),
  public.admin_customers(text, public.account_status, uuid, integer, integer)
to authenticated, service_role;
