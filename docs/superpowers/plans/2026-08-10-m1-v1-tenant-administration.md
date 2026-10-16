# M1 V1 Tenant Administration and Data Lifecycle

## Global constraints

- Preserve all existing authentication actions, cookie names and paths, `/api/v1`, active-organization behaviour, membership and invitation routes, RBAC merge order, and onboarding contracts.
- Use `@repo/contracts` Zod schemas for every consumed request/path/query and successful response. Derive trusted types with `z.output`.
- Controllers/pages must not access Supabase. Service-role repository methods take `orgId` first and every tenant query explicitly filters it. Cross-tenant targets are generic 404s.
- Security-critical transitions and audits are atomic RPC facts; no credentials, tokens, OTPs, recovery codes, provider credentials, raw destructive confirmations, or unnecessary personal data enter logs/audits/jobs.
- Every new tenant table has RLS enabled (not forced), explicit grants, indexes, and tests. SQL functions pin `search_path`; migrations are additive and generated types are regenerated through the approved command.
- Product obligations, legal holds, evidence/artifacts, notification delivery, AI routing, and API keys are inward ports. Test adapters are deterministic; missing production integrations fail closed for cleanup/purge.
- Implement tests first and keep changed modules at or above 80% coverage.

## Task 1: Contracts, RBAC, and feature design

Create `docs/architecture/m1-tenant-administration.md` from the feature design template, documenting the persistent lifecycle State pattern and port boundaries. Extend `packages/contracts/src/organizations` with strict input/output schemas, subpath barrels, `z.output` types, and Vitest coverage for:

- Versioned settings and server catalog: IANA timezone, unique non-empty working days, unique local-date holidays, supported notification channel ids, staged MFA enforcement date, bounded maximum session age, AI provider id, and data residency id. Settings begin explicitly unconfigured; do not derive any value from browser locale, user profile, IP, or deployment region.
- Retention policy updates, versioned policy output, effective floor and all controlling reason records (product, evidence class, obligation, or legal hold).
- Export request idempotency, status/progress/errors, manifest verification, and short-lived attachment download response.
- Lifecycle states `active`, `deactivated`, `purge_scheduled`, `purge_blocked`, `purging`, `purged`; destructive reauth and confirmation inputs; generic safe errors.

Add `can_export_organization` and `can_delete_organization` to the organization permission matrix. Owners receive both by default; admin/member/viewer do not. Existing `can_edit_organization` semantics and permission merge order remain unchanged. Update permission and menu parity tests only for a new Organization administration menu entry requiring `can_view_organization`.

## Task 2: Supabase durable foundation

Create additive migrations and live SQL tests for versioned organization settings, retention policy sets/floor snapshots/evidence watermarks/cleanup runs, export jobs/idempotencies/snapshots/parts/hashes, lifecycle state, tenant session revocations, destructive reauth grants, purge jobs/work items, and non-tenant deletion proof records. Backfill current organizations as active without changing their legal profiles or onboarding data.

Implement service-role-only, pinned-search-path RPCs for atomic settings and retention writes, retention reconciliation/cleanup claim-complete-fail, export request and claim-checkpoint-complete-fail, deactivation, destructive reauth grant consumption, purge scheduling/recovery/claim-complete-fail, and durable audits. Ensure legal-hold/floor checks occur immediately before cleanup/purge and no state can regress.

Keep legacy `organizations.is_active` synchronized with lifecycle status. Deactivation atomically marks the tenant unavailable, pauses active export work, records session revocations for current memberships, and writes audit. Purge deletes tenant records only after an atomic eligibility check, persists artifact work before database deletion, and retains only a minimal platform deletion proof until artifact deletion completes. Add a private `tenant-exports` storage bucket/policies with no browser write access.

Test grants, RLS, search paths, rollback, idempotency, concurrency, tenant isolation, active holds, retention monotonicity, deletion proof survival, session revocation records, export/purge resume, and storage/hash failure outcomes.

## Task 3: API, auth enforcement, and worker

Create a focused API tenant-administration feature with controller → facade/use cases → inward ports → Supabase adapters. Add protected `/api/v1/organizations/current/...` endpoints for settings/catalog, retention, exports request/latest/status/download, lifecycle status/deactivation, destructive reauth, delete scheduling, and grace-period recovery. Write controller/use-case/adapter tests before code; parse all boundaries and map validation, conflict, forbidden, generic not-found, unavailable-provider, and malformed-provider errors safely.

Use `can_view_organization` for reads, `can_edit_organization` for settings/retention writes, and both owner role plus the new export/delete permission for export and destructive transitions. The sole inactive recovery exemption derives the signed active selection and re-verifies ownership in the repository; ordinary tenant requests cannot use an inactive selection.

Extend auth scope resolution so only active organizations are normal scopes and lifecycle status is enforced before tenant work. Use the verified Supabase JWT `session_id` with tenant session revocations and maximum-age metadata to invalidate tenant access without invalidating another organization. Preserve existing access/refresh cookies and frozen auth action signatures. Fresh destructive reauth invokes the existing password lockout flow and a fresh MFA challenge when a verified factor exists; the durable one-use grant is bound to org, user, session and expiry and stores no secret material.

Add lifecycle checks to organization switching/current/onboarding, invitation acceptance, membership/RBAC mutations, and all new tenant mutations. Convert permission-changing role/member/override writes to durable before/after audit facts while preserving last-owner and permission-resolution invariants.

Add a separately runnable `pnpm --filter api run worker:tenant-lifecycle` composition root. It claims database jobs under leases, creates deterministic allowlisted NDJSON/artifact snapshots, builds and verifies versioned ZIP manifests with SHA-256, mints authorized short-lived attachment links, retries sanitized failures, and handles dead-letter/resume. It coordinates deactivation by pausing exports and rejects work after lifecycle state changes.

## Task 4: Web experience and browser coverage

Add the contract-backed Organization administration dashboard entry and functional pages for Settings, Retention, Export, and Deletion. Implement focused API gateway classes and React Query hooks, with output/input schemas at each boundary and correct session/organization invalidation.

Use existing shared Form, progress/status, and Alert dialog components. Provide accessible field errors, value retention, loading/retry/forbidden/blocked/completed states, time display in the saved organization timezone, owner-only destructive controls, exact typed confirmations, and reauth/MFA flow. Read-only roles may inspect allowed data but cannot mutate it. Browser state must never select policy/provider/residency or supply tenant scope.

Add component and Playwright coverage for owner/admin/viewer access, invalid settings retention, export lifecycle/download authorization, MFA scheduling/enforcement, deactivation/recovery, blocked purge, reauth and confirmation, and persisted progress. Use semantic selectors and isolated fixtures; no arbitrary sleeps.

## Task 5: Integration and release verification

Regenerate database types via the approved infrastructure command, run migration lint/live SQL tests/concurrency tests, focused coverage, API and web tests, browser journeys, configurable export-capacity simulation, root lint/type/architecture/test/build gates, and a final security/correctness review. Resolve all load-bearing findings before declaring completion.
