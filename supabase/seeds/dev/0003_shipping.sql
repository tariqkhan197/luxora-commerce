-- =============================================================================
-- DEVELOPMENT SEED — shipping (Supabase local stack / npm run db:seed:dev only)
-- NOT PRODUCTION DATA. Production starts with no shipping zones: admins create
-- zones and choose countries in Admin → Shipping. This seed only lets the local
-- demo store check out. Never run against a production database.
-- =============================================================================

do $$
declare
  v_zone   uuid;
  v_vendor uuid;
begin
  insert into public.shipping_zones (name, description, position)
  values ('Development zone', 'Local development only. Not a production shipping zone.', 0)
  on conflict ((lower(name))) do nothing
  returning id into v_zone;
  if v_zone is null then
    select id into v_zone from public.shipping_zones where lower(name) = 'development zone';
  end if;

  insert into public.shipping_zone_countries (country_code, zone_id)
  select c, v_zone from unnest(array['US', 'GB', 'DK', 'PK']) c
  on conflict (country_code) do nothing;

  -- The demo vendor (0002_test_accounts.sql) exists only on the Supabase local stack.
  select id into v_vendor from public.vendors where slug = 'atelier-demo';
  if v_vendor is null then
    return;
  end if;

  insert into public.vendor_shipping_rates
    (vendor_id, zone_id, first_item_minor, additional_item_minor, free_shipping_threshold_minor, min_delivery_days, max_delivery_days)
  values (v_vendor, v_zone, 1500, 500, 30000, 3, 7)
  on conflict (vendor_id, zone_id) do nothing;

  -- Vendors approved through the app get their own brand automatically; the demo
  -- vendor is inserted directly by the seed, so create it here.
  insert into public.brands (slug, name, owner_vendor_id)
  values ('atelier-demo', 'Atelier Demo', v_vendor)
  on conflict (slug) do nothing;
end;
$$;
