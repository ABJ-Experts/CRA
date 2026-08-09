# Infrastructure Atomic Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move multi-row security and lifecycle transitions into additive, tenant-safe PostgreSQL RPCs so concurrent requests cannot create half-completed invitation, verification, password-reset, or MFA-recovery states.

**Architecture:** PostgreSQL owns transactions for database-only state changes. Cross-system workflows use an explicit safe-ordering or persisted saga: credentials are never replayable, session revocation is conservative, and recoverable operations retain enough state to retry after a process/provider failure. API adapters call narrow RPCs and map explicit outcome values rather than parsing database error strings.

**Tech Stack:** Supabase CLI 2.111+, PostgreSQL, PL/pgSQL, psql integration tests, generated Supabase TypeScript types, NestJS adapters.

## Global Constraints

- Use Node 20+ and pnpm only.
- Create migrations with `pnpm --filter infrastructure run db:new <name>`; never edit a historical migration.
- Every function pins `search_path = public, pg_temp`, is owned by `postgres`, revokes `PUBLIC`, `anon`, and `authenticated`, and grants only the exact callable signature to `service_role`.
- Enable but never force RLS.
- Keep credential tables unreadable to non-superusers with RLS and no policies.
- All app foreign keys point to `public.users.id`, never `auth.users.id`.
- Never store raw invitation, email OTP, password-reset, or MFA recovery credentials.
- Do not widen the refresh-cookie path or change session-epoch skew.
- Migrations are additive and backward-compatible with the old API during rollout.
- Regenerate both database type copies through `db:types`; never hand-edit them.
- Run `db:reset`, `db:lint`, schema drift, live RLS tests, concurrency tests, and API E2E before acceptance.

---

### Task 1: Make Invitation Acceptance Atomic and Idempotent

**Files:**

- Create: `apps/infrastructure/supabase/migrations/20260809092000_accept_invitation_atomic.sql` through the CLI.
- Modify: `apps/infrastructure/tests/rls.test.sql:266-306`
- Create: `apps/infrastructure/tests/invitation-concurrency.e2e.sh`
- Modify: `apps/infrastructure/package.json:5-28`
- Regenerate: `apps/infrastructure/supabase/types/database.types.ts`
- Regenerate: `apps/api/src/supabase/database.types.ts`

**Interfaces:**

- Produces: `public.accept_invitation_atomic(p_token_hash text, p_user_id uuid, p_email text)`.
- Returns one row with `outcome`, `invitation_id`, `organization_id`, `organization_name`, and `organization_slug`.
- Outcomes: `accepted`, `already_accepted`, `not_found`, `not_pending`, `expired`, `email_mismatch`, `user_not_found`, `organization_not_found`.

- [ ] **Step 1: Add failing SQL assertions before the function exists**

In a rollback transaction, create an invitation and assert the function handles:

```sql
select pg_temp.check(
  'atomic invitation RPC exists',
  to_regprocedure('public.accept_invitation_atomic(text,uuid,text)') is not null
);
```

Add fixtures for the seeded member and a temporary non-member. Assert exact outcomes for wrong hash, wrong email, expired, revoked, first acceptance, second acceptance, and accepted-without-membership corruption. Assert that `accepted` produces exactly one membership, one accepted timestamp, and one `invitation.accepted` audit row.

- [ ] **Step 2: Run the live test to verify it fails**

Run: `pnpm --filter infrastructure run test`

Expected: FAIL because the RPC does not exist.

- [ ] **Step 3: Create the migration and implement the locked transition**

Run: `pnpm --filter infrastructure run db:new accept_invitation_atomic`

The generated migration must define:

```sql
create or replace function public.accept_invitation_atomic(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns table (
  outcome text,
  invitation_id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.invitations%rowtype;
  v_org public.organizations%rowtype;
  v_user public.users%rowtype;
  v_email text := lower(btrim(p_email));
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'not_found', null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_invitation
    from public.invitations
   where token_hash = p_token_hash
   for update;

  if not found then
    return query select 'not_found', null::uuid, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_org
    from public.organizations
   where id = v_invitation.organization_id;

  if not found then
    return query select 'organization_not_found', v_invitation.id,
      v_invitation.organization_id, null::text, null::text;
    return;
  end if;

  select * into v_user
    from public.users
   where id = p_user_id;

  if not found then
    return query select 'user_not_found', v_invitation.id, v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_email <> lower(v_user.email) or v_email <> v_invitation.email then
    return query select 'email_mismatch', v_invitation.id,
      v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_invitation.status = 'accepted' then
    if exists (
      select 1 from public.organization_members
       where organization_id = v_invitation.organization_id
         and user_id = p_user_id
    ) then
      return query select 'already_accepted', v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    else
      return query select 'not_pending', v_invitation.id,
        v_org.id, v_org.name, v_org.slug;
    end if;
    return;
  end if;

  if v_invitation.status <> 'pending' then
    return query select 'not_pending', v_invitation.id,
      v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  if v_invitation.expires_at < now() then
    update public.invitations
       set status = 'expired'
     where id = v_invitation.id;
    return query select 'expired', v_invitation.id,
      v_org.id, v_org.name, v_org.slug;
    return;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invitation.organization_id, p_user_id, v_invitation.role)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations
     set status = 'accepted', accepted_at = now()
   where id = v_invitation.id;

  insert into public.audit_logs (
    organization_id, user_id, actor_email, action, entity_type, entity_id
  ) values (
    v_invitation.organization_id, p_user_id, v_email,
    'invitation.accepted', 'invitation', v_invitation.id::text
  );

  return query select 'accepted', v_invitation.id,
    v_org.id, v_org.name, v_org.slug;
end;
$$;

alter function public.accept_invitation_atomic(text, uuid, text) owner to postgres;
revoke all on function public.accept_invitation_atomic(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_invitation_atomic(text, uuid, text)
  to service_role;
```

Confirm that `organization_members` has a unique `(organization_id, user_id)` constraint before relying on `ON CONFLICT`; if its constraint name/shape differs, use the actual committed constraint rather than a guessed conflict target.

- [ ] **Step 4: Test true concurrent double acceptance**

`invitation-concurrency.e2e.sh` must:

1. read the local database connection from `supabase status -o env` or the known local test port;
2. insert one temporary user and invitation in a transaction-safe fixture setup;
3. launch two `psql` calls in the background with the same token/user;
4. wait for both;
5. assert outcomes are one `accepted` and one `already_accepted`;
6. assert one membership and one audit row;
7. delete only the explicit fixture IDs in a cleanup trap.

The core concurrent calls are:

```sh
accept_once() {
  psql "$database_url" -X -At -v ON_ERROR_STOP=1 \
    -v token_hash="$token_hash" -v user_id="$user_id" -v email="$email" <<'SQL'
select outcome
from public.accept_invitation_atomic(
  :'token_hash', :'user_id'::uuid, :'email'
);
SQL
}

accept_once >"$result_one" &
pid_one=$!
accept_once >"$result_two" &
pid_two=$!
wait "$pid_one" "$pid_two"
```

Use `mktemp -d`, quote every value, validate IDs as UUIDs and the token as 64 lowercase hex characters, pass values through psql variables, and clean up explicit rows rather than a broad pattern.

- [ ] **Step 5: Wire scripts and regenerate types**

Add:

```json
"test:concurrency": "pnpm run preflight && bash tests/invitation-concurrency.e2e.sh"
```

Run:

```sh
pnpm --filter infrastructure run db:reset
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
pnpm --filter infrastructure run test:concurrency
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure exec supabase db diff
```

Expected: all tests PASS and `db diff` reports no unexpected drift after the migration/type generation workflow.

- [ ] **Step 6: Commit**

```bash
git add apps/infrastructure/supabase/migrations apps/infrastructure/tests apps/infrastructure/package.json apps/infrastructure/supabase/types/database.types.ts apps/api/src/supabase/database.types.ts
git commit -m "feat: make invitation acceptance atomic"
```

### Task 2: Verify Email Codes in One Transaction

**Files:**

- Create: `apps/infrastructure/supabase/migrations/20260809092100_verify_email_code_atomic.sql` through the CLI.
- Modify: `apps/infrastructure/tests/rls.test.sql`
- Regenerate: both database type files.

**Interfaces:**

- Produces: `public.verify_email_code_atomic(p_user_id uuid, p_code_hash text, p_max_attempts integer)` returning one outcome.
- Outcomes: `verified`, `missing`, `expired`, `attempts_exhausted`, `invalid`.

- [ ] **Step 1: Add failing SQL behavior tests**

Within rollback transactions, insert a fresh verification row and assert:

- wrong code increments attempts exactly once under two sequential calls;
- the fifth wrong attempt returns `invalid` and persists attempt 5;
- the sixth returns `attempts_exhausted` without incrementing;
- expired returns `expired` without verifying the user;
- correct code sets `users.email_verified_at` and `consumed_at` together;
- a second correct request returns `missing` and cannot update another user;
- concurrent correct/wrong calls serialize on the row.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter infrastructure run test`

Expected: FAIL because the RPC does not exist.

- [ ] **Step 3: Implement the function**

```sql
create or replace function public.verify_email_code_atomic(
  p_user_id uuid,
  p_code_hash text,
  p_max_attempts integer default 5
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.auth_email_verifications%rowtype;
begin
  if p_max_attempts < 1 or p_code_hash !~ '^[0-9a-f]{64}$' then
    return 'missing';
  end if;

  select * into v_code
    from public.auth_email_verifications
   where user_id = p_user_id
     and purpose = 'signup'
     and consumed_at is null
   for update;

  if not found then return 'missing'; end if;
  if v_code.expires_at < now() then return 'expired'; end if;
  if v_code.attempts >= p_max_attempts then return 'attempts_exhausted'; end if;

  if v_code.code_hash <> p_code_hash then
    update public.auth_email_verifications
       set attempts = attempts + 1
     where id = v_code.id;
    return 'invalid';
  end if;

  update public.users
     set email_verified_at = now(), updated_at = now()
   where id = p_user_id;
  if not found then return 'missing'; end if;

  update public.auth_email_verifications
     set consumed_at = now()
   where id = v_code.id;

  return 'verified';
end;
$$;
```

Add the standard owner/revoke/grant statements for the exact signature.

- [ ] **Step 4: Freeze the API consumption contract for the auth slice**

API plan Task 5 consumes this additive RPC. `SupabaseAuthProfileRepository` hashes the submitted code in Node and calls the RPC. The application use case maps outcomes to the existing `otp_missing`, `otp_expired`, `otp_attempts_exhausted`, and `otp_invalid` bodies. RPC/network error maps to `email_verification_failed` 503. The old separate profile and consume updates are removed only in that API task after adapter integration tests are green.

- [ ] **Step 5: Verify and commit**

Run:

```sh
pnpm --filter infrastructure run db:reset
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure exec supabase db diff
```

Expected: PASS.

```bash
git add apps/infrastructure/supabase/migrations apps/infrastructure/tests apps/infrastructure/supabase/types/database.types.ts apps/api/src/supabase/database.types.ts
git commit -m "feat: make email verification atomic"
```

### Task 3: Consume Password-Reset Tokens Before External Mutation

**Files:**

- Create: `apps/infrastructure/supabase/migrations/20260809092200_consume_password_reset.sql` through the CLI.
- Modify: `apps/infrastructure/tests/rls.test.sql`
- Regenerate: both database type files.

**Interfaces:**

- Produces: `public.consume_password_reset(p_token_hash text)` returning `outcome`, `user_id`, and `auth_user_id`.
- Outcomes: `consumed`, `invalid`, `expired`, `profile_missing`.

- [ ] **Step 1: Add failing SQL tests for replay and revocation ordering**

Assert that the RPC:

- locks by token hash;
- changes `consumed_at` and `session_epoch_at` in the same transaction;
- returns the corresponding non-null `auth_user_id` only on `consumed`;
- returns `invalid` for already consumed/malformed/unknown tokens;
- returns `expired` for expired tokens;
- lets only one of two concurrent calls receive `consumed`.

- [ ] **Step 2: Implement the safe-ordering function**

```sql
create or replace function public.consume_password_reset(p_token_hash text)
returns table (outcome text, user_id uuid, auth_user_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.auth_recovery_tokens%rowtype;
  v_user public.users%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid', null::uuid, null::uuid;
    return;
  end if;

  select * into v_token
    from public.auth_recovery_tokens
   where token_hash = p_token_hash
   for update;

  if not found or v_token.consumed_at is not null then
    return query select 'invalid', null::uuid, null::uuid;
    return;
  end if;
  if v_token.expires_at < now() then
    return query select 'expired', null::uuid, null::uuid;
    return;
  end if;

  select * into v_user from public.users where id = v_token.user_id for update;
  if not found or v_user.auth_user_id is null then
    return query select 'profile_missing', null::uuid, null::uuid;
    return;
  end if;

  update public.auth_recovery_tokens
     set consumed_at = now()
   where id = v_token.id;
  update public.users
     set session_epoch_at = now(), updated_at = now()
   where id = v_user.id;

  return query select 'consumed', v_user.id, v_user.auth_user_id;
end;
$$;
```

Add standard owner/revoke/grant statements.

- [ ] **Step 3: Freeze the API consumption contract with explicit failure posture**

API plan Task 5 implements this exact order:

1. hash the raw reset token;
2. call `consume_password_reset`;
3. on `consumed`, call GoTrue `updateUserById(authUserId, { password })`;
4. call global sign-out/revoke refresh tokens;
5. return success and clear browser cookies.

If step 3 or 4 fails, return the existing `password_update_failed` response, keep the reset token consumed, and require a new reset request. This can inconvenience one failed provider call but prevents replay and invalidates access sessions before any password change. Log the user ID and provider error without logging the raw token, token hash, password, JWT, or refresh token.

- [ ] **Step 4: Add the provider/database cases to the API Task 5 acceptance matrix**

Cover:

- database failure before consume: token remains usable and API returns 503;
- GoTrue failure after consume: token remains dead, epoch advanced, no success response;
- global sign-out failure after password update: access tokens are already epoch-revoked; return 503 and alert operations;
- concurrent requests: at most one calls `updateUserById`;
- replay after success: existing expired/invalid UI routing remains.

- [ ] **Step 5: Verify and commit**

Run the full database and live auth gates, regenerate types, and confirm schema drift is clean.

```bash
git add apps/infrastructure/supabase/migrations apps/infrastructure/tests apps/infrastructure/supabase/types/database.types.ts apps/api/src/supabase/database.types.ts
git commit -m "feat: make password reset single use"
```

### Task 4: Persist MFA Recovery as a Retryable Saga

**Files:**

- Create: `apps/infrastructure/supabase/migrations/20260809092300_mfa_recovery_operations.sql` through the CLI.
- Modify: `apps/infrastructure/tests/rls.test.sql`
- Regenerate: both database type files.

**Interfaces:**

- Produces: `mfa_recovery_operations` with states `claimed`, `factors_removed`, `completed`, `failed`.
- Produces: `claim_mfa_recovery`, `mark_mfa_factors_removed`, `complete_mfa_recovery`, and `fail_mfa_recovery` RPCs.

- [ ] **Step 1: Write failing state and access tests**

Assert:

- raw codes are never stored;
- only a matching unused code can create an operation;
- concurrent claims for one code return the same operation ID and consume once;
- a retry with the same user/code resumes `claimed` or `failed` rather than rejecting as invalid;
- another user cannot resume an operation;
- completion deletes remaining recovery codes only after factor removal is recorded;
- all tables have RLS, no public policies, and explicit service-role grants;
- every transition rejects an unexpected prior state.

- [ ] **Step 2: Create the schema with explicit state constraints**

```sql
create table public.mfa_recovery_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  recovery_code_id uuid not null,
  auth_user_id uuid not null,
  status text not null default 'claimed',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint mfa_recovery_operation_status_check
    check (status in ('claimed', 'factors_removed', 'completed', 'failed')),
  constraint mfa_recovery_operation_code_key unique (recovery_code_id)
);

alter table public.mfa_recovery_operations enable row level security;
grant all on table public.mfa_recovery_operations to service_role;
revoke all on table public.mfa_recovery_operations from public, anon, authenticated;
```

Add the existing `set_updated_at` trigger. `auth_user_id` is intentionally not a foreign key to `auth.users`; it is an external-provider identifier captured from `public.users.auth_user_id` while the user row is locked. `recovery_code_id` is also intentionally a unique historical identifier without a foreign key: completion deletes all recovery-code rows, but the persisted operation must survive for idempotent replay and incident diagnosis.

- [ ] **Step 3: Implement claim and transition RPCs**

`claim_mfa_recovery(p_user_id uuid, p_code_hash text)` locks the code row, returns an existing operation for the same code/user, or consumes the code and creates one operation. It returns only `outcome`, `operation_id`, `auth_user_id`, and `status`.

`mark_mfa_factors_removed(p_operation_id uuid, p_user_id uuid)` permits `claimed|failed -> factors_removed` and clears `last_error`.

`complete_mfa_recovery(p_operation_id uuid, p_user_id uuid)` requires `factors_removed`, deletes all remaining recovery codes for that user, inserts the audit row, and marks `completed` in one transaction.

`fail_mfa_recovery(p_operation_id uuid, p_user_id uuid, p_error_code text)` increments attempts, stores a sanitized bounded error code of at most 100 characters, and marks `failed`; it must never store provider error bodies or secrets.

Every function uses the standard pinned path and restricted grants.

- [ ] **Step 4: Freeze the API workflow consumed by Task 5 of the API plan**

The application flow becomes:

1. normalize/hash code;
2. claim or resume operation;
3. list/delete factors through GoTrue with `authUserId`;
4. if any provider call fails, persist `failed` and return `auth_unavailable` 503 without clearing session/MFA routing state;
5. mark factors removed;
6. complete the operation and delete remaining recovery codes;
7. return success.

Do not preserve the current best-effort factor deletion that reports success after cleanup fails; it can leave the user prompted for a factor they cannot access after spending a recovery code.

- [ ] **Step 5: Verify retry and crash recovery**

Inject failures before claim, after claim, after one factor deletion, after all deletions, and before completion. Retrying the same code must resume safely and never create a second operation. Add an operational query for non-completed operations older than five minutes, but do not add a background worker until ownership, retry limits, and alerting are defined.

- [ ] **Step 6: Verify and commit**

Run database reset/lint/types/drift/RLS plus MFA unit and live auth tests.

```bash
git add apps/infrastructure/supabase/migrations apps/infrastructure/tests apps/infrastructure/supabase/types/database.types.ts apps/api/src/supabase/database.types.ts
git commit -m "feat: make MFA recovery retryable"
```

### Task 5: Final Migration and Rollback Gate

**Files:**

- Modify: `apps/infrastructure/README.md:14-67`
- Modify: `docs/architecture/README.md`

**Interfaces:**

- Produces: documented expand/deploy/contract order and exact rollback limits.

- [ ] **Step 1: Validate from a clean local database**

Run:

```sh
pnpm --filter infrastructure run db:reset
pnpm --filter infrastructure run db:lint
pnpm --filter infrastructure run test
pnpm --filter infrastructure run test:concurrency
pnpm --filter infrastructure run db:types
pnpm --filter infrastructure exec supabase db diff
pnpm --filter api run check-types
pnpm --filter api run test
pnpm --filter api run build
pnpm --filter api run test:e2e
```

Expected: PASS and no drift beyond generated artifacts already staged.

- [ ] **Step 2: Document rollout order**

```markdown
1. Apply additive RPC/table migration.
2. Run schema, RLS, concurrency, and grant tests.
3. Deploy the old API against the expanded schema and verify it remains healthy.
4. Deploy the adapter/use-case version that calls the RPC.
5. Observe outcome counts and error rates.
6. Remove old multi-call code only after one stable release.
```

Rollback rules:

- API rollback is safe because migrations are additive.
- Do not drop RPCs/tables while either old or new application versions may run.
- Never unconsume a credential as rollback.
- Never move `session_epoch_at` backward.
- Failed saga rows are operational records and remain retryable; do not delete them to make metrics green.

- [ ] **Step 3: Commit documentation**

```bash
git add apps/infrastructure/README.md docs/architecture/README.md
git commit -m "docs: record atomic workflow rollout"
```
