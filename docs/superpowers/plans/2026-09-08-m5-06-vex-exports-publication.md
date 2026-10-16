# M5-06: validated VEX exports and controlled publication

## Scope

Deliver a release-scoped, reproducible OpenVEX 0.2.0/CycloneDX 1.6 export from
effective VEX assessment revisions, plus opt-in delivery to deployment-owned
targets. Preserve assessment history and keep a valid private download usable
when external publication fails. No public disclosure, generic bus, SBOM
exporter, regulatory reporting, raw URL, credential, or port-3000 change.

## Task 1 — Contract and authorization boundary (red, then green)

Files: `packages/contracts/src/vulnerabilities/{schemas,types}/vulnerability-vex-export.*`, their barrels, and `packages/contracts/src/permissions.*`.

1. Add strict request, path/query, response and safe error schemas with derived
   `z.output` types.
2. Add `findings.export` and `finding_publication.manage` to the existing
   permission matrix and only owner/admin defaults.
3. Test unknown-key rejection, scope/idempotency control, safe download handoff,
   target confirmation and invalid lifecycle combinations.

## Task 2 — Durable local persistence (red, then green)

Files: one CLI-created migration and focused SQL tests under
`apps/infrastructure`.

1. Add immutable snapshot/revision rows, tenant-scoped target configuration,
   lease-backed publication jobs, and append-only attempts.
2. Add org-first, pinned-path service RPCs that atomically create/export audit
   facts, target confirmation and job state changes.
3. Enable non-forced RLS, revoke public function execution, grant only service
   access, add indexes/constraints, and test RLS, idempotency, tenancy, leases,
   failure, replacement and withdrawal.

## Task 3 — Export generation and storage (red, then green)

Files: `apps/api/src/findings/exports/**`, Nest assets configuration, tests.

1. Build deterministic pure generators with pinned OpenVEX and CycloneDX assets
   and golden fixtures.
2. Reject no eligible decisions and lossy CycloneDX mappings; exclude text,
   evidence URLs, notes and secrets.
3. Upload canonical bytes only to the private export bucket and provide a
   short-lived authorized download handoff.

## Task 4 — API/application/worker integration (red, then green)

Files: export controller/use case/repository/worker, `findings.module.ts`,
`vulnerability-vex-publication-worker.ts`, config/package scripts, tenant
export registry, tests.

1. Parse all inputs/responses at `/api/v1/findings/vex-exports`, with static
   paths kept ahead of dynamic ones and existing assessment routes unchanged.
2. Scope every service call by verified actor/org, recheck permissions, and map
   optimistic/idempotency/format failures without leaking provider detail.
3. Run a feature-local claim/deliver/complete/fail worker against a server-only
   target registry; enforce HTTPS allowlisting, public DNS, redirect/size/time
   bounds, and stable delivery keys.

## Task 5 — Triage UI (red, then green)

Files: existing `apps/web/app/_features/findings/**` feature area and colocated
Vitest tests.

1. Add a compact, accessible release-scope preview, export/download controls,
   publication confirmation and history to the existing Operate-mode triage
   surface.
2. Use the gateway for validated writes and query invalidation. Preserve values
   across validation, conflict and offline failures; never automatically replay
   mutations.
3. Verify keyboard/focus/non-colour state labels and responsive rendering.

## Task 6 — integration, verification, and review

1. Apply the additive migration locally without reset; regenerate types through
   the CLI, inspect live schema/RLS/functions read-only through Supabase, and
   confirm migration drift.
2. Run focused contract/API/SQL/web suites, coverage where available, DB lint,
   architecture checks and `pnpm verify`; deliberately omit the destructive
   global live suite that clears shared Mailpit data.
3. Start only isolated API/web development ports (not 3000), provision uniquely
   tagged local fixtures, and use browser automation for desktop/mobile
   screenshots of validation, export, mapping error, confirmation and retained
   download after publish failure.
4. Run the Impeccable detector once on changed web targets and an independent
   correctness/security review. Fix any blocking finding, then re-run relevant
   tests.

## Deploy and rollback

Deploy expand-only: migration and generated types, API/worker/config, then web.
Rollback API/web/config first. Keep immutable snapshots, selected revision
references and publication attempts intact; old versions ignore the new state.
