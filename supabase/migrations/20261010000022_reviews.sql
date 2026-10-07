-- =============================================================================
-- Migration 0022 (Phase 6A): product reviews and ratings.
-- -----------------------------------------------------------------------------
-- Builds on the Phase 1 `reviews` / `review_images` tables. Policy (approved):
--   * verified buyers only: one review per product per customer, written
--     from a delivered order item of a paid (possibly since refunded or
--     returned) order, within `reviews.window_days` (30) of delivery;
--   * pre-moderation: every new or edited review is `pending` and hidden
--     until an administrator approves it; rejections carry a reason;
--   * up to `reviews.max_images` (4) photos, moderated with the review;
--   * one public reply per review from the vendor's owner/manager, published
--     immediately, removable by the vendor or an administrator;
--   * customers can edit (back to moderation) or delete their own review.
-- All writes go through the functions below; API roles keep read access only.
-- Rating totals live in `product_review_stats`, maintained by trigger.
--
--   pending ──approve──► approved ──reject (take down)──► rejected
--      └──reject──► rejected ──approve──► approved
--   edit / new photo (any status) ──► pending
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('reviews.window_days', '30', 'Days after delivery during which a customer can review a purchased product.', true),
  ('reviews.max_images', '4', 'Maximum number of photos on one review.', true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.reviews
  add column vendor_id        uuid references public.vendors (id) on delete cascade,
  add column author_name      text,
  add column purchased_variant text check (purchased_variant is null or char_length(purchased_variant) <= 200),
  add column rejection_reason text check (rejection_reason is null or char_length(rejection_reason) between 3 and 1000);

update public.reviews r
   set vendor_id = p.vendor_id
  from public.products p
 where p.id = r.product_id;

alter table public.reviews
  alter column vendor_id set not null,
  add constraint reviews_vendor_reply_length check (vendor_reply is null or char_length(vendor_reply) >= 2);

create index reviews_vendor_idx on public.reviews (vendor_id, status, created_at desc);
create index reviews_status_idx on public.reviews (status, created_at);

create unique index review_images_path_idx on public.review_images (storage_path);

-- Public display name: first name and last initial ("Jane D."), never the
-- full name or email.
create or replace function public.review_author_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
             when array_length(parts, 1) >= 2 then left(parts[1], 40) || ' ' || left(parts[array_length(parts, 1)], 1) || '.'
             else left(parts[1], 40)
           end
      from (select regexp_split_to_array(trim(full_name), '\s+') as parts
              from public.profiles
             where id = p_profile_id and nullif(trim(full_name), '') is not null) n
  ), 'Verified buyer');
$$;

update public.reviews set author_name = public.review_author_name(customer_id) where author_name is null;
alter table public.reviews
  alter column author_name set not null,
  add constraint reviews_author_name_length check (char_length(author_name) between 1 and 60);

-- -----------------------------------------------------------------------------
-- Rating totals (approved reviews only)
-- -----------------------------------------------------------------------------
create table public.product_review_stats (
  product_id    uuid primary key references public.products (id) on delete cascade,
  review_count  integer not null default 0 check (review_count >= 0),
  rating_sum    integer not null default 0 check (rating_sum >= 0),
  rating_1      integer not null default 0 check (rating_1 >= 0),
  rating_2      integer not null default 0 check (rating_2 >= 0),
  rating_3      integer not null default 0 check (rating_3 >= 0),
  rating_4      integer not null default 0 check (rating_4 >= 0),
  rating_5      integer not null default 0 check (rating_5 >= 0),
  updated_at    timestamptz not null default now(),
  constraint product_review_stats_consistent
    check (review_count = rating_1 + rating_2 + rating_3 + rating_4 + rating_5
       and rating_sum = rating_1 + 2 * rating_2 + 3 * rating_3 + 4 * rating_4 + 5 * rating_5)
);

create or replace function public.refresh_product_review_stats_internal(p_product_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.product_review_stats as s
    (product_id, review_count, rating_sum, rating_1, rating_2, rating_3, rating_4, rating_5, updated_at)
  select p.id,
         count(r.id)::integer,
         coalesce(sum(r.rating), 0)::integer,
         count(r.id) filter (where r.rating = 1)::integer,
         count(r.id) filter (where r.rating = 2)::integer,
         count(r.id) filter (where r.rating = 3)::integer,
         count(r.id) filter (where r.rating = 4)::integer,
         count(r.id) filter (where r.rating = 5)::integer,
         now()
    from public.products p
    left join public.reviews r on r.product_id = p.id and r.status = 'approved'
   where p.id = p_product_id
   group by p.id
  on conflict (product_id) do update
     set review_count = excluded.review_count, rating_sum = excluded.rating_sum,
         rating_1 = excluded.rating_1, rating_2 = excluded.rating_2, rating_3 = excluded.rating_3,
         rating_4 = excluded.rating_4, rating_5 = excluded.rating_5, updated_at = excluded.updated_at;
$$;

create or replace function public.reviews_refresh_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.refresh_product_review_stats_internal(old.product_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    perform public.refresh_product_review_stats_internal(new.product_id);
  end if;
  return null;
end;
$$;

create trigger reviews_refresh_stats
  after insert or delete or update of status, rating, product_id on public.reviews
  for each row execute function public.reviews_refresh_stats();

select public.refresh_product_review_stats_internal(product_id) from (select distinct product_id from public.reviews) r;

-- The Phase 1 column guard allowed direct customer/vendor writes; every write
-- now goes through the functions below, so the guard is retired.
drop trigger reviews_protect_locked_columns on public.reviews;
drop function public.protect_review_locked_columns();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.review_window_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_setting_int('reviews.window_days', 30);
$$;

create or replace function public.review_max_images()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_setting_int('reviews.max_images', 4);
$$;

-- Vendor owner/manager of the review's vendor (replies).
create or replace function public.can_reply_to_review(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_vendor_role(p_vendor_id, array['owner', 'manager']::public.vendor_member_role[]);
$$;

-- Validates review text; raises user-safe messages.
create or replace function public.assert_review_content_internal(p_rating integer, p_title text, p_body text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Choose a rating from 1 to 5 stars.';
  end if;
  if char_length(trim(coalesce(p_title, ''))) > 120 then
    raise exception 'Keep the title under 120 characters.';
  end if;
  if char_length(trim(coalesce(p_body, ''))) < 10 then
    raise exception 'Tell other shoppers a little more (at least 10 characters).';
  end if;
  if char_length(trim(p_body)) > 4000 then
    raise exception 'Keep the review under 4000 characters.';
  end if;
end;
$$;

-- Delivered purchases the signed-in customer can still review: one row per
-- product (the most recent delivery), within the review window, not yet
-- reviewed, for products that are still on sale.
create or replace function public.review_eligibility(p_product_id uuid default null)
returns table (
  order_item_id   uuid,
  order_id        uuid,
  product_id      uuid,
  product_name    text,
  variant_title   text,
  image_path      text,
  delivered_at    timestamptz,
  window_ends_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select e.* from (
    select distinct on (oi.product_id)
           oi.id, oi.order_id, oi.product_id, oi.product_name, oi.variant_title, oi.image_path, vo.delivered_at,
           vo.delivered_at + make_interval(days => public.review_window_days())
      from public.order_items oi
      join public.vendor_orders vo on vo.id = oi.vendor_order_id
      join public.orders o on o.id = oi.order_id
     where o.customer_id = public.current_profile_id()
       and oi.product_id is not null
       and (p_product_id is null or oi.product_id = p_product_id)
       and o.payment_status in ('paid', 'partially_refunded', 'refunded')
       and vo.delivered_at is not null
       and now() <= vo.delivered_at + make_interval(days => public.review_window_days())
       and public.product_is_public(oi.product_id)
       and not exists (select 1 from public.reviews r where r.product_id = oi.product_id and r.customer_id = o.customer_id)
     order by oi.product_id, vo.delivered_at desc, oi.id
  ) e
  order by e.delivered_at desc, e.product_name;
$$;

-- -----------------------------------------------------------------------------
-- Customer actions
-- -----------------------------------------------------------------------------
create or replace function public.submit_review(
  p_order_item_id uuid,
  p_rating        integer,
  p_title         text,
  p_body          text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_item    public.order_items;
  v_order   public.orders;
  v_vo      public.vendor_orders;
  v_id      uuid;
begin
  select * into v_item from public.order_items where id = p_order_item_id;
  if found then
    select * into v_order from public.orders where id = v_item.order_id;
  end if;
  if not found or v_order.customer_id <> v_profile then
    raise exception 'Purchase not found.' using errcode = 'no_data_found';
  end if;
  select * into v_vo from public.vendor_orders where id = v_item.vendor_order_id;

  if v_item.product_id is null or not public.product_is_public(v_item.product_id) then
    raise exception 'This product is no longer available to review.';
  end if;
  if v_order.payment_status not in ('paid', 'partially_refunded', 'refunded') then
    raise exception 'Only paid orders can be reviewed.';
  end if;
  if v_vo.delivered_at is null then
    raise exception 'You can review this item once it has been delivered.';
  end if;
  if now() > v_vo.delivered_at + make_interval(days => public.review_window_days()) then
    raise exception 'The % day review window for this item has closed.', public.review_window_days();
  end if;
  if exists (select 1 from public.reviews where product_id = v_item.product_id and customer_id = v_profile) then
    raise exception 'You have already reviewed this product. You can edit your review instead.';
  end if;
  perform public.assert_review_content_internal(p_rating, p_title, p_body);

  begin
    insert into public.reviews (product_id, vendor_id, customer_id, order_item_id, rating, title, body, status,
                                author_name, purchased_variant)
    values (v_item.product_id, v_item.vendor_id, v_profile, v_item.id, p_rating,
            nullif(trim(coalesce(p_title, '')), ''), trim(p_body), 'pending',
            public.review_author_name(v_profile), left(nullif(trim(v_item.variant_title), ''), 200))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You have already reviewed this product. You can edit your review instead.';
  end;

  perform public.log_audit_event('review.submitted', 'review', v_id::text,
    jsonb_build_object('product_id', v_item.product_id, 'rating', p_rating));
  return v_id;
end;
$$;

create or replace function public.update_review(
  p_review_id uuid,
  p_rating    integer,
  p_title     text,
  p_body      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_review  public.reviews;
  v_title   text := nullif(trim(coalesce(p_title, '')), '');
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or v_review.customer_id <> v_profile then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;
  perform public.assert_review_content_internal(p_rating, p_title, p_body);

  if v_review.rating = p_rating and v_review.title is not distinct from v_title and v_review.body = trim(p_body) then
    return;
  end if;
  update public.reviews
     set rating = p_rating, title = v_title, body = trim(p_body), status = 'pending', rejection_reason = null,
         author_name = public.review_author_name(v_profile)
   where id = v_review.id;
  perform public.log_audit_event('review.updated', 'review', v_review.id::text,
    jsonb_build_object('previous_status', v_review.status, 'rating', p_rating));
end;
$$;

-- Deletes the caller's review; returns the photo paths so the app can remove
-- the files from storage.
create or replace function public.delete_review(p_review_id uuid)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_paths  text[];
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or v_review.customer_id is distinct from public.current_profile_id() then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;
  select coalesce(array_agg(storage_path order by position), '{}') into v_paths
    from public.review_images where review_id = v_review.id;
  delete from public.reviews where id = v_review.id;
  perform public.log_audit_event('review.deleted', 'review', v_review.id::text,
    jsonb_build_object('product_id', v_review.product_id, 'status', v_review.status));
  return query select unnest(v_paths);
end;
$$;

-- Attaches an uploaded photo (review-images/<profile_id>/<review_id>/<file>).
-- A new photo is new content, so the review goes back to moderation.
create or replace function public.attach_review_image(p_review_id uuid, p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile uuid := public.require_active_customer();
  v_review  public.reviews;
  v_count   integer;
  v_id      uuid;
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or v_review.customer_id <> v_profile then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || v_profile::text || '/' || v_review.id::text || '/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$') then
    raise exception 'This photo was not uploaded for this review.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'review-images' and name = p_storage_path) then
    raise exception 'Upload the photo before adding it to your review.';
  end if;
  select count(*) into v_count from public.review_images where review_id = v_review.id;
  if v_count >= public.review_max_images() then
    raise exception 'You can add up to % photos to a review.', public.review_max_images();
  end if;
  if exists (select 1 from public.review_images where storage_path = p_storage_path) then
    raise exception 'This photo is already on your review.';
  end if;

  insert into public.review_images (review_id, storage_path, position)
  values (v_review.id, p_storage_path,
          coalesce((select max(position) + 1 from public.review_images where review_id = v_review.id), 0))
  returning id into v_id;
  if v_review.status <> 'pending' then
    update public.reviews set status = 'pending', rejection_reason = null where id = v_review.id;
  end if;
  return v_id;
end;
$$;

-- Removes a photo from the caller's review; returns its path for storage cleanup.
create or replace function public.remove_review_image(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image public.review_images;
begin
  select * into v_image from public.review_images where id = p_image_id for update;
  if not found or public.review_customer_id(v_image.review_id) is distinct from public.current_profile_id() then
    raise exception 'Photo not found.' using errcode = 'no_data_found';
  end if;
  delete from public.review_images where id = v_image.id;
  return v_image.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vendor replies (owner/manager); administrators can remove them
-- -----------------------------------------------------------------------------
create or replace function public.reply_to_review(p_review_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or not public.can_reply_to_review(v_review.vendor_id) or v_review.status <> 'approved' then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;
  if char_length(trim(coalesce(p_reply, ''))) < 2 then
    raise exception 'Write a reply (at least 2 characters).';
  end if;
  if char_length(trim(p_reply)) > 2000 then
    raise exception 'Keep the reply under 2000 characters.';
  end if;
  update public.reviews
     set vendor_reply = trim(p_reply), vendor_replied_at = now()
   where id = v_review.id;
  perform public.log_audit_event('review.replied', 'review', v_review.id::text,
    jsonb_build_object('vendor_id', v_review.vendor_id, 'edited', v_review.vendor_reply is not null));
end;
$$;

create or replace function public.remove_review_reply(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
begin
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found or not (public.is_admin() or public.can_reply_to_review(v_review.vendor_id)) then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;
  if v_review.vendor_reply is null then
    raise exception 'This review has no reply.';
  end if;
  update public.reviews set vendor_reply = null, vendor_replied_at = null where id = v_review.id;
  perform public.log_audit_event('review.reply_removed', 'review', v_review.id::text,
    jsonb_build_object('vendor_id', v_review.vendor_id, 'by_admin', public.is_admin()));
end;
$$;

-- -----------------------------------------------------------------------------
-- Administrator moderation
-- -----------------------------------------------------------------------------
create or replace function public.moderate_review(p_review_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
begin
  if not public.is_admin() then
    raise exception 'only administrators can moderate reviews' using errcode = 'insufficient_privilege';
  end if;
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review not found.' using errcode = 'no_data_found';
  end if;

  if p_approve then
    if v_review.status = 'approved' then
      raise exception 'This review is already published.';
    end if;
    update public.reviews
       set status = 'approved', rejection_reason = null, moderated_by = public.current_profile_id(), moderated_at = now()
     where id = v_review.id;
  else
    if v_review.status = 'rejected' then
      raise exception 'This review is already rejected.';
    end if;
    if char_length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Give the customer a reason (at least 3 characters).';
    end if;
    update public.reviews
       set status = 'rejected', rejection_reason = left(trim(p_reason), 1000),
           moderated_by = public.current_profile_id(), moderated_at = now()
     where id = v_review.id;
  end if;
  perform public.log_audit_event(case when p_approve then 'review.approved' else 'review.rejected' end,
    'review', v_review.id::text,
    jsonb_build_object('product_id', v_review.product_id, 'previous_status', v_review.status));
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS: read-only for API roles
-- -----------------------------------------------------------------------------
drop policy reviews_insert_own on public.reviews;
drop policy reviews_update_own on public.reviews;
drop policy reviews_delete_own on public.reviews;
drop policy reviews_select_vendor on public.reviews;   -- vendors see published reviews (public policy)
drop policy reviews_update_vendor on public.reviews;
drop policy reviews_admin_all on public.reviews;
create policy reviews_select_admin on public.reviews
  for select to authenticated using ((select public.is_admin()));

drop policy review_images_owner_all on public.review_images;
drop policy review_images_admin_all on public.review_images;
create policy review_images_select_own on public.review_images
  for select to authenticated
  using ((select public.review_customer_id(review_id)) = (select public.current_profile_id()));
create policy review_images_select_admin on public.review_images
  for select to authenticated using ((select public.is_admin()));

alter table public.product_review_stats enable row level security;
create policy product_review_stats_select_public on public.product_review_stats
  for select to anon, authenticated using ((select public.product_is_public(product_id)));
create policy product_review_stats_select_admin on public.product_review_stats
  for select to authenticated using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Storage: review photos
-- Files are served from the public bucket by URL (random paths). Object rows
-- (listing) are visible only to the author, admins, or once the photo belongs
-- to a published review. Uploads must sit under the author's own review.
-- -----------------------------------------------------------------------------
create or replace function public.storage_segment_uuid(p_name text, p_index integer)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[p_index] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (storage.foldername(p_name))[p_index]::uuid
    else null
  end;
$$;

create or replace function public.review_image_is_public(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.review_images ri
      join public.reviews r on r.id = ri.review_id
     where ri.storage_path = p_storage_path and r.status = 'approved'
  );
$$;

drop policy "public buckets are readable" on storage.objects;
create policy "public buckets are readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id in ('product-images','vendor-logos','vendor-covers','avatars','banners'));

drop policy "users manage own avatars and review images" on storage.objects;
create policy "users manage own avatars" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and public.storage_owner_segment(name) = public.current_profile_id())
  with check (bucket_id = 'avatars' and public.storage_owner_segment(name) = public.current_profile_id());

create policy "review photos of published reviews are readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'review-images' and public.review_image_is_public(name));
create policy "authors read own review photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'review-images' and public.storage_owner_segment(name) = public.current_profile_id());
create policy "authors upload photos to own reviews" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'review-images'
    and public.storage_owner_segment(name) = public.current_profile_id()
    and public.review_customer_id(public.storage_segment_uuid(name, 2)) = public.current_profile_id()
  );
create policy "authors update photos of own reviews" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'review-images'
    and public.storage_owner_segment(name) = public.current_profile_id()
    and public.review_customer_id(public.storage_segment_uuid(name, 2)) = public.current_profile_id()
  )
  with check (
    bucket_id = 'review-images'
    and public.storage_owner_segment(name) = public.current_profile_id()
    and public.review_customer_id(public.storage_segment_uuid(name, 2)) = public.current_profile_id()
  );
-- Deleting stays possible after the review itself is gone (file cleanup).
create policy "authors delete own review photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'review-images' and public.storage_owner_segment(name) = public.current_profile_id());

-- -----------------------------------------------------------------------------
-- Public catalog view: rating totals for product cards
-- -----------------------------------------------------------------------------
create or replace view public.product_listings as
select
  p.id,
  p.slug,
  p.name,
  p.short_description,
  p.currency,
  p.vendor_id,
  p.category_id,
  p.brand_id,
  p.tags,
  p.published_at,
  p.created_at,
  s.slug           as store_slug,
  s.name           as store_name,
  b.slug           as brand_slug,
  b.name           as brand_name,
  c.slug           as category_slug,
  c.name           as category_name,
  pr.min_price_minor,
  pr.max_price_minor,
  pr.compare_at_price_minor,
  img.storage_path as primary_image_path,
  img.alt_text     as primary_image_alt,
  coalesce(inv.in_stock, false) as in_stock,
  p.search_vector,
  coalesce(rs.review_count, 0) as review_count,
  coalesce(rs.rating_sum, 0)   as rating_sum
from public.products p
join public.vendors v on v.id = p.vendor_id and v.status = 'approved'
left join public.stores s on s.vendor_id = v.id and s.status = 'published'
left join public.brands b on b.id = p.brand_id and b.is_active
left join public.categories c on c.id = p.category_id and c.is_active
join lateral (
  select min(pv.price_minor) as min_price_minor,
         max(pv.price_minor) as max_price_minor,
         max(pv.compare_at_price_minor) as compare_at_price_minor
  from public.product_variants pv
  where pv.product_id = p.id and pv.is_active
) pr on pr.min_price_minor is not null
left join lateral (
  select pi.storage_path, pi.alt_text
  from public.product_images pi
  where pi.product_id = p.id
  order by pi.is_primary desc, pi.position asc
  limit 1
) img on true
left join lateral (
  select bool_or(not i.track_inventory or i.allow_backorder or i.available_quantity > 0) as in_stock
  from public.inventory i
  join public.product_variants pv on pv.id = i.variant_id
  where pv.product_id = p.id and pv.is_active
) inv on true
left join public.product_review_stats rs on rs.product_id = p.id
where p.status = 'active';

comment on view public.product_listings is
  'Public catalog: active products of approved vendors with price range, primary image, stock flag and approved-review totals.';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.reviews, public.review_images, public.product_review_stats from anon, authenticated;
grant select on public.reviews, public.review_images, public.product_review_stats to anon, authenticated;
grant all on public.reviews, public.review_images, public.product_review_stats to service_role;

revoke all on function
  public.refresh_product_review_stats_internal(uuid),
  public.reviews_refresh_stats(),
  public.assert_review_content_internal(integer, text, text),
  public.review_author_name(uuid)
from public, anon, authenticated, service_role;

revoke all on function
  public.review_window_days(),
  public.review_max_images(),
  public.can_reply_to_review(uuid),
  public.review_eligibility(uuid),
  public.submit_review(uuid, integer, text, text),
  public.update_review(uuid, integer, text, text),
  public.delete_review(uuid),
  public.attach_review_image(uuid, text),
  public.remove_review_image(uuid),
  public.reply_to_review(uuid, text),
  public.remove_review_reply(uuid),
  public.moderate_review(uuid, boolean, text)
from public, anon;

grant execute on function
  public.review_window_days(),
  public.review_max_images(),
  public.can_reply_to_review(uuid),
  public.review_eligibility(uuid),
  public.submit_review(uuid, integer, text, text),
  public.update_review(uuid, integer, text, text),
  public.delete_review(uuid),
  public.attach_review_image(uuid, text),
  public.remove_review_image(uuid),
  public.reply_to_review(uuid, text),
  public.remove_review_reply(uuid),
  public.moderate_review(uuid, boolean, text)
to authenticated, service_role;

-- Storage policy helpers run for every visitor.
revoke all on function public.storage_segment_uuid(text, integer), public.review_image_is_public(text) from public;
grant execute on function public.storage_segment_uuid(text, integer), public.review_image_is_public(text)
  to anon, authenticated, service_role;
