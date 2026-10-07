-- =============================================================================
-- Migration 0014 (Release 4a): admin category & brand management
-- -----------------------------------------------------------------------------
--   * catalog-assets storage bucket for category images and brand logos
--   * category hierarchy rules: no cycles, at most 3 levels
--   * categories and brands that products use cannot be deleted (deactivate)
--   * set_category_active(): deactivation cascades to subcategories
--   * every category / brand change is audited; commission changes separately
--   * vendors may only use their own brand or brands without an owner
--   * approving a vendor also creates a brand owned by that vendor
-- Customer-facing rule violations raise P0001 with a safe message.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage: catalog-assets (public read, admin write)
--   categories/<category_id>/<file>
--   brands/<brand_id>/<file>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('catalog-assets', 'catalog-assets', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do nothing;

create policy "catalog assets are readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'catalog-assets');

create policy "admins manage catalog assets" on storage.objects
  for all to authenticated
  using (bucket_id = 'catalog-assets' and public.is_admin())
  with check (bucket_id = 'catalog-assets' and public.is_admin());

-- -----------------------------------------------------------------------------
-- Category hierarchy: no cycles, maximum depth 3 (including the subtree moved)
-- -----------------------------------------------------------------------------
create or replace function public.enforce_category_hierarchy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_depth  integer := 1;
  v_height integer := 1;
  v_cursor uuid := new.parent_id;
begin
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'A category cannot be placed inside itself or one of its subcategories.';
    end if;
    v_depth := v_depth + 1;
    if v_depth > 3 then
      raise exception 'Categories can be at most 3 levels deep.';
    end if;
    select c.parent_id into v_cursor from public.categories c where c.id = v_cursor;
  end loop;

  if tg_op = 'UPDATE' then
    with recursive subtree as (
      select c.id, 1 as level from public.categories c where c.id = new.id
      union all
      select c.id, s.level + 1 from public.categories c join subtree s on c.parent_id = s.id where s.level < 10
    )
    select max(level) into v_height from subtree;
  end if;

  if v_depth + v_height - 1 > 3 then
    raise exception 'Moving this category would make its subcategories more than 3 levels deep.';
  end if;
  return new;
end;
$$;

create trigger categories_enforce_hierarchy
  before insert or update of parent_id on public.categories
  for each row execute function public.enforce_category_hierarchy();

-- -----------------------------------------------------------------------------
-- Delete guards: deactivate instead of deleting anything in use
-- -----------------------------------------------------------------------------
create or replace function public.prevent_delete_used_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.categories c where c.parent_id = old.id) then
    raise exception 'This category has subcategories. Move or delete them first, or deactivate it instead.';
  end if;
  if exists (select 1 from public.products p where p.category_id = old.id) then
    raise exception 'Products use this category. Deactivate it instead of deleting it.';
  end if;
  return old;
end;
$$;

create trigger categories_prevent_delete_used
  before delete on public.categories
  for each row execute function public.prevent_delete_used_category();

create or replace function public.prevent_delete_used_brand()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.products p where p.brand_id = old.id) then
    raise exception 'Products use this brand. Deactivate it instead of deleting it.';
  end if;
  return old;
end;
$$;

create trigger brands_prevent_delete_used
  before delete on public.brands
  for each row execute function public.prevent_delete_used_brand();

-- -----------------------------------------------------------------------------
-- Activation: deactivating a category also deactivates its subcategories, so
-- navigation never shows an orphaned child. Reactivation requires an active parent.
-- -----------------------------------------------------------------------------
create or replace function public.set_category_active(p_category_id uuid, p_active boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category public.categories;
  v_count    integer;
begin
  if not public.is_admin() then
    raise exception 'only administrators can change categories' using errcode = 'insufficient_privilege';
  end if;
  select * into v_category from public.categories where id = p_category_id for update;
  if not found then
    raise exception 'Category not found.' using errcode = 'no_data_found';
  end if;

  if p_active then
    if v_category.parent_id is not null
       and not exists (select 1 from public.categories c where c.id = v_category.parent_id and c.is_active) then
      raise exception 'Activate the parent category first.';
    end if;
    update public.categories set is_active = true where id = p_category_id and not is_active;
    get diagnostics v_count = row_count;
    return v_count;
  end if;

  with recursive subtree as (
    select c.id from public.categories c where c.id = p_category_id
    union all
    select c.id from public.categories c join subtree s on c.parent_id = s.id
  )
  update public.categories set is_active = false
   where id in (select id from subtree) and is_active;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit trail for categories and brands
-- -----------------------------------------------------------------------------
create or replace function public.audit_catalog_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := case tg_table_name when 'categories' then 'category' else 'brand' end;
  v_old    jsonb;
  v_new    jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.log_audit_event(v_entity || '.created', v_entity, new.id::text,
      jsonb_build_object('slug', new.slug, 'name', new.name));
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.log_audit_event(v_entity || '.deleted', v_entity, old.id::text,
      jsonb_build_object('slug', old.slug, 'name', old.name));
    return old;
  end if;

  v_old := to_jsonb(old) - 'updated_at';
  v_new := to_jsonb(new) - 'updated_at';
  if v_old = v_new then
    return new;
  end if;
  perform public.log_audit_event(v_entity || '.updated', v_entity, new.id::text,
    jsonb_build_object('changes', (
      select jsonb_object_agg(key, jsonb_build_object('from', v_old -> key, 'to', value))
        from jsonb_each(v_new)
       where (v_old -> key) is distinct from value
    )));
  if (v_old -> 'commission_rate_bps') is distinct from (v_new -> 'commission_rate_bps') then
    perform public.log_audit_event('commission.changed', v_entity, new.id::text,
      jsonb_build_object('from_bps', v_old -> 'commission_rate_bps', 'to_bps', v_new -> 'commission_rate_bps'));
  end if;
  return new;
end;
$$;

create trigger categories_audit
  after insert or update or delete on public.categories
  for each row execute function public.audit_catalog_taxonomy();

create trigger brands_audit
  after insert or update or delete on public.brands
  for each row execute function public.audit_catalog_taxonomy();

-- -----------------------------------------------------------------------------
-- Brand usage: vendors may use their own brand or a brand with no owner.
-- Runs under the caller's RLS, so inactive brands of others are invisible.
-- -----------------------------------------------------------------------------
create or replace function public.enforce_product_brand_usage()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_owner  uuid;
  v_active boolean;
begin
  if new.brand_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.brand_id is not distinct from old.brand_id and new.vendor_id is not distinct from old.vendor_id then
    return new;
  end if;
  if public.is_privileged_session() or public.in_trusted_context() then
    return new;
  end if;

  select b.owner_vendor_id, b.is_active into v_owner, v_active from public.brands b where b.id = new.brand_id;
  if not found or not v_active then
    raise exception 'That brand is not available.';
  end if;
  if v_owner is not null and v_owner <> new.vendor_id then
    raise exception 'You can only use your own brand or a brand that no vendor owns.';
  end if;
  return new;
end;
$$;

create trigger products_enforce_brand_usage
  before insert or update of brand_id, vendor_id on public.products
  for each row execute function public.enforce_product_brand_usage();

-- -----------------------------------------------------------------------------
-- Vendor approval also creates the vendor's own brand (admins can edit it).
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
  v_app        public.vendor_applications;
  v_vendor_id  uuid;
  v_brand_id   uuid;
  v_slug       public.slug_text;
  v_brand_slug text;
  v_actor      uuid := public.current_profile_id();
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

  -- The vendor's own brand. Brand slugs are a separate namespace; avoid taking an existing one.
  v_brand_slug := v_slug;
  if exists (select 1 from public.brands b where b.slug = v_brand_slug) then
    v_brand_slug := left(v_slug, 110) || '-' || substr(replace(v_vendor_id::text, '-', ''), 1, 6);
  end if;
  insert into public.brands (slug, name, owner_vendor_id)
  values (v_brand_slug, v_app.business_name, v_vendor_id)
  returning id into v_brand_id;

  -- Customers become vendors; administrators keep their role.
  update public.profiles set role = 'vendor' where id = v_app.profile_id and role = 'customer';

  update public.vendor_applications
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), vendor_id = v_vendor_id, rejection_reason = null
   where id = v_app.id;

  perform public.log_audit_event(
    'vendor.approved', 'vendor', v_vendor_id::text,
    jsonb_build_object('application_id', v_app.id, 'slug', v_slug, 'commission_rate_bps', p_commission_rate_bps,
                       'brand_id', v_brand_id)
  );
  return v_vendor_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.set_category_active(uuid, boolean) to authenticated, service_role;
