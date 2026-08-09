-- =============================================================================
-- Server-side email-verification gate.
-- =============================================================================
-- `cra_pending` only controls browser routing. The API must retain an
-- authoritative verification state so deleting that cookie cannot grant an
-- unverified session access to protected routes.

alter table public.users
  add column if not exists email_verified_at timestamptz;

comment on column public.users.email_verified_at is
  'Set only after CRA validates the application email-verification code.';
