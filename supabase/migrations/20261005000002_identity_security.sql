-- =============================================================================
-- Migration 0002: identity, roles, security helpers, platform settings, audit log
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles — reference table describing each role in the role model.
-- The enum `user_role` is the source of truth for valid values; this table
-- carries human-readable metadata and a coarse permission manifest that later
-- phases can extend (e.g. granular admin permissions).
-- -----------------------------------------------------------------------------
create table public.roles (
  key          public.user_role primary key,
  name         text not null,
  description  text not null,
  permissions  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

insert into public.roles (key, name, description, permissions) values
  ('customer',    'Customer',    'Shops the marketplace and manages their own account.', '["account:self"]'),
  ('vendor',      'Vendor',      'Operates one or more stores and fulfils their own orders.', '["account:self","vendor:self"]'),
  ('admin',       'Admin',       'Operates the platform: vendors, catalog moderation, finance.', '["account:self","vendor:all","platform:manage"]'),
  ('super_admin', 'Super Admin', 'Full platform control including administrators and settings.', '["*"]');

-- -----------------------------------------------------------------------------
-- profiles — one row per Supabase Auth user. Credentials never live here.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  avatar_url  text,
  role        public.user_role not null default 'customer' references public.roles (key),
  status      public.account_status not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) between 1 and 120),
  constraint profiles_phone_format check (phone is null or phone ~ '^\+?[0-9(][0-9 ()-]{6,19}$')
);

create index profiles_role_idx on public.profiles (role);
create index profiles_status_idx on public.profiles (status);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when an auth user is created.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Security helper functions used by RLS policies.
-- All are STABLE so the planner evaluates them once per statement when wrapped
-- in a scalar sub-select, e.g. `profile_id = (select public.current_profile_id())`.
-- -----------------------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

create or replace function public.current_account_status()
returns public.account_status
language sql
stable
security definer
set search_path = public
as $$
  select p.status from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role in ('admin', 'super_admin') and p.status = 'active'
       from public.profiles p where p.user_id = auth.uid() limit 1),
    false
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'super_admin' and p.status = 'active'
       from public.profiles p where p.user_id = auth.uid() limit 1),
    false
  );
$$;

-- A "privileged session" is any request that is not made by one of the public
-- API roles (anon / authenticated) — i.e. the service role, migrations, seeds,
-- direct database maintenance — or an authenticated administrator.
-- The API role is read from the request JWT (`auth.role()`), which PostgREST
-- always sets; sessions without a JWT are direct database connections and are
-- therefore privileged. Triggers and the inventory functions use this to decide
-- whether protected operations are allowed.
create or replace function public.is_privileged_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), 'direct') not in ('anon', 'authenticated') or public.is_admin();
$$;

-- -----------------------------------------------------------------------------
-- platform_settings — key/value configuration owned by administrators.
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  key          text primary key check (key ~ '^[a-z][a-z0-9_.]{1,80}$'),
  value        jsonb not null,
  description  text,
  is_public    boolean not null default false,
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger platform_settings_set_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

insert into public.platform_settings (key, value, description, is_public) values
  ('platform.name', '"Luxora"', 'Display name of the marketplace.', true),
  ('platform.default_currency', '"USD"', 'ISO-4217 currency used for new vendors, products and orders.', true),
  ('commission.default_bps', '1500', 'Global commission rate in basis points applied when no vendor or category rule matches.', false),
  ('orders.number_prefix', '"LX"', 'Prefix used for human-readable order numbers.', false),
  ('inventory.default_low_stock_threshold', '5', 'Default low-stock threshold for new inventory records.', false);

-- -----------------------------------------------------------------------------
-- audit_logs — append-only record of sensitive actions.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid references public.profiles (id) on delete set null,
  actor_role   public.user_role,
  action       text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  entity_type  text not null check (char_length(entity_type) between 1 and 64),
  entity_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- Writes go through this function so the actor is always derived server-side.
create or replace function public.log_audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_metadata    jsonb default '{}'::jsonb,
  p_ip_address  inet default null,
  p_user_agent  text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := public.current_profile_id();
  v_role       public.user_role := public.current_user_role();
  v_id         bigint;
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, metadata, ip_address, user_agent)
  values (v_profile_id, v_role, p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb), p_ip_address, p_user_agent)
  returning id into v_id;
  return v_id;
end;
$$;

-- Audit logs are immutable.
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are immutable', tg_table_name using errcode = 'restrict_violation';
end;
$$;

create trigger audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_settings enable row level security;
alter table public.audit_logs enable row level security;

-- roles: readable by any authenticated user; managed only by service role.
create policy roles_select_authenticated on public.roles
  for select to authenticated using (true);

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

-- Users may edit their own contact details, but never their role or status.
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and role = (select public.current_user_role())
    and status = (select public.current_account_status())
  );

-- Admins may update any profile; promoting to admin/super_admin is reserved to super admins.
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check (
    (select public.is_admin())
    and (role not in ('admin', 'super_admin') or (select public.is_super_admin()))
  );

-- Profile rows are created by the auth trigger (security definer); no direct inserts.
-- Deletes cascade from auth.users; no direct deletes.

-- platform_settings
create policy platform_settings_select_public on public.platform_settings
  for select to anon, authenticated
  using (is_public = true);

create policy platform_settings_select_admin on public.platform_settings
  for select to authenticated
  using ((select public.is_admin()));

create policy platform_settings_write_super_admin on public.platform_settings
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

-- audit_logs: admins can read; inserts only via log_audit_event (security definer).
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using ((select public.is_admin()));
