-- =============================================================================
-- Migration 0012 (Phase 2): vendor review workflow, product moderation,
-- public catalog views and full-text search.
-- -----------------------------------------------------------------------------
-- Multi-step administrative state changes run as SECURITY DEFINER functions so
-- they are atomic, audited and impossible to half-apply from the client.
-- Public catalog reads go through owner views that expose ONLY rows that are
-- already public (active products of approved vendors) and no stock figures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Full-text search on products
-- -----------------------------------------------------------------------------
create or replace function public.product_search_text(
  p_name text, p_short_description text, p_description text, p_tags text[]
)
returns text
language sql
immutable
as $$
  select concat_ws(' ',
    coalesce(p_name, ''),
    coalesce(p_short_description, ''),
    coalesce(left(p_description, 4000), ''),
    coalesce(array_to_string(p_tags, ' '), '')
  );
$$;

alter table public.products
  add column search_vector tsvector
  generated always as (
    to_tsvector('simple', public.product_search_text(name, short_description, description, tags))
  ) stored;

create index products_search_vector_idx on public.products using gin (search_vector);

-- -----------------------------------------------------------------------------
-- Vendor application review
-- -----------------------------------------------------------------------------
create or replace function public.approve_vendor_application(
  p_application_id      uuid,
  p_slug                text,
  p_commission_rate_bps integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app       public.vendor_applications;
  v_vendor_id uuid;
  v_slug      public.slug_text;
  v_actor     uuid := public.current_profile_id();
begin
  if not public.is_admin() then
    raise exception 'only administrators can approve vendor applications' using errcode = 'insufficient_privilege';
  end if;

  v_slug := p_slug; -- domain check validates the format

  select * into v_app from public.vendor_applications where id = p_application_id for update;
  if not found then
    raise exception 'vendor application % does not exist', p_application_id using errcode = 'no_data_found';
  end if;
  if v_app.status not in ('submitted', 'under_review') then
    raise exception 'this application has already been %', v_app.status using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.vendor_users vu where vu.profile_id = v_app.profile_id) then
    raise exception 'the applicant already belongs to a vendor' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.vendors v where v.slug = v_slug) or exists (select 1 from public.stores s where s.slug = v_slug) then
    raise exception 'the slug "%" is already in use', v_slug using errcode = 'unique_violation';
  end if;

  insert into public.vendors
    (slug, legal_name, display_name, contact_email, contact_phone, status, commission_rate_bps, approved_at, approved_by)
  values
    (v_slug, v_app.business_name, v_app.business_name, v_app.business_email, v_app.business_phone, 'approved',
     p_commission_rate_bps, now(), v_actor)
  returning id into v_vendor_id;

  insert into public.vendor_users (vendor_id, profile_id, role) values (v_vendor_id, v_app.profile_id, 'owner');

  insert into public.stores (vendor_id, slug, name, status) values (v_vendor_id, v_slug, v_app.business_name, 'draft');

  -- Customers become vendors; administrators keep their role.
  update public.profiles set role = 'vendor' where id = v_app.profile_id and role = 'customer';

  update public.vendor_applications
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), vendor_id = v_vendor_id, rejection_reason = null
   where id = v_app.id;

  perform public.log_audit_event(
    'vendor.approved', 'vendor', v_vendor_id::text,
    jsonb_build_object('application_id', v_app.id, 'slug', v_slug, 'commission_rate_bps', p_commission_rate_bps)
  );
  return v_vendor_id;
end;
$$;

create or replace function public.reject_vendor_application(p_application_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.vendor_applications;
begin
  if not public.is_admin() then
    raise exception 'only administrators can reject vendor applications' using errcode = 'insufficient_privilege';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'a rejection reason is required' using errcode = 'check_violation';
  end if;

  select * into v_app from public.vendor_applications where id = p_application_id for update;
  if not found then
    raise exception 'vendor application % does not exist', p_application_id using errcode = 'no_data_found';
  end if;
  if v_app.status not in ('submitted', 'under_review') then
    raise exception 'this application has already been %', v_app.status using errcode = 'check_violation';
  end if;

  update public.vendor_applications
     set status = 'rejected', rejection_reason = trim(p_reason), reviewed_by = public.current_profile_id(), reviewed_at = now()
   where id = v_app.id;

  perform public.log_audit_event('vendor.application_rejected', 'vendor_application', v_app.id::text, jsonb_build_object('reason', trim(p_reason)));
end;
$$;

-- Administrative vendor status changes (suspend / reinstate / close) with audit trail.
create or replace function public.set_vendor_status(p_vendor_id uuid, p_status public.vendor_status, p_reason text default null)
returns public.vendors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor public.vendors;
begin
  if not public.is_admin() then
    raise exception 'only administrators can change vendor status' using errcode = 'insufficient_privilege';
  end if;
  if p_status = 'suspended' and (p_reason is null or char_length(trim(p_reason)) < 3) then
    raise exception 'a suspension reason is required' using errcode = 'check_violation';
  end if;

  select * into v_vendor from public.vendors where id = p_vendor_id for update;
  if not found then
    raise exception 'vendor % does not exist', p_vendor_id using errcode = 'no_data_found';
  end if;

  update public.vendors
     set status = p_status,
         suspended_at = case when p_status = 'suspended' then now() else null end,
         suspension_reason = case when p_status = 'suspended' then trim(p_reason) else null end,
         approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end,
         approved_by = case when p_status = 'approved' then coalesce(approved_by, public.current_profile_id()) else approved_by end
   where id = p_vendor_id
   returning * into v_vendor;

  perform public.log_audit_event(
    'vendor.status_changed', 'vendor', p_vendor_id::text,
    jsonb_build_object('status', p_status, 'reason', p_reason)
  );
  return v_vendor;
end;
$$;

-- -----------------------------------------------------------------------------
-- Product moderation
-- -----------------------------------------------------------------------------
create or replace function public.moderate_product(p_product_id uuid, p_approve boolean, p_reason text default null)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
begin
  if not public.is_admin() then
    raise exception 'only administrators can moderate products' using errcode = 'insufficient_privilege';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product % does not exist', p_product_id using errcode = 'no_data_found';
  end if;
  if v_product.status <> 'pending_review' then
    raise exception 'only products pending review can be moderated (current status: %)', v_product.status
      using errcode = 'check_violation';
  end if;

  if p_approve then
    if not exists (select 1 from public.product_variants pv where pv.product_id = p_product_id and pv.is_active) then
      raise exception 'a product needs at least one active variant before it can be approved' using errcode = 'check_violation';
    end if;
    update public.products
       set status = 'active', approved_at = now(), approved_by = public.current_profile_id(),
           published_at = coalesce(published_at, now()), rejection_reason = null
     where id = p_product_id
     returning * into v_product;
    perform public.log_audit_event('product.approved', 'product', p_product_id::text, jsonb_build_object('vendor_id', v_product.vendor_id));
  else
    if p_reason is null or char_length(trim(p_reason)) < 3 then
      raise exception 'a rejection reason is required' using errcode = 'check_violation';
    end if;
    update public.products
       set status = 'rejected', rejection_reason = trim(p_reason), approved_at = null, approved_by = null
     where id = p_product_id
     returning * into v_product;
    perform public.log_audit_event('product.rejected', 'product', p_product_id::text,
      jsonb_build_object('vendor_id', v_product.vendor_id, 'reason', trim(p_reason)));
  end if;
  return v_product;
end;
$$;

-- Vendors may unpublish an active product (back to draft) through a controlled
-- path that keeps the approval audit trail intact.
create or replace function public.unpublish_product(p_product_id uuid)
returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'product % does not exist', p_product_id using errcode = 'no_data_found';
  end if;
  if not (public.is_privileged_session() or public.is_vendor_member(v_product.vendor_id)) then
    raise exception 'not allowed to change this product' using errcode = 'insufficient_privilege';
  end if;
  if v_product.status <> 'active' then
    raise exception 'only active products can be unpublished' using errcode = 'check_violation';
  end if;
  update public.products set status = 'draft' where id = p_product_id returning * into v_product;
  return v_product;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public catalog views (owner views: expose only already-public rows)
-- -----------------------------------------------------------------------------
create view public.product_listings as
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
  p.search_vector
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
where p.status = 'active';

comment on view public.product_listings is
  'Public catalog: active products of approved vendors with price range, primary image and stock flag.';

create view public.product_variant_availability as
select
  pv.id         as variant_id,
  pv.product_id,
  pv.sku,
  pv.title,
  pv.options,
  pv.price_minor,
  pv.compare_at_price_minor,
  pv.position,
  pv.is_default,
  coalesce(not i.track_inventory or i.allow_backorder or i.available_quantity > 0, false) as in_stock,
  coalesce(i.track_inventory and not i.allow_backorder and i.available_quantity <= i.low_stock_threshold, false) as is_low_stock
from public.product_variants pv
join public.products p on p.id = pv.product_id and p.status = 'active'
join public.vendors v on v.id = p.vendor_id and v.status = 'approved'
left join public.inventory i on i.variant_id = pv.id
where pv.is_active;

comment on view public.product_variant_availability is
  'Public variant list for active products. Exposes stock as flags only, never quantities.';

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant select on public.product_listings, public.product_variant_availability to anon, authenticated;
grant select on public.product_listings, public.product_variant_availability to service_role;

grant execute on function
  public.approve_vendor_application(uuid, text, integer),
  public.reject_vendor_application(uuid, text),
  public.set_vendor_status(uuid, public.vendor_status, text),
  public.moderate_product(uuid, boolean, text),
  public.unpublish_product(uuid)
to authenticated;

grant execute on function
  public.product_search_text(text, text, text, text[]),
  public.approve_vendor_application(uuid, text, integer),
  public.reject_vendor_application(uuid, text),
  public.set_vendor_status(uuid, public.vendor_status, text),
  public.moderate_product(uuid, boolean, text),
  public.unpublish_product(uuid)
to service_role;
