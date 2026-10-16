# M15-01 Offline Licensing Implementation Plan

> For agentic workers: use subagent-driven development, failing tests first, focused independent review, then full integration verification.

**Goal:** Implement offline-verified tenant/instance licences, safe expiry, module entitlements and atomic growth limits without holding evidence hostage.

**Architecture:** Functional UI and injected gateway use feature-first Zod contracts. Thin Nest controllers invoke application ports; Supabase adapters own atomic persistence. Existing source authorities continue to own approval, retention, identity and audit.

**Tech Stack:** pnpm, TypeScript, Zod, jose EdDSA/Ed25519, Nest, PostgreSQL/Supabase, Next/React, Jest/Vitest/Playwright.

**Spec:** User-approved M15-01 plan; BRD v2 pages 14, 36-37, 54-56, 64-65. Feature design: docs/architecture/m15-01-local-licensing.md.

## Global constraints

- Baseline 2748133 on milestone-1. No reset, historical migration replay, remote resource mutation, signing key distribution, data deletion or unrelated browser cleanup.
- Preserve API prefix/cookies/JWKS/frozen actions/zero epoch skew/permission order/menu/MSW/source approvals/non-forced RLS.
- Only two new tables: organization licence state and tenant storage admission/accounting. Existing M13 events own activation history/idempotency evidence.
- Per-tenant licences bind stable deployment instance UUID; 30-day grace; provisioning precedes enforcement, with no production bypass/trial.
- Owner/admin receive dedicated view/manage licence permissions. UI warnings only; no new notification category.

## Review focus

- Invalid replacement and audit failure preserve prior licence; concurrent activation/replay are deterministic.
- Licence expiry never blocks authenticated retained evidence/manual exports, audit or protective work.
- Signature/binding/config are validated locally; clock checkpoints never silently rewind.
- Growth accounting includes pending invitations, nonarchived products and reserved customer-input bytes; unknown accounting is unavailable, not zero.
- HTTP checks alone cannot protect queued workers or transactional writes; operation classification is exhaustive.

## Tasks

- [x] Contracts/policy: pin compact JWS EdDSA, Ed25519 public trust, CRA-LICENCE+JWS header, strict schema v1, UUID bindings/sequence, UTC dates, fixed graceDays=30, unique module grants, nullable finite limits, max artifact 32768 bytes. RED tests cover malformed/unknown/tampered/wrong binding/future/past-grace/expiry boundary/restart/config deny/clock rollback; GREEN verifier and policy; coverage >=80%.
- [x] Persistence: inspect live CRA catalog, create CLI migrations for licence state and storage ledger, pinned search paths and explicit grants/non-forced RLS. Atomically authorize/lock/replay/replace/audit; invalid attempts record safe digest/reason only. Keep issuer sequence monotonic. RED SQL tests cover isolation, audit rollback, concurrency, replay, downgrade and limits; apply only new migrations, regenerate both types.
- [x] Admission/enforcement: classify every route/worker/source mutation. After RBAC, enforce licence capability; mixed actions decide only after Zod parsing. Recheck source transaction at commit. Seat/product/storage admission is atomic; connector/import creation uses same product authority. Missing grant disables relevant use, local configuration never grants. Protect existing regulatory obligation continuation via M6 evidence; retain human approvals.
- [x] Uploads/jobs: preserve uploadUrl/expiresAt and XHR PUT interface, use short-lived bounded API-owned upload authority, stage/hash/inspect before storage publication. Meter all input ingress including imports/branding; generated safety/export output is exempt. Finish admitted bounded steps; pause unstarted work without retry consumption; fresh checks on resumption. Reconcile uncertain effects and ambiguous charged reservations.
- [x] UI: Organization settings Licence tab, gateway and scoped banner; permissions owner/admin. Active/grace/expired/missing/invalid/clock/stale/forbidden/conflict/retry states; preserve drafts except tenant switch. Separate last failed attempt from current valid licence, accessible tables/labels/focus, semantic tokens/Poppins/reduced motion/locale dates.
- [x] Verification: focused RED/GREEN coverage, SQL/concurrency/storage/API/auth/Playwright tests, egress-blocked core, pnpm verify and applicable live regressions. Verify owner through Playwright MCP and cross-check matching local Supabase MCP, desktop/mobile screenshots; no unrelated data cleanup. 200-sample realistic status/history/admission load checks at 10k members/products/audit events and 100k objects with small-tenant concurrency. Record actual browser engines and residual limits.

## Defaults and transition policy

Warnings: expiry within 30 days; finite capacity >=80%. Expiry inclusive; read-only at expiry +30 days. Five-minute backward discrepancy is clock-untrusted; persisted high-water and process monotonic elapsed time prevent automatic rewind, without hardware-grade guarantees. Limits count active members plus distinct live reserved invitations, nonarchived products and retained customer-input bytes plus reservations. Protected generated artifacts are shown separately. Existing active regulatory obligations can finish normal human-authorized drafting/evidence/approval/submission, but unrelated writes/new elective workflows/rehearsals cannot. Started steps finish; queued customer work pauses. Preserve data on downgrade.

## Rollout and evidence

Verify destination/catalog -> additive schema and idempotent accounting backfill -> stable instance/public trust -> signed tenant provision -> drain actual legacy upload token lifetimes -> deploy all API/workers/web enforcement. Never silently remove enforcement on rollback. Produce requirement/test mapping, contract links, screenshots, raw timings and migration/trust/renewal/clock/rollback runbook. No zero-bug or legal certification claim.
