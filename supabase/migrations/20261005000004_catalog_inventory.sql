-- =============================================================================
-- Migration 0004: catalog (categories, brands, collections, products, variants,
-- images) and inventory with safe stock operations.
-- -----------------------------------------------------------------------------
-- Pricing lives on `product_variants`; every sellable product has at least one
-- variant (a product without options has a single default variant). This keeps
-- the order model uniform: order items always reference a variant.
-- =============================================================================

create table public.categories (
  id                   uuid primary key default gen_random_uuid(),
  parent_id            uuid references public.categories (id) on delete restrict,
  slug                 public.slug_text not null unique,
  name                 text not null check (char_length(name) between 1 and 120),
  description          text,
  image_path           text,
  position             integer not null default 0,
  is_active            boolean not null default true,
  commission_rate_bps  public.basis_points,   -- null = inherit global rule
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint categories_not_own_parent check (parent_id is distinct from id)
);

create index categories_parent_idx on public.categories (parent_id, position);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create table public.brands (
  id               uuid primary key default gen_random_uuid(),
  slug             public.slug_text not null unique,
  name             text not null check (char_length(name) between 1 and 120),
  description      text,
  logo_path        text,
  website_url      text check (website_url is null or website_url ~* '^https?://'),
  owner_vendor_id  uuid references public.vendors (id) on delete set null,
  is_verified      boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index brands_owner_vendor_idx on public.brands (owner_vendor_id);

create trigger brands_set_updated_at
  before update on public.brands
  for each row execute function public.set_updated_at();

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references public.vendors (id) on delete restrict,
  category_id       uuid references public.categories (id) on delete set null,
  brand_id          uuid references public.brands (id) on delete set null,
  slug              public.slug_text not null unique,
  name              text not null check (char_length(name) between 2 and 200),
  short_description text check (short_description is null or char_length(short_description) <= 300),
  description       text,
  status            public.product_status not null default 'draft',
  currency          public.currency_code not null default 'USD',
  attributes        jsonb not null default '{}'::jsonb,   -- materials, care, fit, etc.
  tags              text[] not null default '{}',
  weight_grams      integer check (weight_grams is null or weight_grams >= 0),
  requires_shipping boolean not null default true,
  seo_title         text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description   text check (seo_description is null or char_length(seo_description) <= 200),
  approved_at       timestamptz,
  approved_by       uuid references public.profiles (id) on delete set null,
  rejection_reason  text,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index products_vendor_idx on public.products (vendor_id, status);
create index products_category_idx on public.products (category_id) where status = 'active';
create index products_brand_idx on public.products (brand_id) where status = 'active';
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);
create index products_tags_idx on public.products using gin (tags);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- Vendors can move a product between draft / pending_review / archived.
-- Only privileged sessions may publish (active), reject, or touch approval fields.
create or replace function public.protect_product_locked_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'pending_review') then
      raise exception 'new products must be created as draft or pending_review'
        using errcode = 'insufficient_privilege';
    end if;
    if new.approved_at is not null or new.approved_by is not null
       or new.rejection_reason is not null or new.published_at is not null then
      raise exception 'approval fields are managed by the platform'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status and new.status not in ('draft', 'pending_review', 'archived') then
    raise exception 'only an administrator can set product status to %', new.status
      using errcode = 'insufficient_privilege';
  end if;
  if new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.rejection_reason is distinct from old.rejection_reason
     or new.published_at is distinct from old.published_at
     or new.vendor_id is distinct from old.vendor_id then
    raise exception 'approval fields and ownership are managed by the platform'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger products_protect_locked_columns
  before insert or update on public.products
  for each row execute function public.protect_product_locked_columns();

create table public.product_variants (
  id                     uuid primary key default gen_random_uuid(),
  product_id             uuid not null references public.products (id) on delete cascade,
  sku                    text not null unique check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  barcode                text,
  title                  text not null default 'Default' check (char_length(title) between 1 and 120),
  options                jsonb not null default '{}'::jsonb,   -- e.g. {"size":"M","color":"Black"}
  price_minor            public.money_minor not null,
  compare_at_price_minor public.money_minor,
  cost_minor             public.money_minor,
  position               integer not null default 0,
  is_default             boolean not null default false,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint product_variants_compare_at_gte_price
    check (compare_at_price_minor is null or compare_at_price_minor >= price_minor)
);

create index product_variants_product_idx on public.product_variants (product_id, position);
create unique index product_variants_one_default_idx
  on public.product_variants (product_id) where is_default;

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  variant_id   uuid references public.product_variants (id) on delete set null,
  storage_path text not null,
  alt_text     text check (alt_text is null or char_length(alt_text) <= 200),
  position     integer not null default 0,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index product_images_product_idx on public.product_images (product_id, position);
create unique index product_images_one_primary_idx
  on public.product_images (product_id) where is_primary;

create table public.collections (
  id            uuid primary key default gen_random_uuid(),
  slug          public.slug_text not null unique,
  name          text not null check (char_length(name) between 1 and 120),
  description   text,
  type          public.collection_type not null default 'manual',
  rules         jsonb not null default '{}'::jsonb,   -- for automatic collections (phase 3+)
  image_path    text,
  is_active     boolean not null default true,
  position      integer not null default 0,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint collections_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_products (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (collection_id, product_id)
);

-- -----------------------------------------------------------------------------
-- Inventory
-- -----------------------------------------------------------------------------
create table public.inventory (
  id                   uuid primary key default gen_random_uuid(),
  variant_id           uuid not null unique references public.product_variants (id) on delete cascade,
  vendor_id            uuid not null references public.vendors (id) on delete cascade,
  stock_quantity       integer not null default 0 check (stock_quantity >= 0),
  reserved_quantity    integer not null default 0 check (reserved_quantity >= 0),
  available_quantity   integer generated always as (stock_quantity - reserved_quantity) stored,
  low_stock_threshold  integer not null default 5 check (low_stock_threshold >= 0),
  track_inventory      boolean not null default true,
  allow_backorder      boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint inventory_reserved_within_stock check (reserved_quantity <= stock_quantity)
);

create index inventory_vendor_idx on public.inventory (vendor_id);
create index inventory_low_stock_idx on public.inventory (vendor_id)
  where (stock_quantity - reserved_quantity) <= low_stock_threshold;

create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();

create table public.inventory_movements (
  id              bigint generated always as identity primary key,
  inventory_id    uuid not null references public.inventory (id) on delete cascade,
  type            public.inventory_movement_type not null,
  quantity_delta  integer not null check (quantity_delta <> 0),
  quantity_after  integer not null check (quantity_after >= 0),
  reference_type  text,
  reference_id    uuid,
  reason          text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index inventory_movements_inventory_idx on public.inventory_movements (inventory_id, created_at desc);
create index inventory_movements_reference_idx on public.inventory_movements (reference_type, reference_id);

create trigger inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute function public.prevent_mutation();

-- Keep inventory.vendor_id consistent with the owning product.
create or replace function public.inventory_sync_vendor()
returns trigger
language plpgsql
as $$
begin
  select p.vendor_id into new.vendor_id
  from public.product_variants v
  join public.products p on p.id = v.product_id
  where v.id = new.variant_id;
  if new.vendor_id is null then
    raise exception 'variant % does not exist', new.variant_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

create trigger inventory_sync_vendor
  before insert on public.inventory
  for each row execute function public.inventory_sync_vendor();

-- -----------------------------------------------------------------------------
-- Safe inventory operations.
-- All stock changes MUST go through these functions. They lock the row,
-- enforce non-negative stock and write an immutable movement record.
-- Direct UPDATEs to quantity columns are blocked for API roles by RLS grants.
-- -----------------------------------------------------------------------------
create or replace function public.adjust_inventory(
  p_variant_id     uuid,
  p_quantity_delta integer,
  p_type           public.inventory_movement_type,
  p_reference_type text default null,
  p_reference_id   uuid default null,
  p_reason         text default null
)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity_delta = 0 then
    raise exception 'quantity delta must be non-zero' using errcode = 'check_violation';
  end if;

  select * into v_inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    raise exception 'no inventory record for variant %', p_variant_id using errcode = 'no_data_found';
  end if;

  if not public.is_privileged_session() and not public.is_vendor_member(v_inv.vendor_id) then
    raise exception 'not allowed to adjust inventory for this vendor' using errcode = 'insufficient_privilege';
  end if;

  if v_inv.stock_quantity + p_quantity_delta < 0 then
    raise exception 'insufficient stock: have %, requested change %', v_inv.stock_quantity, p_quantity_delta
      using errcode = 'check_violation';
  end if;
  if v_inv.stock_quantity + p_quantity_delta < v_inv.reserved_quantity then
    raise exception 'stock cannot drop below reserved quantity (%)', v_inv.reserved_quantity
      using errcode = 'check_violation';
  end if;

  update public.inventory
     set stock_quantity = stock_quantity + p_quantity_delta
   where id = v_inv.id
   returning * into v_inv;

  insert into public.inventory_movements
    (inventory_id, type, quantity_delta, quantity_after, reference_type, reference_id, reason, created_by)
  values
    (v_inv.id, p_type, p_quantity_delta, v_inv.stock_quantity, p_reference_type, p_reference_id, p_reason,
     public.current_profile_id());

  return v_inv;
end;
$$;

-- Reserve stock for a pending order (checkout). Fails if unavailable.
create or replace function public.reserve_inventory(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'reservation quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'reservations are performed by the platform' using errcode = 'insufficient_privilege';
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

  update public.inventory
     set reserved_quantity = reserved_quantity + p_quantity
   where id = v_inv.id
   returning * into v_inv;
  return v_inv;
end;
$$;

-- Release a reservation (cancelled / expired checkout).
create or replace function public.release_inventory(p_variant_id uuid, p_quantity integer)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'release quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'reservations are performed by the platform' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from public.inventory where variant_id = p_variant_id for update;
  if not found then
    raise exception 'no inventory record for variant %', p_variant_id using errcode = 'no_data_found';
  end if;

  update public.inventory
     set reserved_quantity = greatest(reserved_quantity - p_quantity, 0)
   where id = v_inv.id
   returning * into v_inv;
  return v_inv;
end;
$$;

-- Convert a reservation into a sale: reduces stock and reservation together.
create or replace function public.commit_reserved_inventory(
  p_variant_id   uuid,
  p_quantity     integer,
  p_reference_id uuid
)
returns public.inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = 'check_violation';
  end if;
  if not public.is_privileged_session() then
    raise exception 'sales are committed by the platform' using errcode = 'insufficient_privilege';
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
     set stock_quantity    = stock_quantity - p_quantity,
         reserved_quantity = reserved_quantity - p_quantity
   where id = v_inv.id
   returning * into v_inv;

  insert into public.inventory_movements
    (inventory_id, type, quantity_delta, quantity_after, reference_type, reference_id, created_by)
  values
    (v_inv.id, 'sale', -p_quantity, v_inv.stock_quantity, 'order', p_reference_id, public.current_profile_id());

  return v_inv;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.collections enable row level security;
alter table public.collection_products enable row level security;
alter table public.inventory enable row level security;
alter table public.inventory_movements enable row level security;

-- categories / brands / collections: public read of active rows, admin write.
create policy categories_select_public on public.categories
  for select to anon, authenticated using (is_active = true);
create policy categories_admin_all on public.categories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy brands_select_public on public.brands
  for select to anon, authenticated using (is_active = true);
create policy brands_select_owner_vendor on public.brands
  for select to authenticated using (owner_vendor_id is not null and (select public.is_vendor_member(owner_vendor_id)));
create policy brands_admin_all on public.brands
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy collections_select_public on public.collections
  for select to anon, authenticated
  using (is_active = true and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy collections_admin_all on public.collections
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy collection_products_select_public on public.collection_products
  for select to anon, authenticated using (true);
create policy collection_products_admin_all on public.collection_products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- products: public sees active products of approved vendors; vendor members see
-- their own in any status; admins see everything.
create policy products_select_public on public.products
  for select to anon, authenticated
  using (
    status = 'active'
    and exists (select 1 from public.vendors v where v.id = products.vendor_id and v.status = 'approved')
  );
create policy products_select_vendor on public.products
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy products_insert_vendor on public.products
  for insert to authenticated
  with check (
    (select public.has_vendor_role(vendor_id, array['owner','manager','staff']::public.vendor_member_role[]))
    and exists (select 1 from public.vendors v where v.id = products.vendor_id and v.status = 'approved')
  );
create policy products_update_vendor on public.products
  for update to authenticated
  using ((select public.is_vendor_member(vendor_id)))
  with check ((select public.is_vendor_member(vendor_id)));
create policy products_delete_vendor on public.products
  for delete to authenticated
  using ((select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])) and status = 'draft');
create policy products_admin_all on public.products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- Helper: vendor of a product (security definer so variant/image policies avoid RLS recursion on products).
create or replace function public.product_vendor_id(p_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select vendor_id from public.products where id = p_product_id;
$$;

create or replace function public.product_is_public(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.products p
    join public.vendors v on v.id = p.vendor_id
    where p.id = p_product_id and p.status = 'active' and v.status = 'approved'
  );
$$;

create policy product_variants_select_public on public.product_variants
  for select to anon, authenticated
  using (is_active = true and (select public.product_is_public(product_id)));
create policy product_variants_vendor_all on public.product_variants
  for all to authenticated
  using ((select public.is_vendor_member((select public.product_vendor_id(product_id)))))
  with check ((select public.is_vendor_member((select public.product_vendor_id(product_id)))));
create policy product_variants_admin_all on public.product_variants
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy product_images_select_public on public.product_images
  for select to anon, authenticated using ((select public.product_is_public(product_id)));
create policy product_images_vendor_all on public.product_images
  for all to authenticated
  using ((select public.is_vendor_member((select public.product_vendor_id(product_id)))))
  with check ((select public.is_vendor_member((select public.product_vendor_id(product_id)))));
create policy product_images_admin_all on public.product_images
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- inventory: vendors read their own rows and may create the record / edit
-- thresholds; quantity columns are only changed via the functions above
-- (column-level grants in the grants migration enforce this).
create policy inventory_select_vendor on public.inventory
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy inventory_insert_vendor on public.inventory
  for insert to authenticated
  -- vendor_id is populated by the inventory_sync_vendor BEFORE trigger, which runs before WITH CHECK.
  with check (stock_quantity = 0 and reserved_quantity = 0 and (select public.is_vendor_member(vendor_id)));
create policy inventory_update_vendor on public.inventory
  for update to authenticated
  using ((select public.is_vendor_member(vendor_id)))
  with check ((select public.is_vendor_member(vendor_id)));
create policy inventory_admin_all on public.inventory
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy inventory_movements_select_vendor on public.inventory_movements
  for select to authenticated
  using (exists (select 1 from public.inventory i where i.id = inventory_movements.inventory_id and (select public.is_vendor_member(i.vendor_id))));
create policy inventory_movements_select_admin on public.inventory_movements
  for select to authenticated using ((select public.is_admin()));
