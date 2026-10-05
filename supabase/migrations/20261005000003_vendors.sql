-- =============================================================================
-- Migration 0003: vendors, vendor members, applications, stores
-- -----------------------------------------------------------------------------
-- A `vendor` is the business entity (legal/commercial identity, commission
-- override, status). A `store` is the vendor's public storefront presentation.
-- `vendor_users` links profiles to a vendor with a member role so a vendor can
-- have multiple operators. `vendor_applications` is the onboarding request
-- an admin reviews before a vendor row is created.
-- =============================================================================

create table public.vendors (
  id                   uuid primary key default gen_random_uuid(),
  slug                 public.slug_text not null unique,
  legal_name           text not null check (char_length(legal_name) between 2 and 160),
  display_name         text not null check (char_length(display_name) between 2 and 120),
  contact_email        citext not null check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contact_phone        text check (contact_phone is null or contact_phone ~ '^\+?[0-9(][0-9 ()-]{6,19}$'),
  status               public.vendor_status not null default 'pending',
  commission_rate_bps  public.basis_points,            -- null = inherit category/global rule
  default_currency     public.currency_code not null default 'USD',
  tax_id               text,
  approved_at          timestamptz,
  approved_by          uuid references public.profiles (id) on delete set null,
  suspended_at         timestamptz,
  suspension_reason    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index vendors_status_idx on public.vendors (status);

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

create table public.vendor_users (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  role        public.vendor_member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (vendor_id, profile_id)
);

create index vendor_users_profile_idx on public.vendor_users (profile_id);

create trigger vendor_users_set_updated_at
  before update on public.vendor_users
  for each row execute function public.set_updated_at();

-- Exactly one owner per vendor.
create unique index vendor_users_single_owner_idx
  on public.vendor_users (vendor_id) where role = 'owner';

create table public.vendor_applications (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  business_name     text not null check (char_length(business_name) between 2 and 160),
  business_email    citext not null check (business_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  business_phone    text check (business_phone is null or business_phone ~ '^\+?[0-9(][0-9 ()-]{6,19}$'),
  website_url       text check (website_url is null or website_url ~* '^https?://'),
  description       text not null check (char_length(description) between 20 and 4000),
  product_categories text[] not null default '{}',
  documents         jsonb not null default '[]'::jsonb,  -- storage paths in the private vendor-documents bucket
  status            public.vendor_application_status not null default 'submitted',
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  rejection_reason  text,
  vendor_id         uuid references public.vendors (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index vendor_applications_profile_idx on public.vendor_applications (profile_id);
create index vendor_applications_status_idx on public.vendor_applications (status, created_at);

-- A profile may only have one application in flight at a time.
create unique index vendor_applications_one_open_per_profile_idx
  on public.vendor_applications (profile_id) where status in ('submitted', 'under_review');

create trigger vendor_applications_set_updated_at
  before update on public.vendor_applications
  for each row execute function public.set_updated_at();

create table public.stores (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null unique references public.vendors (id) on delete cascade,
  slug              public.slug_text not null unique,
  name              text not null check (char_length(name) between 2 and 120),
  tagline           text check (tagline is null or char_length(tagline) <= 160),
  description       text,
  logo_path         text,
  cover_path        text,
  status            public.store_status not null default 'draft',
  return_policy     text,
  shipping_policy   text,
  social_links      jsonb not null default '{}'::jsonb,
  seo_title         text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description   text check (seo_description is null or char_length(seo_description) <= 200),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index stores_status_idx on public.stores (status);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Vendor membership helpers (security definer so policies never recurse)
-- -----------------------------------------------------------------------------
create or replace function public.is_vendor_member(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vendor_users vu
    join public.profiles p on p.id = vu.profile_id
    where vu.vendor_id = p_vendor_id
      and p.user_id = auth.uid()
      and p.status = 'active'
  );
$$;

create or replace function public.has_vendor_role(p_vendor_id uuid, p_roles public.vendor_member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vendor_users vu
    join public.profiles p on p.id = vu.profile_id
    where vu.vendor_id = p_vendor_id
      and vu.role = any (p_roles)
      and p.user_id = auth.uid()
      and p.status = 'active'
  );
$$;

create or replace function public.current_vendor_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select vu.vendor_id
  from public.vendor_users vu
  join public.profiles p on p.id = vu.profile_id
  where p.user_id = auth.uid()
    and p.status = 'active';
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.vendors enable row level security;
alter table public.vendor_users enable row level security;
alter table public.vendor_applications enable row level security;
alter table public.stores enable row level security;

-- vendors: public can see approved vendors (needed for storefront pages);
-- members see their own vendor in any status; admins see all.
create policy vendors_select_public on public.vendors
  for select to anon, authenticated
  using (status = 'approved');

create policy vendors_select_member on public.vendors
  for select to authenticated
  using ((select public.is_vendor_member(id)));

create policy vendors_select_admin on public.vendors
  for select to authenticated
  using ((select public.is_admin()));

-- Owners/managers may edit presentation fields. Status, commission and approval
-- columns are locked to privileged sessions by the trigger below (policies must
-- not query their own table, so column locking lives in a trigger).
create policy vendors_update_member on public.vendors
  for update to authenticated
  using ((select public.has_vendor_role(id, array['owner','manager']::public.vendor_member_role[])))
  with check ((select public.has_vendor_role(id, array['owner','manager']::public.vendor_member_role[])));

create or replace function public.protect_vendor_locked_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.commission_rate_bps is distinct from old.commission_rate_bps
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.suspended_at is distinct from old.suspended_at
     or new.suspension_reason is distinct from old.suspension_reason then
    raise exception 'vendor status, commission and approval fields can only be changed by an administrator'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger vendors_protect_locked_columns
  before update on public.vendors
  for each row execute function public.protect_vendor_locked_columns();

create policy vendors_admin_all on public.vendors
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- vendor_users
create policy vendor_users_select_member on public.vendor_users
  for select to authenticated
  using ((select public.is_vendor_member(vendor_id)));

create policy vendor_users_manage_owner on public.vendor_users
  for all to authenticated
  using ((select public.has_vendor_role(vendor_id, array['owner']::public.vendor_member_role[])))
  with check ((select public.has_vendor_role(vendor_id, array['owner']::public.vendor_member_role[])));

create policy vendor_users_admin_all on public.vendor_users
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- vendor_applications: applicants manage their own submission while it is open.
create policy vendor_applications_select_own on public.vendor_applications
  for select to authenticated
  using (profile_id = (select public.current_profile_id()));

create policy vendor_applications_insert_own on public.vendor_applications
  for insert to authenticated
  with check (
    profile_id = (select public.current_profile_id())
    and status = 'submitted'
    and reviewed_by is null and reviewed_at is null and vendor_id is null
  );

create policy vendor_applications_update_own_open on public.vendor_applications
  for update to authenticated
  using (profile_id = (select public.current_profile_id()) and status = 'submitted')
  with check (
    profile_id = (select public.current_profile_id())
    and status = 'submitted'
    and reviewed_by is null and reviewed_at is null and vendor_id is null
  );

create policy vendor_applications_admin_all on public.vendor_applications
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- stores
create policy stores_select_public on public.stores
  for select to anon, authenticated
  using (
    status = 'published'
    and exists (select 1 from public.vendors v where v.id = stores.vendor_id and v.status = 'approved')
  );

create policy stores_select_member on public.stores
  for select to authenticated
  using ((select public.is_vendor_member(vendor_id)));

create policy stores_manage_member on public.stores
  for all to authenticated
  using ((select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])))
  with check ((select public.has_vendor_role(vendor_id, array['owner','manager']::public.vendor_member_role[])));

create policy stores_admin_all on public.stores
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
