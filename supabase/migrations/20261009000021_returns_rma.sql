-- =============================================================================
-- Migration 0021 (Phase 5): customer returns (RMA) workflow.
-- -----------------------------------------------------------------------------
-- A return request covers items of ONE vendor order (one parcel back to one
-- vendor). Lifecycle (reuses the Phase 1 return_status enum):
--
--   requested ──approve──► approved ──customer ships──► in_transit ──┐
--       │  └──reject──► rejected      │                              ▼
--       └──cancel (customer)──► cancelled ◄──┘        received ──refund──► completed
--                                                         └──reject (admin, no refund)──► rejected
--
-- Rules enforced here, not in the UI:
--   * only the order's customer can request, within `returns.window_days`
--     (14) of the vendor order's delivery, for paid orders;
--   * quantities never exceed what is still returnable (bought − in other
--     active returns − refunded outside returns);
--   * vendor owners/managers (or admins) approve, reject and receive; only
--     admins refund — through request_refund(), so the Phase 4b shipping and
--     liability policies, ledgers and Stripe idempotency all apply;
--   * receiving can restock through adjust_inventory() ('return' movement).
-- The Phase 1 `returns` table (one row per item, direct customer inserts)
-- is superseded and made read-only.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('returns.window_days', '14', 'Days after delivery during which a customer can request a return.', true)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.return_requests (
  id                   uuid primary key default gen_random_uuid(),
  rma_number           text not null unique,
  order_id             uuid not null references public.orders (id) on delete restrict,
  vendor_order_id      uuid not null references public.vendor_orders (id) on delete restrict,
  customer_id          uuid not null references public.profiles (id) on delete restrict,
  vendor_id            uuid not null references public.vendors (id) on delete restrict,
  status               public.return_status not null default 'requested',
  customer_note        text check (customer_note is null or char_length(customer_note) <= 1000),
  return_instructions  text check (return_instructions is null or char_length(return_instructions) between 10 and 2000),
  rejection_reason     text check (rejection_reason is null or char_length(rejection_reason) between 3 and 1000),
  carrier              text check (carrier is null or char_length(carrier) between 2 and 60),
  tracking_number      text check (tracking_number is null or char_length(tracking_number) between 3 and 80),
  tracking_url         text check (tracking_url is null or tracking_url ~* '^https?://'),
  inspection_notes     text check (inspection_notes is null or char_length(inspection_notes) <= 2000),
  restocked            boolean not null default false,
  refund_id            uuid references public.refunds (id) on delete restrict,
  decided_by           uuid references public.profiles (id) on delete set null,
  received_by          uuid references public.profiles (id) on delete set null,
  requested_at         timestamptz not null default now(),
  approved_at          timestamptz,
  rejected_at          timestamptz,
  shipped_at           timestamptz,
  received_at          timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  updated_at           timestamptz not null default now(),
  constraint return_requests_status_known check (status <> 'inspected')
);

create index return_requests_customer_idx on public.return_requests (customer_id, requested_at desc);
create index return_requests_vendor_idx on public.return_requests (vendor_id, status, requested_at desc);
create index return_requests_vendor_order_idx on public.return_requests (vendor_order_id);

create trigger return_requests_set_updated_at
  before update on public.return_requests
  for each row execute function public.set_updated_at();

create table public.return_request_items (
  id                 uuid primary key default gen_random_uuid(),
  return_request_id  uuid not null references public.return_requests (id) on delete cascade,
  order_item_id      uuid not null references public.order_items (id) on delete restrict,
  quantity           integer not null check (quantity > 0),
  reason             text not null check (char_length(reason) between 3 and 500),
  created_at         timestamptz not null default now(),
  unique (return_request_id, order_item_id)
);

create index return_request_items_order_item_idx on public.return_request_items (order_item_id);

-- Refunds issued for a return point back to it.
alter table public.refunds add column return_request_id uuid references public.return_requests (id) on delete restrict;
create unique index refunds_return_request_idx on public.refunds (return_request_id) where return_request_id is not null;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.return_window_days()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_setting_int('returns.window_days', 14);
$$;

-- Units of an order item that can still be returned.
create or replace function public.returnable_quantity_internal(p_order_item_id uuid, p_exclude_request uuid default null)
returns integer
language sql
stable
set search_path = public
as $$
  select greatest(
    oi.quantity
    - coalesce((
        select sum(ri.quantity) from public.return_request_items ri
          join public.return_requests rr on rr.id = ri.return_request_id
         where ri.order_item_id = oi.id
           and rr.status not in ('rejected', 'cancelled')
           and rr.id is distinct from p_exclude_request), 0)
    - coalesce((
        select sum(fi.quantity) from public.refund_items fi
          join public.refunds f on f.id = fi.refund_id
         where fi.order_item_id = oi.id
           and f.return_request_id is null
           and f.status not in ('failed', 'rejected')), 0),
    0)::integer
  from public.order_items oi
  where oi.id = p_order_item_id;
$$;

-- Vendor owner/manager of the request's vendor, or an admin.
create or replace function public.can_manage_return(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.has_vendor_role(p_vendor_id, array['owner', 'manager']::public.vendor_member_role[]);
$$;

-- What the signed-in customer can still return on an order, per item.
create or replace function public.return_eligibility(p_order_id uuid)
returns table (
  vendor_order_id     uuid,
  order_item_id       uuid,
  returnable_quantity integer,
  window_ends_at      timestamptz,
  eligible            boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select vo.id, oi.id, public.returnable_quantity_internal(oi.id),
         vo.delivered_at + make_interval(days => public.return_window_days()),
         o.payment_status in ('paid', 'partially_refunded')
           and vo.delivered_at is not null
           and now() <= vo.delivered_at + make_interval(days => public.return_window_days())
           and public.returnable_quantity_internal(oi.id) > 0
    from public.orders o
    join public.vendor_orders vo on vo.order_id = o.id
    join public.order_items oi on oi.vendor_order_id = vo.id
   where o.id = p_order_id
     and o.customer_id = public.current_profile_id()
   order by vo.vendor_order_number, oi.created_at, oi.id;
$$;

-- -----------------------------------------------------------------------------
-- Customer actions
-- -----------------------------------------------------------------------------
create or replace function public.create_return_request(
  p_vendor_order_id uuid,
  p_items           jsonb,           -- [{"order_item_id": uuid, "quantity": int, "reason": text}, …]
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile  uuid := public.require_active_customer();
  v_vo       public.vendor_orders;
  v_order    public.orders;
  v_req      record;
  v_item     public.order_items;
  v_id       uuid;
  v_count    integer;
  v_lines    integer := 0;
begin
  select * into v_vo from public.vendor_orders where id = p_vendor_order_id for update;
  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  select * into v_order from public.orders where id = v_vo.order_id;
  if v_order.customer_id <> v_profile then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.payment_status not in ('paid', 'partially_refunded') then
    raise exception 'Only paid orders can be returned.';
  end if;
  if v_vo.delivered_at is null then
    raise exception 'You can request a return once this shipment has been delivered.';
  end if;
  if now() > v_vo.delivered_at + make_interval(days => public.return_window_days()) then
    raise exception 'The % day return window for this shipment has closed.', public.return_window_days();
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Keep the note under 1000 characters.';
  end if;

  select count(*) into v_count from public.return_requests where vendor_order_id = v_vo.id;
  insert into public.return_requests (rma_number, order_id, vendor_order_id, customer_id, vendor_id, customer_note)
  values (v_vo.vendor_order_number || '-R' || (v_count + 1), v_order.id, v_vo.id, v_profile, v_vo.vendor_id,
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;

  for v_req in
    select (e ->> 'order_item_id')::uuid as order_item_id,
           (e ->> 'quantity')::integer as quantity,
           trim(coalesce(e ->> 'reason', '')) as reason
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
  loop
    if v_req.quantity is null or v_req.quantity < 1 then
      continue;
    end if;
    select * into v_item from public.order_items where id = v_req.order_item_id and vendor_order_id = v_vo.id for update;
    if not found then
      raise exception 'An item does not belong to this shipment.';
    end if;
    if char_length(v_req.reason) < 3 then
      raise exception 'Tell us why you are returning "%" (at least 3 characters).', v_item.product_name;
    end if;
    if v_req.quantity > public.returnable_quantity_internal(v_item.id, v_id) then
      raise exception 'Only % of "%" can be returned.', public.returnable_quantity_internal(v_item.id, v_id), v_item.product_name;
    end if;
    insert into public.return_request_items (return_request_id, order_item_id, quantity, reason)
    values (v_id, v_item.id, v_req.quantity, left(v_req.reason, 500));
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then
    raise exception 'Choose at least one item to return.';
  end if;

  perform public.log_audit_event('return.requested', 'return_request', v_id::text,
    jsonb_build_object('order_id', v_order.id, 'vendor_order_id', v_vo.id, 'lines', v_lines));
  return v_id;
end;
$$;

create or replace function public.cancel_return_request(p_return_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret public.return_requests;
begin
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found or v_ret.customer_id is distinct from public.current_profile_id() then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if v_ret.status not in ('requested', 'approved') then
    raise exception 'This return can no longer be cancelled.';
  end if;
  update public.return_requests set status = 'cancelled', cancelled_at = now() where id = v_ret.id;
  perform public.log_audit_event('return.cancelled', 'return_request', v_ret.id::text, jsonb_build_object('rma', v_ret.rma_number));
end;
$$;

create or replace function public.mark_return_shipped(
  p_return_id       uuid,
  p_carrier         text,
  p_tracking_number text,
  p_tracking_url    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret public.return_requests;
begin
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found or v_ret.customer_id is distinct from public.current_profile_id() then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if v_ret.status not in ('approved', 'in_transit') then
    raise exception 'Add tracking once your return has been approved.';
  end if;
  update public.return_requests
     set status = 'in_transit', carrier = trim(p_carrier), tracking_number = trim(p_tracking_number),
         tracking_url = nullif(trim(coalesce(p_tracking_url, '')), ''), shipped_at = coalesce(shipped_at, now())
   where id = v_ret.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vendor (owner/manager) or admin actions
-- -----------------------------------------------------------------------------
create or replace function public.approve_return_request(p_return_id uuid, p_instructions text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret public.return_requests;
begin
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found or not public.can_manage_return(v_ret.vendor_id) then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if v_ret.status <> 'requested' then
    raise exception 'Only new return requests can be approved.';
  end if;
  if p_instructions is null or char_length(trim(p_instructions)) < 10 then
    raise exception 'Give the customer the return address and instructions (at least 10 characters).';
  end if;
  update public.return_requests
     set status = 'approved', return_instructions = left(trim(p_instructions), 2000), approved_at = now(),
         decided_by = public.current_profile_id()
   where id = v_ret.id;
  perform public.log_audit_event('return.approved', 'return_request', v_ret.id::text, jsonb_build_object('rma', v_ret.rma_number));
end;
$$;

-- Vendors reject new requests; after the parcel arrived only an admin can
-- close a return without refund (e.g. the inspection failed).
create or replace function public.reject_return_request(p_return_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret public.return_requests;
begin
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found or not public.can_manage_return(v_ret.vendor_id) then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Give the customer a reason (at least 3 characters).';
  end if;
  if not (v_ret.status = 'requested' or (v_ret.status = 'received' and public.is_admin())) then
    raise exception 'This return can no longer be rejected.';
  end if;
  update public.return_requests
     set status = 'rejected', rejection_reason = left(trim(p_reason), 1000), rejected_at = now(),
         decided_by = public.current_profile_id()
   where id = v_ret.id;
  perform public.log_audit_event('return.rejected', 'return_request', v_ret.id::text,
    jsonb_build_object('rma', v_ret.rma_number, 'after_receipt', v_ret.status = 'received'));
end;
$$;

create or replace function public.mark_return_received(p_return_id uuid, p_restock boolean, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ret  public.return_requests;
  v_line record;
begin
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found or not public.can_manage_return(v_ret.vendor_id) then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if v_ret.status not in ('approved', 'in_transit') then
    raise exception 'Only approved returns can be marked as received.';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Keep the inspection notes under 2000 characters.';
  end if;

  if coalesce(p_restock, false) then
    for v_line in
      select oi.variant_id, ri.quantity
        from public.return_request_items ri
        join public.order_items oi on oi.id = ri.order_item_id
       where ri.return_request_id = v_ret.id and oi.variant_id is not null
         and exists (select 1 from public.inventory i where i.variant_id = oi.variant_id)
       order by oi.variant_id
    loop
      perform public.adjust_inventory(v_line.variant_id, v_line.quantity, 'return', 'return_request', v_ret.id, v_ret.rma_number);
    end loop;
  end if;

  update public.return_requests
     set status = 'received', received_at = now(), received_by = public.current_profile_id(),
         restocked = coalesce(p_restock, false), inspection_notes = nullif(trim(coalesce(p_notes, '')), '')
   where id = v_ret.id;
  perform public.log_audit_event('return.received', 'return_request', v_ret.id::text,
    jsonb_build_object('rma', v_ret.rma_number, 'restocked', coalesce(p_restock, false)));
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin: refund a received return (through the Phase 4b refund machinery)
-- -----------------------------------------------------------------------------
create or replace function public.request_return_refund(p_return_id uuid, p_include_shipping boolean default null)
returns table (refund_id uuid, amount_minor bigint, currency text, provider_payment_id text, order_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ret    public.return_requests;
  v_items  jsonb;
  v_refund record;
begin
  if not public.is_admin() then
    raise exception 'only administrators can refund returns' using errcode = 'insufficient_privilege';
  end if;
  select * into v_ret from public.return_requests where id = p_return_id for update;
  if not found then
    raise exception 'Return not found.' using errcode = 'no_data_found';
  end if;
  if v_ret.status <> 'received' then
    raise exception 'Refund a return once the items have been received.';
  end if;

  select jsonb_agg(jsonb_build_object('order_item_id', ri.order_item_id, 'quantity', ri.quantity))
    into v_items
    from public.return_request_items ri where ri.return_request_id = v_ret.id;

  select * into v_refund
    from public.request_refund(v_ret.vendor_order_id, v_items, 'return', 'Return ' || v_ret.rma_number, p_include_shipping);

  update public.refunds set return_request_id = v_ret.id where id = v_refund.refund_id;
  update public.return_requests
     set status = 'completed', completed_at = now(), refund_id = v_refund.refund_id
   where id = v_ret.id;
  perform public.log_audit_event('return.refund_requested', 'return_request', v_ret.id::text,
    jsonb_build_object('rma', v_ret.rma_number, 'refund_id', v_refund.refund_id, 'amount_minor', v_refund.amount_minor));

  return query select v_refund.refund_id, v_refund.amount_minor, v_refund.currency, v_refund.provider_payment_id, v_refund.order_id;
end;
$$;

-- If the provider refund for a return fails, the return goes back to
-- `received` so an admin can retry.
create or replace function public.reopen_return_after_failed_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed' and old.status <> 'failed' and new.return_request_id is not null then
    update public.return_requests
       set status = 'received', completed_at = null, refund_id = null
     where id = new.return_request_id and refund_id = new.id;
    update public.refunds set return_request_id = null where id = new.id;
  end if;
  return null;
end;
$$;

create trigger refunds_reopen_return_on_failure
  after update of status on public.refunds
  for each row execute function public.reopen_return_after_failed_refund();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.return_requests enable row level security;
alter table public.return_request_items enable row level security;

create policy return_requests_select_customer on public.return_requests
  for select to authenticated using (customer_id = (select public.current_profile_id()));
create policy return_requests_select_vendor on public.return_requests
  for select to authenticated using ((select public.is_vendor_member(vendor_id)));
create policy return_requests_select_admin on public.return_requests
  for select to authenticated using ((select public.is_admin()));

create or replace function public.return_request_visible(p_return_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.return_requests r
     where r.id = p_return_id
       and (r.customer_id = public.current_profile_id() or public.is_vendor_member(r.vendor_id) or public.is_admin())
  );
$$;

create policy return_request_items_select on public.return_request_items
  for select to authenticated using ((select public.return_request_visible(return_request_id)));

-- The Phase 1 per-item `returns` table is superseded: read-only from now on.
drop policy returns_insert_customer on public.returns;
drop policy returns_update_vendor on public.returns;
drop policy returns_admin_all on public.returns;
create policy returns_select_admin on public.returns
  for select to authenticated using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on public.return_requests, public.return_request_items from anon, authenticated;
grant select on public.return_requests, public.return_request_items to authenticated;
grant all on public.return_requests, public.return_request_items to service_role;
revoke insert, update, delete on public.returns from authenticated;

revoke all on function
  public.returnable_quantity_internal(uuid, uuid),
  public.reopen_return_after_failed_refund()
from public, anon, authenticated, service_role;

revoke all on function
  public.return_window_days(),
  public.can_manage_return(uuid),
  public.return_eligibility(uuid),
  public.return_request_visible(uuid),
  public.create_return_request(uuid, jsonb, text),
  public.cancel_return_request(uuid),
  public.mark_return_shipped(uuid, text, text, text),
  public.approve_return_request(uuid, text),
  public.reject_return_request(uuid, text),
  public.mark_return_received(uuid, boolean, text),
  public.request_return_refund(uuid, boolean)
from public, anon;

grant execute on function
  public.return_window_days(),
  public.can_manage_return(uuid),
  public.return_eligibility(uuid),
  public.return_request_visible(uuid),
  public.create_return_request(uuid, jsonb, text),
  public.cancel_return_request(uuid),
  public.mark_return_shipped(uuid, text, text, text),
  public.approve_return_request(uuid, text),
  public.reject_return_request(uuid, text),
  public.mark_return_received(uuid, boolean, text),
  public.request_return_refund(uuid, boolean)
to authenticated, service_role;
