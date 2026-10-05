-- =============================================================================
-- Migration 0010: storage buckets and object policies
-- -----------------------------------------------------------------------------
-- Path conventions (first folder segment is the owner key used by policies):
--   product-images/<vendor_id>/<product_id>/<file>
--   vendor-logos/<vendor_id>/<file>
--   vendor-covers/<vendor_id>/<file>
--   vendor-documents/<profile_id>/<file>        (private — onboarding paperwork)
--   avatars/<profile_id>/<file>
--   review-images/<profile_id>/<review_id>/<file>
--   banners/<file>                              (admin only)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images',   'product-images',   true,  10485760, array['image/jpeg','image/png','image/webp','image/avif']),
  ('vendor-logos',     'vendor-logos',     true,   2097152, array['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('vendor-covers',    'vendor-covers',    true,  10485760, array['image/jpeg','image/png','image/webp','image/avif']),
  ('vendor-documents', 'vendor-documents', false, 10485760, array['application/pdf','image/jpeg','image/png']),
  ('avatars',          'avatars',          true,   2097152, array['image/jpeg','image/png','image/webp']),
  ('review-images',    'review-images',    true,   5242880, array['image/jpeg','image/png','image/webp']),
  ('banners',          'banners',          true,  10485760, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

-- Owner segment helper: first folder of the object path as uuid (null if not a uuid).
create or replace function public.storage_owner_segment(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (storage.foldername(p_name))[1]::uuid
    else null
  end;
$$;

-- Public buckets: anyone can read.
create policy "public buckets are readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('product-images','vendor-logos','vendor-covers','avatars','review-images','banners'));

-- Vendor-owned buckets: members write under their vendor folder.
create policy "vendor members manage vendor assets" on storage.objects
  for all to authenticated
  using (
    bucket_id in ('product-images','vendor-logos','vendor-covers')
    and public.is_vendor_member(public.storage_owner_segment(name))
  )
  with check (
    bucket_id in ('product-images','vendor-logos','vendor-covers')
    and public.is_vendor_member(public.storage_owner_segment(name))
  );

-- Profile-owned buckets: users write under their own profile folder.
create policy "users manage own avatars and review images" on storage.objects
  for all to authenticated
  using (
    bucket_id in ('avatars','review-images')
    and public.storage_owner_segment(name) = public.current_profile_id()
  )
  with check (
    bucket_id in ('avatars','review-images')
    and public.storage_owner_segment(name) = public.current_profile_id()
  );

-- Private vendor documents: applicant reads/writes own folder; admins read all.
create policy "applicants manage own vendor documents" on storage.objects
  for all to authenticated
  using (bucket_id = 'vendor-documents' and public.storage_owner_segment(name) = public.current_profile_id())
  with check (bucket_id = 'vendor-documents' and public.storage_owner_segment(name) = public.current_profile_id());

create policy "admins read vendor documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'vendor-documents' and public.is_admin());

-- Banners: admin write only.
create policy "admins manage banners" on storage.objects
  for all to authenticated
  using (bucket_id = 'banners' and public.is_admin())
  with check (bucket_id = 'banners' and public.is_admin());

-- Admins may moderate any object in public buckets.
create policy "admins manage public bucket objects" on storage.objects
  for all to authenticated
  using (bucket_id in ('product-images','vendor-logos','vendor-covers','avatars','review-images') and public.is_admin())
  with check (bucket_id in ('product-images','vendor-logos','vendor-covers','avatars','review-images') and public.is_admin());
