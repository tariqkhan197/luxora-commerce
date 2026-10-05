-- =============================================================================
-- Migration 0008: commissions, payouts, subscriptions, featured placements
-- -----------------------------------------------------------------------------
-- Commission resolution order (most specific wins):
--   1. active commission_rules row with scope = 'vendor'   for the vendor
--   2. vendors.commission_rate_bps (legacy per-vendor override column)
--   3. active commission_rules row with scope = 'category' for the product's category
--      (walking up the category tree)
--   4. categories.commission_rate_bps on that path
--   5. active commission_rules row with scope = 'global'
--   6. platform_settings 'commission.default_bps'
-- Every vendor order stores the resolved rate and the computed commission so
-- historical records never change when rules change.
-- =============================================================================

create table public.commission_rules (
  id           uuid primary key default gen_random_uuid(),
  scope        public.commission_rule_scope not null,
  vendor_id    uuid references public.vendors (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete cascade,
  rate_bps     public.basis_points not null,
  name         text not null check (char_length(name) between 2 and 120),
  is_active    boolean not null default true,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint commission_rules_scope_target check (
    (scope = 'global'   and vendor_id is null and category_id is null) or
    (scope = 'vendor'   and vendor_id is not null and category_id is null) or
    (scope = 'category' and category_id is not null and vendor_id is null)
  ),
  constraint commission_rules_window check (ends_at is null or ends_at > starts_at)
);

create index commission_rules_vendor_idx on public.commission_rules (vendor_id) where is_active;
create index commission_rules_category_idx on public.commission_rules (category_id) where is_active;

create trigger commission_rules_set_updated_at
  before update on public.commission_rules
  for each row execute function public.set_updated_at();

create or replace function public.resolve_commission_rate_bps(p_vendor_id uuid, p_category_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rate integer;
  v_cat  uuid := p_category_id;
  v_depth integer := 0;
begin
  -- 1. vendor-specific rule
  select rate_bps into v_rate from public.commission_rules
   where scope = 'vendor' and vendor_id = p_vendor_id and is_active
     and starts_at <= now() and (ends_at is null or ends_at > now())
   order by starts_at desc limit 1;
  if v_rate is not null then return v_rate; end if;

  -- 2. vendor override column
  select commission_rate_bps into v_rate from public.vendors where id = p_vendor_id;
  if v_rate is not null then return v_rate; end if;

  -- 3./4. category rules walking up the tree
  while v_cat is not null and v_depth < 20 loop
    select rate_bps into v_rate from public.commission_rules
     where scope = 'category' and category_id = v_cat and is_active
       and starts_at <= now() and (ends_at is null or ends_at > now())
     order by starts_at desc limit 1;
    if v_rate is not null then return v_rate; end if;

    select commission_rate_bps, parent_id into v_rate, v_cat from public.categories where id = v_cat;
    if v_rate is not null then return v_rate; end if;
    v_depth := v_depth + 1;
  end loop;

  -- 5. global rule
  select rate_bps into v_rate from public.commission_rules
   where scope = 'global' and is_active and starts_at <= now() and (ends_at is null or ends_at > now())
   order by starts_at desc limit 1;
  if v_rate is not null then return v_rate; end if;

  -- 6. platform default
  select (value #>> '{}')::integer into v_rate from public.platform_settings where key = 'commission.default_bps';
  return coalesce(v_rate, 0);
end;
$$;

-- Deterministic commission amount: round half up on integer arithmetic.
create or replace function public.calculate_commission_minor(p_base_minor bigint, p_rate_bps integer)
returns bigint
language sql
immutable
as $$
  select case
    when p_base_minor <= 0 or p_rate_bps <= 0 then 0
    else (p_base_minor * p_rate_bps + 5000) / 10000
  end;
$$;

-- Per-vendor-order commission ledger (one row per vendor order; reversals
-- reference the original via reversal_of).
create table public.commissions (
  id               uuid primary key default gen_random_uuid(),
  vendor_order_id  uuid not null references public.vendor_orders (id) on delete restrict,
  vendor_id        uuid not null references public.vendors (id) on delete restrict,
  rule_id          uuid references public.commission_rules (id) on delete set null,
  currency         public.currency_code not null,
  base_minor       public.money_minor not null,      -- merchandise net the rate applied to
  rate_bps         public.basis_points not null,
  commission_minor bigint not null,                  -- negative for reversals
  status           public.commission_status not null default 'pending',
  reversal_of      uuid references public.commissions (id) on delete restrict,
  settled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index commissions_vendor_idx on public.commissions (vendor_id, status);
create index commissions_vendor_order_idx on public.commissions (vendor_order_id);

create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Payouts
-- -----------------------------------------------------------------------------
create table public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  vendor_id          uuid not null references public.vendors (id) on delete restrict,
  status             public.payout_status not null default 'pending',
  currency           public.currency_code not null,
  period_start       timestamptz not null,
  period_end         timestamptz not null,
  gross_minor        public.money_minor not null default 0,   -- sum of vendor order totals
  commission_minor   public.money_minor not null default 0,
  fees_minor         public.money_minor not null default 0,
  refunds_minor      public.money_minor not null default 0,
  adjustments_minor  bigint not null default 0,
  net_minor          bigint not null default 0,
  method             text,
  reference          text,
  scheduled_for      timestamptz,
  paid_at            timestamptz,
  processed_by       uuid references public.profiles (id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint payouts_period check (period_end > period_start),
  constraint payouts_net_consistent
    check (net_minor = gross_minor - commission_minor - fees_minor - refunds_minor + adjustments_minor)
);

create index payouts_vendor_idx on public.payouts (vendor_id, created_at desc);
create index payouts_status_idx on public.payouts (status);

create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

create table public.payout_items (
  id               uuid primary key default gen_random_uuid(),
  payout_id        uuid not null references public.payouts (id) on delete cascade,
  type             public.payout_item_type not null,
  vendor_order_id  uuid references public.vendor_orders (id) on delete restrict,
  refund_id        uuid references public.refunds (id) on delete restrict,
  amount_minor     bigint not null,        -- positive earnings, negative debits
  description      text,
  created_at       timestamptz not null default now(),
  constraint payout_items_reference check (
    (type = 'vendor_order_earnings' and vendor_order_id is not null) or
    (type = 'refund_debit' and refund_id is not null) or
    (type = 'adjustment')
  )
);

create index payout_items_payout_idx on public.payout_items (payout_id);
-- A vendor order's earnings are paid out at most once.
create unique index payout_items_vendor_order_once_idx on public.payout_items (vendor_order_id)
  where type = 'vendor_order_earnings';

-- -----------------------------------------------------------------------------
-- Vendor subscriptions
-- -----------------------------------------------------------------------------
create table public.subscription_plans (
  id                   uuid primary key default gen_random_uuid(),
  slug                 public.slug_text not null unique,
  name                 text not null check (char_length(name) between 2 and 80),
  description          text,
  currency             public.currency_code not null default 'USD',
  price_minor          public.money_minor not null,
  billing_interval     public.billing_interval not null,
  commission_rate_bps  public.basis_points,        -- optional plan-level rate used when creating a vendor rule
  product_limit        integer check (product_limit is null or product_limit > 0),
  features             jsonb not null default '[]'::jsonb,
  is_active            boolean not null default true,
  position             integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

create table public.vendor_subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  vendor_id                 uuid not null references public.vendors (id) on delete cascade,
  plan_id                   uuid not null references public.subscription_plans (id) on delete restrict,
  status                    public.subscription_status not null default 'active',
  current_period_start      timestamptz not null default now(),
  current_period_end        timestamptz not null,
  cancel_at_period_end      boolean not null default false,
  trial_ends_at             timestamptz,
  provider                  public.payment_provider,
  provider_subscription_id  text,
  cancelled_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint vendor_subscriptions_period check (current_period_end > current_period_start)
);

create index vendor_subscriptions_vendor_idx on public.vendor_subscriptions (vendor_id, status);
create unique index vendor_subscriptions_one_live_idx on public.vendor_subscriptions (vendor_id)
  where status in ('trialing', 'active', 'past_due');

create trigger vendor_subscriptions_set_updated_at
  before update on public.vendor_subscriptions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Paid placements
-- -----------------------------------------------------------------------------
create table public.featured_products (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete cascade,
  vendor_id         uuid not null references public.vendors (id) on delete cascade,
  placement         text not null check (placement ~ '^[a-z][a-z0-9_]{1,40}$'),  -- e.g. home_hero, category_top
  position          integer not null default 0,
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  status            public.placement_status not null default 'scheduled',
  currency          public.currency_code not null default 'USD',
  price_paid_minor  public.money_minor not null default 0,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint featured_products_window check (ends_at is null or ends_at > starts_at)
);

create index featured_products_placement_idx on public.featured_products (placement, position)
  where status in ('scheduled', 'active');

create trigger featured_products_set_updated_at
  before update on public.featured_products
  for each row execute function public.set_updated_at();

create table public.featured_brands (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references public.brands (id) on delete cascade,
  vendor_id         uuid references public.vendors (id) on delete cascade,   -- sponsoring vendor, if any
  placement         text not null check (placement ~ '^[a-z][a-z0-9_]{1,40}$'),
  position          integer not null default 0,
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  status            public.placement_status not null default 'scheduled',
  currency          public.currency_code not null default 'USD',
  price_paid_minor  public.money_minor not null default 0,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint featured_brands_window check (ends_at is null or ends_at > starts_at)
);

create index featured_brands_placement_idx on public.featured_brands (placement, position)
  where status in ('scheduled', 'active');

create trigger featured_brands_set_updated_at
  before update on public.featured_brands
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.commission_rules enable row level security;
alter table public.commissions enable row level security;
alter table public.payouts enable row level security;
alter table public.payout_items enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.vendor_subscriptions enable row level security;
alter table public.featured_products enable row level security;
alter table public.featured_brands enable row level security;

create policy commission_rules_select_vendor on public.commission_rules
  for select to authenticated
  using (scope <> 'vendor' or (select public.is_vendor_member(vendor_id)));
create policy commission_rules_admin_all on public.commission_rules
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy commissions_select_vendor on public.commissions
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy commissions_admin_all on public.commissions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy payouts_select_vendor on public.payouts
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy payouts_admin_all on public.payouts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.payout_vendor_id(p_payout_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select vendor_id from public.payouts where id = p_payout_id; $$;

create policy payout_items_select_vendor on public.payout_items
  for select to authenticated using ((select public.is_vendor_member((select public.payout_vendor_id(payout_id)))));
create policy payout_items_admin_all on public.payout_items
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy subscription_plans_select_public on public.subscription_plans
  for select to anon, authenticated using (is_active = true);
create policy subscription_plans_admin_all on public.subscription_plans
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy vendor_subscriptions_select_vendor on public.vendor_subscriptions
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy vendor_subscriptions_admin_all on public.vendor_subscriptions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy featured_products_select_public on public.featured_products
  for select to anon, authenticated
  using (status = 'active' and starts_at <= now() and (ends_at is null or ends_at > now()));
create policy featured_products_select_vendor on public.featured_products
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy featured_products_admin_all on public.featured_products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy featured_brands_select_public on public.featured_brands
  for select to anon, authenticated
  using (status = 'active' and starts_at <= now() and (ends_at is null or ends_at > now()));
create policy featured_brands_select_vendor on public.featured_brands
  for select to authenticated using (vendor_id is not null and (select public.is_vendor_member(vendor_id)));
create policy featured_brands_admin_all on public.featured_brands
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
