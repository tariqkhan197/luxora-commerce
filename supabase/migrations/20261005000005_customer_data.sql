-- =============================================================================
-- Migration 0005: customer-owned data — addresses, carts, wishlists
-- =============================================================================

create table public.addresses (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles (id) on delete cascade,
  type                 public.address_type not null default 'both',
  label                text check (label is null or char_length(label) <= 40),
  full_name            text not null check (char_length(full_name) between 1 and 120),
  phone                text check (phone is null or phone ~ '^\+?[0-9(][0-9 ()-]{6,19}$'),
  line1                text not null check (char_length(line1) between 1 and 200),
  line2                text check (line2 is null or char_length(line2) <= 200),
  city                 text not null check (char_length(city) between 1 and 100),
  state                text check (state is null or char_length(state) <= 100),
  postal_code          text not null check (char_length(postal_code) between 1 and 20),
  country_code         char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  is_default_shipping  boolean not null default false,
  is_default_billing   boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index addresses_profile_idx on public.addresses (profile_id);
create unique index addresses_default_shipping_idx on public.addresses (profile_id) where is_default_shipping;
create unique index addresses_default_billing_idx on public.addresses (profile_id) where is_default_billing;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- Carts: one active cart per signed-in customer; guest carts are keyed by a
-- server-issued token stored in an HttpOnly cookie (phase 2).
create table public.carts (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles (id) on delete cascade,
  guest_token  uuid unique,
  currency     public.currency_code not null default 'USD',
  status       public.cart_status not null default 'active',
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint carts_owner_present check (profile_id is not null or guest_token is not null)
);

create unique index carts_one_active_per_profile_idx on public.carts (profile_id)
  where status = 'active' and profile_id is not null;

create trigger carts_set_updated_at
  before update on public.carts
  for each row execute function public.set_updated_at();

create table public.cart_items (
  id                 uuid primary key default gen_random_uuid(),
  cart_id            uuid not null references public.carts (id) on delete cascade,
  variant_id         uuid not null references public.product_variants (id) on delete cascade,
  quantity           integer not null check (quantity between 1 and 99),
  unit_price_minor   public.money_minor not null,   -- snapshot for display; re-priced server-side at checkout
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (cart_id, variant_id)
);

create trigger cart_items_set_updated_at
  before update on public.cart_items
  for each row execute function public.set_updated_at();

create table public.wishlists (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  name        text not null default 'My Wishlist' check (char_length(name) between 1 and 80),
  is_default  boolean not null default false,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index wishlists_profile_idx on public.wishlists (profile_id);
create unique index wishlists_one_default_idx on public.wishlists (profile_id) where is_default;

create trigger wishlists_set_updated_at
  before update on public.wishlists
  for each row execute function public.set_updated_at();

create table public.wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  wishlist_id  uuid not null references public.wishlists (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  variant_id   uuid references public.product_variants (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (wishlist_id, product_id)
);

-- -----------------------------------------------------------------------------
-- RLS — strictly owner-scoped. Admin read access for support.
-- -----------------------------------------------------------------------------
alter table public.addresses enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;

create policy addresses_owner_all on public.addresses
  for all to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));
create policy addresses_select_admin on public.addresses
  for select to authenticated using ((select public.is_admin()));

create policy carts_owner_all on public.carts
  for all to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));
create policy carts_select_admin on public.carts
  for select to authenticated using ((select public.is_admin()));

create or replace function public.cart_owner_profile_id(p_cart_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select profile_id from public.carts where id = p_cart_id; $$;

create policy cart_items_owner_all on public.cart_items
  for all to authenticated
  using ((select public.cart_owner_profile_id(cart_id)) = (select public.current_profile_id()))
  with check ((select public.cart_owner_profile_id(cart_id)) = (select public.current_profile_id()));
create policy cart_items_select_admin on public.cart_items
  for select to authenticated using ((select public.is_admin()));

create policy wishlists_owner_all on public.wishlists
  for all to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));
create policy wishlists_select_public on public.wishlists
  for select to anon, authenticated using (is_public = true);

create or replace function public.wishlist_owner_profile_id(p_wishlist_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select profile_id from public.wishlists where id = p_wishlist_id; $$;

create or replace function public.wishlist_is_public(p_wishlist_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce((select is_public from public.wishlists where id = p_wishlist_id), false); $$;

create policy wishlist_items_owner_all on public.wishlist_items
  for all to authenticated
  using ((select public.wishlist_owner_profile_id(wishlist_id)) = (select public.current_profile_id()))
  with check ((select public.wishlist_owner_profile_id(wishlist_id)) = (select public.current_profile_id()));
create policy wishlist_items_select_public on public.wishlist_items
  for select to anon, authenticated using ((select public.wishlist_is_public(wishlist_id)));
