-- =============================================================================
-- Migration 0007: reviews, coupons, flash sales
-- =============================================================================

create table public.reviews (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null references public.products (id) on delete cascade,
  customer_id        uuid not null references public.profiles (id) on delete cascade,
  order_item_id      uuid unique references public.order_items (id) on delete set null,  -- set => verified purchase
  rating             smallint not null check (rating between 1 and 5),
  title              text check (title is null or char_length(title) <= 120),
  body               text not null check (char_length(body) between 10 and 4000),
  status             public.review_status not null default 'pending',
  vendor_reply       text check (vendor_reply is null or char_length(vendor_reply) <= 2000),
  vendor_replied_at  timestamptz,
  moderated_by       uuid references public.profiles (id) on delete set null,
  moderated_at       timestamptz,
  helpful_count      integer not null default 0 check (helpful_count >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (product_id, customer_id)
);

create index reviews_product_idx on public.reviews (product_id, status, created_at desc);
create index reviews_customer_idx on public.reviews (customer_id);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create table public.review_images (
  id            uuid primary key default gen_random_uuid(),
  review_id     uuid not null references public.reviews (id) on delete cascade,
  storage_path  text not null,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index review_images_review_idx on public.review_images (review_id, position);

-- Customers may edit their own text/rating; moderation & vendor replies are locked.
create or replace function public.protect_review_locked_columns()
returns trigger
language plpgsql
as $$
declare
  v_vendor_id uuid := public.product_vendor_id(coalesce(new.product_id, old.product_id));
begin
  if public.is_privileged_session() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.vendor_reply is not null or new.moderated_by is not null or new.helpful_count <> 0 then
      raise exception 'review moderation fields are managed by the platform' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- vendor member replying: only reply fields may change
  if public.is_vendor_member(v_vendor_id) and new.customer_id <> public.current_profile_id() then
    if row(new.product_id, new.customer_id, new.order_item_id, new.rating, new.title, new.body, new.status,
           new.moderated_by, new.moderated_at, new.helpful_count)
       is distinct from
       row(old.product_id, old.customer_id, old.order_item_id, old.rating, old.title, old.body, old.status,
           old.moderated_by, old.moderated_at, old.helpful_count) then
      raise exception 'vendors may only change the reply on a review' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- author editing: content only; status resets to pending for re-moderation
  if row(new.product_id, new.customer_id, new.order_item_id, new.vendor_reply, new.vendor_replied_at,
         new.moderated_by, new.moderated_at, new.helpful_count)
     is distinct from
     row(old.product_id, old.customer_id, old.order_item_id, old.vendor_reply, old.vendor_replied_at,
         old.moderated_by, old.moderated_at, old.helpful_count) then
    raise exception 'only rating, title and body may be edited by the author' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status then
    raise exception 'review status is managed by the platform' using errcode = 'insufficient_privilege';
  end if;
  if new.rating <> old.rating or new.title is distinct from old.title or new.body <> old.body then
    new.status := 'pending';
  end if;
  return new;
end;
$$;

create trigger reviews_protect_locked_columns
  before insert or update on public.reviews
  for each row execute function public.protect_review_locked_columns();

-- -----------------------------------------------------------------------------
-- Coupons
-- discount_value semantics depend on discount_type:
--   percentage   → basis points (0..10000)
--   fixed_amount → minor units
--   free_shipping→ ignored (0)
-- -----------------------------------------------------------------------------
create table public.coupons (
  code                      citext not null unique check (code ~* '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  id                        uuid primary key default gen_random_uuid(),
  scope                     public.coupon_scope not null,
  vendor_id                 uuid references public.vendors (id) on delete cascade,
  name                      text not null check (char_length(name) between 2 and 120),
  description               text,
  discount_type             public.discount_type not null,
  discount_value            bigint not null check (discount_value >= 0),
  min_subtotal_minor        public.money_minor not null default 0,
  max_discount_minor        public.money_minor,
  usage_limit               integer check (usage_limit is null or usage_limit > 0),
  usage_limit_per_customer  integer check (usage_limit_per_customer is null or usage_limit_per_customer > 0),
  used_count                integer not null default 0 check (used_count >= 0),
  starts_at                 timestamptz not null default now(),
  ends_at                   timestamptz,
  is_active                 boolean not null default true,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint coupons_scope_vendor check (
    (scope = 'platform' and vendor_id is null) or (scope = 'vendor' and vendor_id is not null)
  ),
  constraint coupons_percentage_range check (discount_type <> 'percentage' or discount_value between 1 and 10000),
  constraint coupons_window check (ends_at is null or ends_at > starts_at)
);

create index coupons_vendor_idx on public.coupons (vendor_id);
create index coupons_active_idx on public.coupons (is_active, starts_at, ends_at);

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

create table public.coupon_usages (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  customer_id     uuid not null references public.profiles (id) on delete cascade,
  discount_minor  public.money_minor not null,
  created_at      timestamptz not null default now(),
  unique (coupon_id, order_id)
);

create index coupon_usages_customer_idx on public.coupon_usages (coupon_id, customer_id);

-- -----------------------------------------------------------------------------
-- Flash sales
-- -----------------------------------------------------------------------------
create table public.flash_sales (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid references public.vendors (id) on delete cascade,   -- null = platform-wide campaign
  name        text not null check (char_length(name) between 2 and 120),
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      public.flash_sale_status not null default 'scheduled',
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint flash_sales_window check (ends_at > starts_at)
);

create index flash_sales_window_idx on public.flash_sales (starts_at, ends_at) where status in ('scheduled', 'active');
create index flash_sales_vendor_idx on public.flash_sales (vendor_id);

create trigger flash_sales_set_updated_at
  before update on public.flash_sales
  for each row execute function public.set_updated_at();

create table public.flash_sale_items (
  id                uuid primary key default gen_random_uuid(),
  flash_sale_id     uuid not null references public.flash_sales (id) on delete cascade,
  variant_id        uuid not null references public.product_variants (id) on delete cascade,
  sale_price_minor  public.money_minor not null,
  quantity_limit    integer check (quantity_limit is null or quantity_limit > 0),
  sold_count        integer not null default 0 check (sold_count >= 0),
  created_at        timestamptz not null default now(),
  unique (flash_sale_id, variant_id),
  constraint flash_sale_items_sold_within_limit check (quantity_limit is null or sold_count <= quantity_limit)
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.reviews enable row level security;
alter table public.review_images enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_usages enable row level security;
alter table public.flash_sales enable row level security;
alter table public.flash_sale_items enable row level security;

create policy reviews_select_public on public.reviews
  for select to anon, authenticated using (status = 'approved');
create policy reviews_select_own on public.reviews
  for select to authenticated using (customer_id = (select public.current_profile_id()));
create policy reviews_insert_own on public.reviews
  for insert to authenticated
  with check (customer_id = (select public.current_profile_id()) and (select public.product_is_public(product_id)));
create policy reviews_update_own on public.reviews
  for update to authenticated
  using (customer_id = (select public.current_profile_id()))
  with check (customer_id = (select public.current_profile_id()));
create policy reviews_delete_own on public.reviews
  for delete to authenticated using (customer_id = (select public.current_profile_id()));
create policy reviews_select_vendor on public.reviews
  for select to authenticated using ((select public.is_vendor_member((select public.product_vendor_id(product_id)))));
create policy reviews_update_vendor on public.reviews
  for update to authenticated
  using ((select public.is_vendor_member((select public.product_vendor_id(product_id)))))
  with check ((select public.is_vendor_member((select public.product_vendor_id(product_id)))));
create policy reviews_admin_all on public.reviews
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.review_customer_id(p_review_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select customer_id from public.reviews where id = p_review_id; $$;

create or replace function public.review_is_public(p_review_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select status = 'approved' from public.reviews where id = p_review_id), false); $$;

create policy review_images_select_public on public.review_images
  for select to anon, authenticated using ((select public.review_is_public(review_id)));
create policy review_images_owner_all on public.review_images
  for all to authenticated
  using ((select public.review_customer_id(review_id)) = (select public.current_profile_id()))
  with check ((select public.review_customer_id(review_id)) = (select public.current_profile_id()));
create policy review_images_admin_all on public.review_images
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Coupons: codes are validated server-side; customers never list them.
create policy coupons_vendor_all on public.coupons
  for all to authenticated
  using (scope = 'vendor' and (select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])))
  with check (scope = 'vendor' and (select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])));
create policy coupons_admin_all on public.coupons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy coupon_usages_select_customer on public.coupon_usages
  for select to authenticated using (customer_id = (select public.current_profile_id()));
create policy coupon_usages_select_vendor on public.coupon_usages
  for select to authenticated
  using (exists (select 1 from public.coupons c where c.id = coupon_usages.coupon_id and c.vendor_id is not null and (select public.is_vendor_member(c.vendor_id))));
create policy coupon_usages_select_admin on public.coupon_usages
  for select to authenticated using ((select public.is_admin()));

create policy flash_sales_select_public on public.flash_sales
  for select to anon, authenticated using (status = 'active' and starts_at <= now() and ends_at > now());
create policy flash_sales_vendor_all on public.flash_sales
  for all to authenticated
  using (vendor_id is not null and (select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])))
  with check (vendor_id is not null and (select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])));
create policy flash_sales_admin_all on public.flash_sales
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.flash_sale_vendor_id(p_flash_sale_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select vendor_id from public.flash_sales where id = p_flash_sale_id; $$;

create or replace function public.flash_sale_is_live(p_flash_sale_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select status = 'active' and starts_at <= now() and ends_at > now()
                   from public.flash_sales where id = p_flash_sale_id), false);
$$;

create policy flash_sale_items_select_public on public.flash_sale_items
  for select to anon, authenticated using ((select public.flash_sale_is_live(flash_sale_id)));
create policy flash_sale_items_vendor_all on public.flash_sale_items
  for all to authenticated
  using ((select public.has_vendor_role((select public.flash_sale_vendor_id(flash_sale_id)), array['owner','manager']::public.vendor_member_role[])))
  with check ((select public.has_vendor_role((select public.flash_sale_vendor_id(flash_sale_id)), array['owner','manager']::public.vendor_member_role[])));
create policy flash_sale_items_admin_all on public.flash_sale_items
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
