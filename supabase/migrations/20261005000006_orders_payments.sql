-- =============================================================================
-- Migration 0006: multi-vendor orders, payments, refunds, returns
-- -----------------------------------------------------------------------------
-- One checkout produces ONE parent `orders` row (what the customer paid) and
-- one `vendor_orders` row per vendor involved (what each vendor fulfils and
-- earns). `order_items` belong to both: each item references its parent order
-- and its vendor order, so there is no duplicated vendor_order_items table.
--
-- Financial invariants (all amounts in minor units, enforced by CHECKs):
--   orders.total        = subtotal - discount + shipping + tax
--   vendor_orders.total = subtotal - discount + shipping + tax
--   vendor_orders.vendor_earnings = total - commission - payment_fee
--   order_items.total   = quantity * unit_price - discount + tax
-- Commission is computed on the merchandise net (subtotal - discount) using the
-- resolved rate in basis points: commission = round_half_up(net * bps / 10000).
-- =============================================================================

create sequence public.order_number_seq;

create or replace function public.generate_order_number()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_prefix text := coalesce((select value #>> '{}' from public.platform_settings where key = 'orders.number_prefix'), 'LX');
begin
  return format('%s-%s-%s', v_prefix, to_char(now() at time zone 'utc', 'YYMMDD'), lpad(nextval('public.order_number_seq')::text, 6, '0'));
end;
$$;

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_number       text not null unique default public.generate_order_number(),
  customer_id        uuid not null references public.profiles (id) on delete restrict,
  status             public.order_status not null default 'pending',
  payment_status     public.payment_status not null default 'pending',
  currency           public.currency_code not null,
  subtotal_minor     public.money_minor not null default 0,
  discount_minor     public.money_minor not null default 0,
  shipping_minor     public.money_minor not null default 0,
  tax_minor          public.money_minor not null default 0,
  total_minor        public.money_minor not null default 0,
  coupon_code        text,
  customer_email     extensions.citext not null,
  customer_note      text check (customer_note is null or char_length(customer_note) <= 1000),
  shipping_address   jsonb not null,   -- immutable snapshot of the address at purchase time
  billing_address    jsonb not null,
  placed_at          timestamptz not null default now(),
  confirmed_at       timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancellation_reason text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint orders_total_consistent
    check (total_minor = subtotal_minor - discount_minor + shipping_minor + tax_minor),
  constraint orders_discount_within_subtotal check (discount_minor <= subtotal_minor)
);

create index orders_customer_idx on public.orders (customer_id, placed_at desc);
create index orders_status_idx on public.orders (status, placed_at desc);
create index orders_payment_status_idx on public.orders (payment_status);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

create table public.vendor_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null references public.orders (id) on delete cascade,
  vendor_id              uuid not null references public.vendors (id) on delete restrict,
  vendor_order_number    text not null unique,
  status                 public.vendor_order_status not null default 'pending',
  currency               public.currency_code not null,
  subtotal_minor         public.money_minor not null default 0,
  discount_minor         public.money_minor not null default 0,
  shipping_minor         public.money_minor not null default 0,
  tax_minor              public.money_minor not null default 0,
  total_minor            public.money_minor not null default 0,
  commission_rate_bps    public.basis_points not null,
  commission_minor       public.money_minor not null default 0,
  payment_fee_minor      public.money_minor not null default 0,   -- vendor's allocated share of provider fees
  vendor_earnings_minor  bigint not null default 0,               -- may be negative after heavy refunds; see refunds
  carrier                text,
  tracking_number        text,
  tracking_url           text,
  shipped_at             timestamptz,
  delivered_at           timestamptz,
  completed_at           timestamptz,
  cancelled_at           timestamptz,
  vendor_note            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (order_id, vendor_id),
  constraint vendor_orders_total_consistent
    check (total_minor = subtotal_minor - discount_minor + shipping_minor + tax_minor),
  constraint vendor_orders_earnings_consistent
    check (vendor_earnings_minor = total_minor - commission_minor - payment_fee_minor),
  constraint vendor_orders_discount_within_subtotal check (discount_minor <= subtotal_minor)
);

create index vendor_orders_vendor_idx on public.vendor_orders (vendor_id, created_at desc);
create index vendor_orders_order_idx on public.vendor_orders (order_id);
create index vendor_orders_status_idx on public.vendor_orders (vendor_id, status);

create trigger vendor_orders_set_updated_at
  before update on public.vendor_orders
  for each row execute function public.set_updated_at();

-- Vendors may only change fulfilment fields on their orders.
create or replace function public.protect_vendor_order_locked_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() then
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

create trigger vendor_orders_protect_locked_columns
  before update on public.vendor_orders
  for each row execute function public.protect_vendor_order_locked_columns();

create table public.order_items (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  vendor_order_id     uuid not null references public.vendor_orders (id) on delete cascade,
  vendor_id           uuid not null references public.vendors (id) on delete restrict,
  product_id          uuid references public.products (id) on delete set null,
  variant_id          uuid references public.product_variants (id) on delete set null,
  product_name        text not null,     -- snapshots: catalog may change after purchase
  variant_title       text not null,
  sku                 text not null,
  image_path          text,
  quantity            integer not null check (quantity > 0),
  unit_price_minor    public.money_minor not null,
  discount_minor      public.money_minor not null default 0,
  tax_minor           public.money_minor not null default 0,
  total_minor         public.money_minor not null,
  fulfilled_quantity  integer not null default 0 check (fulfilled_quantity >= 0),
  returned_quantity   integer not null default 0 check (returned_quantity >= 0),
  refunded_quantity   integer not null default 0 check (refunded_quantity >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint order_items_total_consistent
    check (total_minor = quantity * unit_price_minor - discount_minor + tax_minor),
  constraint order_items_quantities_within_ordered
    check (fulfilled_quantity <= quantity and returned_quantity <= quantity and refunded_quantity <= quantity)
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_vendor_order_idx on public.order_items (vendor_order_id);
create index order_items_product_idx on public.order_items (product_id);

create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();

-- An item's vendor order must belong to the same parent order and vendor.
create or replace function public.validate_order_item_links()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid;
  v_vendor_id uuid;
begin
  select order_id, vendor_id into v_order_id, v_vendor_id
  from public.vendor_orders where id = new.vendor_order_id;
  if v_order_id is distinct from new.order_id or v_vendor_id is distinct from new.vendor_id then
    raise exception 'order item links are inconsistent with its vendor order' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger order_items_validate_links
  before insert or update of order_id, vendor_order_id, vendor_id on public.order_items
  for each row execute function public.validate_order_item_links();

-- -----------------------------------------------------------------------------
-- Payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete restrict,
  provider             public.payment_provider not null,
  provider_payment_id  text,
  status               public.payment_status not null default 'pending',
  currency             public.currency_code not null,
  amount_minor         public.money_minor not null,
  fee_minor            public.money_minor not null default 0,     -- provider fee as reported
  refunded_minor       public.money_minor not null default 0,
  authorized_at        timestamptz,
  captured_at          timestamptz,
  failed_at            timestamptz,
  failure_code         text,
  failure_message      text,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint payments_refunded_within_amount check (refunded_minor <= amount_minor)
);

create index payments_order_idx on public.payments (order_id);
create unique index payments_provider_ref_idx on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create table public.payment_transactions (
  id                        bigint generated always as identity primary key,
  payment_id                uuid not null references public.payments (id) on delete cascade,
  type                      public.payment_transaction_type not null,
  status                    public.payment_transaction_status not null default 'pending',
  amount_minor              bigint not null,   -- signed: refunds/fees negative from the platform's view
  currency                  public.currency_code not null,
  provider_transaction_id   text,
  raw_payload               jsonb,
  created_at                timestamptz not null default now()
);

create index payment_transactions_payment_idx on public.payment_transactions (payment_id, created_at);
create unique index payment_transactions_provider_ref_idx
  on public.payment_transactions (provider_transaction_id) where provider_transaction_id is not null;

create trigger payment_transactions_immutable
  before update or delete on public.payment_transactions
  for each row execute function public.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Returns & refunds
-- -----------------------------------------------------------------------------
create table public.returns (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete restrict,
  vendor_order_id    uuid not null references public.vendor_orders (id) on delete restrict,
  order_item_id      uuid not null references public.order_items (id) on delete restrict,
  customer_id        uuid not null references public.profiles (id) on delete restrict,
  vendor_id          uuid not null references public.vendors (id) on delete restrict,
  quantity           integer not null check (quantity > 0),
  reason             text not null check (char_length(reason) between 3 and 1000),
  status             public.return_status not null default 'requested',
  customer_images    jsonb not null default '[]'::jsonb,
  reviewed_by        uuid references public.profiles (id) on delete set null,
  reviewed_at        timestamptz,
  received_at        timestamptz,
  inspection_notes   text,
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index returns_customer_idx on public.returns (customer_id, created_at desc);
create index returns_vendor_idx on public.returns (vendor_id, status);
create index returns_order_idx on public.returns (order_id);

create trigger returns_set_updated_at
  before update on public.returns
  for each row execute function public.set_updated_at();

create table public.refunds (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.orders (id) on delete restrict,
  vendor_order_id            uuid references public.vendor_orders (id) on delete restrict,
  payment_id                 uuid not null references public.payments (id) on delete restrict,
  return_id                  uuid references public.returns (id) on delete set null,
  status                     public.refund_status not null default 'requested',
  currency                   public.currency_code not null,
  amount_minor               public.money_minor not null check (amount_minor > 0),
  commission_reversed_minor  public.money_minor not null default 0,  -- platform gives back this much commission
  vendor_debit_minor         public.money_minor not null default 0,  -- vendor's share of the refund
  reason                     text not null check (char_length(reason) between 3 and 1000),
  requested_by               uuid references public.profiles (id) on delete set null,
  approved_by                uuid references public.profiles (id) on delete set null,
  approved_at                timestamptz,
  processed_at               timestamptz,
  provider_refund_id         text,
  failure_message            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint refunds_split_within_amount check (commission_reversed_minor + vendor_debit_minor <= amount_minor)
);

create index refunds_order_idx on public.refunds (order_id);
create index refunds_vendor_order_idx on public.refunds (vendor_order_id);
create index refunds_status_idx on public.refunds (status, created_at desc);

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- Orders are created exclusively by the platform (service role, inside a
-- server-side checkout transaction). Customers read their own; vendors read
-- their vendor orders and the items within; admins read everything.
-- -----------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.vendor_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.returns enable row level security;
alter table public.refunds enable row level security;

create or replace function public.order_customer_id(p_order_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select customer_id from public.orders where id = p_order_id; $$;

create or replace function public.vendor_order_vendor_id(p_vendor_order_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select vendor_id from public.vendor_orders where id = p_vendor_order_id; $$;

create policy orders_select_customer on public.orders
  for select to authenticated using (customer_id = (select public.current_profile_id()));
create policy orders_select_vendor on public.orders
  for select to authenticated
  using (exists (select 1 from public.vendor_orders vo where vo.order_id = orders.id and (select public.is_vendor_member(vo.vendor_id))));
create policy orders_select_admin on public.orders
  for select to authenticated using ((select public.is_admin()));
create policy orders_update_admin on public.orders
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy vendor_orders_select_customer on public.vendor_orders
  for select to authenticated using ((select public.order_customer_id(order_id)) = (select public.current_profile_id()));
create policy vendor_orders_select_vendor on public.vendor_orders
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy vendor_orders_update_vendor on public.vendor_orders
  for update to authenticated
  using ((select public.is_vendor_member(vendor_id)))
  with check ((select public.is_vendor_member(vendor_id)));
create policy vendor_orders_select_admin on public.vendor_orders
  for select to authenticated using ((select public.is_admin()));
create policy vendor_orders_update_admin on public.vendor_orders
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy order_items_select_customer on public.order_items
  for select to authenticated using ((select public.order_customer_id(order_id)) = (select public.current_profile_id()));
create policy order_items_select_vendor on public.order_items
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy order_items_update_vendor on public.order_items
  for update to authenticated
  using ((select public.is_vendor_member(vendor_id)))
  with check ((select public.is_vendor_member(vendor_id)));
create policy order_items_select_admin on public.order_items
  for select to authenticated using ((select public.is_admin()));

-- Vendors may only update fulfilled_quantity on items.
create or replace function public.protect_order_item_locked_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if row(new.order_id, new.vendor_order_id, new.vendor_id, new.product_id, new.variant_id, new.product_name,
         new.variant_title, new.sku, new.image_path, new.quantity, new.unit_price_minor, new.discount_minor,
         new.tax_minor, new.total_minor, new.returned_quantity, new.refunded_quantity)
     is distinct from
     row(old.order_id, old.vendor_order_id, old.vendor_id, old.product_id, old.variant_id, old.product_name,
         old.variant_title, old.sku, old.image_path, old.quantity, old.unit_price_minor, old.discount_minor,
         old.tax_minor, old.total_minor, old.returned_quantity, old.refunded_quantity) then
    raise exception 'only fulfilled_quantity may be changed by a vendor' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger order_items_protect_locked_columns
  before update on public.order_items
  for each row execute function public.protect_order_item_locked_columns();

-- Payments are never exposed to vendors (they contain provider details).
create policy payments_select_customer on public.payments
  for select to authenticated using ((select public.order_customer_id(order_id)) = (select public.current_profile_id()));
create policy payments_select_admin on public.payments
  for select to authenticated using ((select public.is_admin()));

create policy payment_transactions_select_admin on public.payment_transactions
  for select to authenticated using ((select public.is_admin()));

-- Returns: customers request on their own items; vendors & admins review.
create policy returns_select_customer on public.returns
  for select to authenticated using (customer_id = (select public.current_profile_id()));
create policy returns_insert_customer on public.returns
  for insert to authenticated
  with check (
    customer_id = (select public.current_profile_id())
    and (select public.order_customer_id(order_id)) = (select public.current_profile_id())
    and status = 'requested'
    and reviewed_by is null and reviewed_at is null and received_at is null
  );
create policy returns_select_vendor on public.returns
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy returns_update_vendor on public.returns
  for update to authenticated
  using ((select public.is_vendor_member(vendor_id)))
  with check ((select public.is_vendor_member(vendor_id)) and customer_id = (select public.order_customer_id(order_id)));
create policy returns_admin_all on public.returns
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Refunds are money movements: read-only for customers/vendors, managed by admins/platform.
create policy refunds_select_customer on public.refunds
  for select to authenticated using ((select public.order_customer_id(order_id)) = (select public.current_profile_id()));
create policy refunds_select_vendor on public.refunds
  for select to authenticated
  using (vendor_order_id is not null and (select public.is_vendor_member((select public.vendor_order_vendor_id(vendor_order_id)))));
create policy refunds_admin_all on public.refunds
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
