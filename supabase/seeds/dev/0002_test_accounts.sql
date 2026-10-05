-- =============================================================================
-- DEVELOPMENT SEED — test accounts (Supabase local stack only)
-- Creates three sign-in-able users. Skipped automatically when the auth schema
-- is not Supabase's (e.g. the plain-Postgres test shim).
--
--   customer@luxora.test  / Password123!   (customer)
--   vendor@luxora.test    / Password123!   (vendor, approved, store published)
--   admin@luxora.test     / Password123!   (super_admin)
-- =============================================================================
do $$
declare
  v_customer uuid := '10000000-0000-4000-8000-000000000001';
  v_vendor   uuid := '10000000-0000-4000-8000-000000000002';
  v_admin    uuid := '10000000-0000-4000-8000-000000000003';
  v_vendor_id uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id'
  ) then
    raise notice 'Skipping test accounts: auth.users is not a Supabase auth schema.';
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
    extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', u.full_name), now(), now(),
    '', '', '', ''
  from (values
    (v_customer, 'customer@luxora.test', 'Casey Customer'),
    (v_vendor,   'vendor@luxora.test',   'Vera Vendor'),
    (v_admin,    'admin@luxora.test',    'Ava Admin')
  ) as u(id, email, full_name)
  on conflict (id) do nothing;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
  from auth.users u
  where u.id in (v_customer, v_vendor, v_admin)
    and not exists (select 1 from auth.identities i where i.user_id = u.id);

  update public.profiles set role = 'super_admin' where user_id = v_admin;

  insert into public.vendors (slug, legal_name, display_name, contact_email, status, approved_at)
  values ('atelier-demo', 'Atelier Demo ApS', 'Atelier Demo', 'vendor@luxora.test', 'approved', now())
  on conflict (slug) do nothing
  returning id into v_vendor_id;
  if v_vendor_id is null then
    select id into v_vendor_id from public.vendors where slug = 'atelier-demo';
  end if;

  insert into public.vendor_users (vendor_id, profile_id, role)
  select v_vendor_id, p.id, 'owner' from public.profiles p where p.user_id = v_vendor
  on conflict (vendor_id, profile_id) do nothing;
  update public.profiles set role = 'vendor' where user_id = v_vendor;

  insert into public.stores (vendor_id, slug, name, tagline, status, published_at)
  values (v_vendor_id, 'atelier-demo', 'Atelier Demo', 'A development storefront.', 'published', now())
  on conflict (vendor_id) do nothing;
end;
$$;
