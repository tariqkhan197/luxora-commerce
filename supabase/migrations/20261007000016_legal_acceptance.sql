-- =============================================================================
-- Migration 0016 (Release 4a): record Vendor Terms acceptance.
-- -----------------------------------------------------------------------------
-- A vendor application must carry the version of the Vendor Terms the
-- applicant accepted. The acceptance time is always set by the database, so a
-- client cannot backdate it. Applications created before this migration keep
-- null values (both columns null together).
-- =============================================================================

alter table public.vendor_applications
  add column terms_version text check (terms_version is null or terms_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  add column terms_accepted_at timestamptz,
  add constraint vendor_applications_terms_pair check ((terms_version is null) = (terms_accepted_at is null));

create or replace function public.record_vendor_terms_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.is_privileged_session() or public.in_trusted_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.terms_version is null then
      raise exception 'You must accept the Vendor Terms to apply.';
    end if;
    new.terms_accepted_at := now();
    return new;
  end if;

  -- Applicants editing an open application cannot remove or backdate acceptance.
  if new.terms_version is null then
    raise exception 'You must accept the Vendor Terms to apply.';
  end if;
  if new.terms_version is distinct from old.terms_version then
    new.terms_accepted_at := now();
  else
    new.terms_accepted_at := old.terms_accepted_at;
  end if;
  return new;
end;
$$;

create trigger vendor_applications_record_terms
  before insert or update on public.vendor_applications
  for each row execute function public.record_vendor_terms_acceptance();
