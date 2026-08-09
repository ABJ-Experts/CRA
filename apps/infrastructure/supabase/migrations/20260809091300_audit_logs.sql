-- =============================================================================
-- public.audit_logs — append-only record of security-relevant actions.
-- =============================================================================
-- THE FK ASYMMETRY IS DELIBERATE, and copied from the reference on purpose:
--
--   organization_id  ON DELETE CASCADE   — deleting an organization is a
--                                          tenant-offboarding action; its audit
--                                          trail goes with it.
--   user_id          ON DELETE SET NULL  — deleting a USER must never erase the
--                                          record of what they did. The row
--                                          survives with a null actor.
--
-- If both cascaded, "delete the user" would be an effective way to erase your
-- own trail, which is precisely what an audit log exists to prevent.
--
-- organization_id is nullable because some auditable events happen before any
-- organization exists (sign-up, failed sign-in, password reset).
-- =============================================================================

create table if not exists public.audit_logs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete cascade,
  user_id          uuid references public.users (id)         on delete set null,

  -- Denormalized so the trail still reads after the actor is gone.
  actor_email      text,

  action           text not null,
  entity_type      text,
  entity_id        text,
  changes          jsonb,

  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now(),

  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_logs_changes_is_object
    check (changes is null or jsonb_typeof(changes) = 'object')
);

create index if not exists idx_audit_org_created
  on public.audit_logs (organization_id, created_at desc);

create index if not exists idx_audit_user_created
  on public.audit_logs (user_id, created_at desc);

create index if not exists idx_audit_entity
  on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;
grant all on table public.audit_logs to service_role;
revoke all on table public.audit_logs from public, anon, authenticated;
