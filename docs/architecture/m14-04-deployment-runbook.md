# M14-04 deployment and rollback

## Baseline and additive rollout

The verified development baseline is `59093a2`. Local project `cra` uses API `http://127.0.0.1:54321`, PostgreSQL 17.6 and Storage 1.77.0. The existing database had 186 recorded migration versions versus 627 repository files. Do not replay historical migrations or repair the ledger blindly.

Local verification applied the six `20261012*_m14_04_*` feature migrations and the timestamp, recovery/fairness, preview/index and audit compatibility amendments through `supabase migration up --local --workdir <private-stage>`. The stage copied the existing CRA configuration, represented the exact 186 recorded versions with no-op markers, and supplied only the new feature files. All original feature files were SHA-256 checked immediately before application. This procedure is specific to the verified local baseline; another environment needs its own baseline validation and approved backup process. No reset, storage restart, historical replay or ledger repair occurred.

Apply additive schema first, then run `pnpm --filter infrastructure run db:types` to regenerate both public type copies. Deploy contracts/API/workers/UI together. Keep the service key server-side. Verify enabled non-forced RLS, browser-role revocation, tenant-qualified foreign keys, pinned function search paths and explicit service-role grants. The schema adds three report tables and extends existing export jobs, notification preferences and dispatch/feed functions.

## Processes and operational limits

Run the API with the normal verified environment, real web origin and mocks disabled. Run `pnpm --filter api run worker:reports` separately under supervision. It schedules bounded occurrences and reuses the existing export rendering/storage engine. Existing `worker:notification-dispatch` delivers optional report email through M12; inbox publication does not depend on SMTP. A single cycle can be invoked with `--once`.

Limits are 100 active definitions per organization, 20 recipients per definition, two admitted scheduled exports and one running scheduled export per organization. Manual exports have priority within the same tenant. Recurrence coalesces only the latest missed occurrence within 24 hours; immutable run snapshots preserve the definition version and actual capture time. Recipient roster pages are bounded to 50.

Monitor generation separately from email. `delivery_uncertain` and ambiguous expired send leases are terminal uncertainty. Never resend accepted or uncertain delivery blindly. Known pre-send errors alone may use bounded retries. Expired artifacts cannot be regenerated through replay. Owner authority loss pauses scheduling; recipient removal permanently revokes existing recipient links.

## Compatibility and rollback

Interactive exports remain session-bound. Auth cookies, JWT/JWKS, zero configured session skew, permission merge order, menu and source approvals are preserved. The existing JWT `iat` and epoch comparison has whole-second resolution; this feature follows that authoritative guard contract.

Rollback pauses active schedules through the authorized administration routes and stops the separately supervised report worker, while retaining schema, definitions, run snapshots, artifacts and audit history. Pause cancels queued report notices and prevents preparation of leased report notices; an email already accepted by SMTP remains accepted or uncertain. Keep the shared M12 worker running so critical and unrelated notifications continue. Retain compatible read/download APIs for authorized existing artifacts. Pausing definitions stops new generation/delivery and preserves completed authorized downloads until their availability expiry. Do not run destructive down migrations or remove objects.

Artifact availability is 24 hours and grants are five-minute, one-use, session-bound HttpOnly credentials. Expiration is not deletion authorization. Existing retention, legal-hold and archival authorities remain in control; no cleanup/backfill is introduced. Storage growth requires operational monitoring.

## Verification environment

The unrelated application on port 3000 was preserved. Live CRA verification uses web 3002/API 3334 with `WEB_ORIGIN` and `APP_URL` set to `http://localhost:3002`, `API_ORIGIN` set to `http://localhost:3334`, and `NEXT_PUBLIC_ENABLE_MOCKS=false`. The isolated Next build directory is excluded from Tailwind, ESLint and TypeScript scanning. Seeded owner credentials are used only through the sign-in flow; secrets are not recorded in evidence.

## Audit source compatibility

Minimal `scheduled_report` audit metadata is visible under existing `can_view_audit`, with matching API source policy and a statically reviewed M13 range dependency fingerprint. Recipient eligibility is omitted from audit input and remains an owner-only immutable preview snapshot. The canonical audit projector adds only bounded occurrence coalescing counts, one boolean and four UTC scheduling timestamps; the explorer read projector remains unchanged. No report content, filters or source record counts are added to audit metadata.

The migration publishes explicit `audit.range.scope_changed` security receipts for organizations with existing verification workflows. Earlier range authorizations/results become unavailable under the changed predicate and need the existing explicit reauthorization/new-verification flow. Dataset/session epochs, source rows, checked chains and checkpoints are not rewritten. Existing signed audit searches whose permitted source vector changes require refresh, preserving the snapshot authority model.

Companion manifest checksums are persisted and frozen on the recipient row before inbox/email publication; existing immutable manifests receive their computed checksum without content changes. Download authorization requires a matching checksum. Capture permission versions remain the versions recorded by the export capture, and any current permission revision denies that frozen source snapshot.

Tenant-wide M1 archives explicitly exclude the three report workflow tables, consistent with existing private export jobs: raw schedules, recipient selections, other recipients' manifests and grant material cannot be copied through an operator archive. Source-owned records and redacted durable audit facts retain their existing archive authorities. This adds no deletion or retention bypass.
