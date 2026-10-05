-- =============================================================================
-- Migration 0009: loyalty, notifications, content, banners, analytics events
-- =============================================================================

create table public.loyalty_accounts (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null unique references public.profiles (id) on delete cascade,
  points_balance   integer not null default 0 check (points_balance >= 0),
  lifetime_points  integer not null default 0 check (lifetime_points >= 0),
  tier             text not null default 'member' check (tier ~ '^[a-z][a-z0-9_]{1,30}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger loyalty_accounts_set_updated_at
  before update on public.loyalty_accounts
  for each row execute function public.set_updated_at();

create table public.loyalty_transactions (
  id             bigint generated always as identity primary key,
  account_id     uuid not null references public.loyalty_accounts (id) on delete cascade,
  type           public.loyalty_transaction_type not null,
  points_delta   integer not null check (points_delta <> 0),
  balance_after  integer not null check (balance_after >= 0),
  order_id       uuid references public.orders (id) on delete set null,
  description    text,
  expires_at     timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index loyalty_transactions_account_idx on public.loyalty_transactions (account_id, created_at desc);

create trigger loyalty_transactions_immutable
  before update or delete on public.loyalty_transactions
  for each row execute function public.prevent_mutation();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  title       text not null check (char_length(title) between 1 and 160),
  body        text check (body is null or char_length(body) <= 2000),
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_profile_idx on public.notifications (profile_id, created_at desc);
create index notifications_unread_idx on public.notifications (profile_id) where read_at is null;

create table public.content_sections (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z][a-z0-9_.-]{1,80}$'),
  title       text,
  body        jsonb not null default '{}'::jsonb,   -- structured content, rendered by typed section components
  placement   text not null check (placement ~ '^[a-z][a-z0-9_]{1,40}$'),
  position    integer not null default 0,
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint content_sections_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index content_sections_placement_idx on public.content_sections (placement, position) where is_active;

create trigger content_sections_set_updated_at
  before update on public.content_sections
  for each row execute function public.set_updated_at();

create table public.banners (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 120),
  subtitle           text check (subtitle is null or char_length(subtitle) <= 200),
  image_path         text not null,
  mobile_image_path  text,
  link_url           text check (link_url is null or link_url ~ '^(/|https?://)'),
  cta_label          text check (cta_label is null or char_length(cta_label) <= 40),
  placement          text not null check (placement ~ '^[a-z][a-z0-9_]{1,40}$'),
  position           integer not null default 0,
  is_active          boolean not null default true,
  starts_at          timestamptz,
  ends_at            timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint banners_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index banners_placement_idx on public.banners (placement, position) where is_active;

create trigger banners_set_updated_at
  before update on public.banners
  for each row execute function public.set_updated_at();

-- Analytics events are high-volume and append-only. Ingestion happens via the
-- server (service role) so the client never writes rows directly.
create table public.analytics_events (
  id           bigint generated always as identity primary key,
  event_name   text not null check (event_name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  profile_id   uuid references public.profiles (id) on delete set null,
  session_id   uuid,
  vendor_id    uuid references public.vendors (id) on delete set null,
  product_id   uuid references public.products (id) on delete set null,
  properties   jsonb not null default '{}'::jsonb,
  path         text,
  referrer     text,
  occurred_at  timestamptz not null default now()
);

create index analytics_events_name_time_idx on public.analytics_events (event_name, occurred_at desc);
create index analytics_events_vendor_idx on public.analytics_events (vendor_id, occurred_at desc) where vendor_id is not null;
create index analytics_events_product_idx on public.analytics_events (product_id, occurred_at desc) where product_id is not null;

create trigger analytics_events_immutable
  before update or delete on public.analytics_events
  for each row execute function public.prevent_mutation();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.notifications enable row level security;
alter table public.content_sections enable row level security;
alter table public.banners enable row level security;
alter table public.analytics_events enable row level security;

create policy loyalty_accounts_select_own on public.loyalty_accounts
  for select to authenticated using (profile_id = (select public.current_profile_id()));
create policy loyalty_accounts_admin_all on public.loyalty_accounts
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create or replace function public.loyalty_account_profile_id(p_account_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select profile_id from public.loyalty_accounts where id = p_account_id; $$;

create policy loyalty_transactions_select_own on public.loyalty_transactions
  for select to authenticated using ((select public.loyalty_account_profile_id(account_id)) = (select public.current_profile_id()));
create policy loyalty_transactions_select_admin on public.loyalty_transactions
  for select to authenticated using ((select public.is_admin()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (profile_id = (select public.current_profile_id()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (profile_id = (select public.current_profile_id()))
  with check (profile_id = (select public.current_profile_id()));
create policy notifications_delete_own on public.notifications
  for delete to authenticated using (profile_id = (select public.current_profile_id()));

create policy content_sections_select_public on public.content_sections
  for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy content_sections_admin_all on public.content_sections
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy banners_select_public on public.banners
  for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy banners_admin_all on public.banners
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy analytics_events_select_vendor on public.analytics_events
  for select to authenticated using (vendor_id is not null and (select public.is_vendor_member(vendor_id)));
create policy analytics_events_select_admin on public.analytics_events
  for select to authenticated using ((select public.is_admin()));
