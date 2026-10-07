-- =============================================================================
-- Migration 0020 (Phase 4b): Stripe Tax readiness — DISABLED.
-- -----------------------------------------------------------------------------
-- Tax stays at zero in Phase 4b ("Duties and taxes may apply on delivery").
-- This migration only prepares the data a later tax release needs:
--   * product / category tax codes (Stripe product tax codes, e.g. txcd_…)
--   * a per-line tax code snapshot on order items (filled automatically)
--   * a reference for a provider tax calculation on the order
-- Nothing reads these yet; confirm_order_payment still refuses any tax amount,
-- and checkout sessions are created with automatic tax disabled.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('tax.collection_enabled', 'false', 'Collect sales tax / VAT at checkout. Stays false until tax registrations are confirmed.', false)
on conflict (key) do nothing;

alter table public.products
  add column tax_code text check (tax_code is null or tax_code ~ '^txcd_[0-9]{8}$');
alter table public.categories
  add column tax_code text check (tax_code is null or tax_code ~ '^txcd_[0-9]{8}$');
alter table public.order_items
  add column tax_code text check (tax_code is null or tax_code ~ '^txcd_[0-9]{8}$');
alter table public.orders
  add column tax_calculation_ref text check (tax_calculation_ref is null or char_length(tax_calculation_ref) between 3 and 255);

-- Snapshot the applicable tax code (product, else nearest category up the tree)
-- when an order item is written, so later tax reporting uses purchase-time data.
create or replace function public.snapshot_order_item_tax_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code     text;
  v_category uuid;
  v_depth    integer := 0;
begin
  if new.tax_code is not null or new.product_id is null then
    return new;
  end if;
  select p.tax_code, p.category_id into v_code, v_category from public.products p where p.id = new.product_id;
  while v_code is null and v_category is not null and v_depth < 10 loop
    select c.tax_code, c.parent_id into v_code, v_category from public.categories c where c.id = v_category;
    v_depth := v_depth + 1;
  end loop;
  new.tax_code := v_code;
  return new;
end;
$$;

create trigger order_items_snapshot_tax_code
  before insert on public.order_items
  for each row execute function public.snapshot_order_item_tax_code();

revoke all on function public.snapshot_order_item_tax_code() from public, anon, authenticated, service_role;
