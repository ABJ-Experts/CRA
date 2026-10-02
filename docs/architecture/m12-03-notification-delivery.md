# M12-03 durable email delivery and preferences

## Scope and preserved contracts

- **User outcome:** internal users can choose immediate, daily, weekly, or off for optional workflow email; M2 support-period and M6 reporting-deadline alerts remain mandatory and visibly retryable.
- **In scope:** optional M5 triage, M8 evidence, and M9 internal owner-escalation mail; M2/M6 critical routing; bounded digests; relay TLS; provider acceptance and failure visibility.
- **Out of scope:** authentication mail preferences, external supplier mail preferences, KEV/finding-review/note-mention cutover, an in-app notification centre, hosted email purchase, and proof of inbox receipt without provider confirmation.
- **Preserved:** `/api/v1`, ES256/JWKS and cookie scope, frozen auth actions, permission merge order, menu and mock behavior, all source workflow states, and the current best-effort failure behavior of optional authentication mail. Current source outboxes remain the durable source intents.

## Concrete problem and why not simpler

`MailService` currently disables SMTP certificate validation even for remote relays and logs provider text. M2, M5, M6, M8, and M9 have separate durable queues, but no per-user category policy, bounded digest, or common safe failure view. M6 also checks the organization email-channel setting when creating and sending deadlines, which can silence a mandatory alert. Merely adding a preference check before the existing `sendMail` calls cannot group a digest durably or prevent the old and new workers from both sending the same event.

The direct starting point is to retain source-owned queues and add policy checks. M2 and M6 stay on their reviewed direct workers. Optional sources need a small durable dispatch record and a digest batch because SMTP and the database cannot share a transaction. A per-organization delivery-mode switch fences legacy claims during the optional cutover; it is not a new workflow designer or event bus.

## Selected and rejected patterns

- **Feature-local adapter:** source-specific handoff and send-time projection translate M5, M8, and M9 queue records into one optional delivery contract. Presentation calls application logic; application owns the port; SQL/SMTP implement it. Each adapter has the same contract test for source identity, tenant scope, current authorization, and terminal completion. Remove an adapter when its source is retired.
- **Persisted state:** optional dispatches and digest batches represent queued, leased/attempted, failed, exhausted, provider-accepted, and cancelled states. SQL compare-and-swap and leases own transitions. Remove the shared dispatch state if category/digest delivery is retired.
- **Existing command/audit pattern:** settings, routing, and retry carry actor, expected version, idempotency key and request digest; state and `audit_logs` commit together. No command bus is introduced.

Reject a generic event bus, queue service, new role system, hosted email SDK, per-tenant SMTP credential store, and rewriting existing source outboxes. A single JSON blob of digest items without per-source uniqueness would not prevent duplicate handoff or enable precise authorization rechecks.

## Data and tenant boundaries

Verified session identity provides actor and organization for web requests. Workers use recorded organization and source identity; every service-role query starts with `organization_id` and rechecks active membership, effective permission, product scope, source status, and recipient eligibility before rendering or sending. Browser preference state grants no access.

Three narrow tables hold user preferences, optional dispatches, and frozen digest batches. Preference rows are scoped by `(organization_id,user_id)` and versioned. Dispatch identity is unique by `(organization_id,source_kind,source_id,intended_user_id)`; a digest batch has one organization, recipient, category, timezone window, and at most 100 items. Source transitions already commit source outbox events atomically. Handoff inserts a dispatch under a source-row lock. Provider-acceptance completion updates dispatch, source queue and audit fact in one PostgreSQL transaction. SMTP acceptance can precede that commit, so a crash may cause a bounded repeat with a stable message ID; no exactly-once claim is made.

Critical route policy retains the accountable original recipient. A substitute must be an active owner/admin with current source permission and product scope. Invalid substitutes fall back to an eligible original or owner/admin; no eligible recipient leaves a durable unresolved alert visible to admins. M6 ignores optional channel/preference/quiet-hour settings for mandatory thresholds. An effective recipient is sent at most once per source event in a successful claim cycle.

Use CLI-generated additive migrations, non-forced RLS, explicit service-role grants, `public.users.id` FKs, pinned function `search_path`, and regenerated database types. No data reset or production database action is part of implementation. Tenant export includes retained delivery facts but excludes non-portable leases, digests, secret material, and command keys; purge registration follows existing organization lifecycle rules.

## API boundary contracts

`@repo/contracts/notifications/{schemas,types}` defines strict path, query, body and successful response schemas; trusted wire types are `z.output`. `GET/PATCH /api/v1/notifications/preferences` is self-scoped. Owner/admin routes manage a critical substitute for a specified original user. Audit-authorized delivery listing is bounded and cursor-paginated; versioned retry applies only to exhausted work after fresh source and recipient checks. Controllers parse each consumed input and annotate every JSON response with `@ZodResponse`. The browser gateway provides `inputSchema` for mutations and `schema` for successful responses. Unknown categories, modes, fields, path identities, or timezone values fail validation.

## Frontend logic and rendering

Functional React panels extend `/account` for preferences and `/organization` for critical routes and safe delivery failures. A focused plain `.ts` gateway owns the existing authenticated transport. Pure schedule/status formatting stays immutable. The panels show loading, empty, overdue, forbidden, offline, conflict, failed, and retry states; retain unsaved non-secret drafts and keyboard focus; and use semantic tokens, `cn()`, and shared UI subpaths. No top-level navigation item is added.

## Failure modes

- **SMTP disabled, TLS invalid, timeout or rejected recipient:** required delivery records a safe code and bounded retry; optional auth request semantics remain unchanged. Timeout after SMTP acceptance is marked uncertain and retried only with the stable message identity, without claiming deduplication by the relay.
- **Worker restart or duplicate/out-of-order event:** source uniqueness, dispatch uniqueness, lease versions, and database time prevent two database completions. The source event remains durable while SMTP is unavailable.
- **Preference, route, membership, product permission or source change:** worker rechecks at send time; optional work may be cancelled or rescheduled, while mandatory work uses an eligible fallback or remains unresolved and visible.
- **Digest DST gap/fold:** each half-open local window is scheduled once; an invalid local send time advances to the next valid instant and a repeated local hour uses its first occurrence. Membership freezes before the first attempt, with a 100-item cap and bounded overflow batches.
- **Rollback mid-cutover:** stop new claims, drain leases, switch the organization to legacy mode, and expose only unaccepted source rows to old workers. Provider-accepted rows remain terminal and audit evidence remains. Review uncertain attempts before resending.

## Tests and observability

Start with failing characterization tests for Mailpit, optional auth mail, M2/M6 queue behavior, and the old source claim functions. Add schema/policy tests, SQL transaction/RLS/grant tests, source-adapter fixtures, DST and overflow tests, SMTP TLS/timeout/relay-outage tests, concurrent handoff/retry/restart tests, and browser journeys. Require at least 80% branch/function/line/statement coverage for new or materially changed modules. Run local database lint/drift, `pnpm verify`, `pnpm test:live`, auth and organization-switch regressions, Playwright MCP owner journeys, accessibility checks, and bounded read-load measurements. Logs and UI expose only safe error codes, attempt counts, provider-accepted timestamps, backlog, and source links after authorization.

## Rollback and review checklist

Deploy additive schema/types before API and UI. Start the optional dispatcher in legacy mode, drain each organization's legacy leases, then switch that organization to unified mode. Roll back by stopping dispatcher claims and switching the organization to legacy after reviewing uncertain attempts. Keep migrations, source facts, preferences, and audit history; never delete user data to roll back.

- [x] Direct solution considered before adding durable dispatch and digest state.
- [x] Present adapter/state/command triggers and contract tests identified.
- [x] No request, user, tenant, or session state is global.
- [x] Controllers and pages remain outside provider access and policy decisions.
- [x] Application depends inward on source and delivery ports.
- [x] Boundary parsing and `z.output` contracts are specified.
- [x] Security-critical state and audit share a transaction.
- [x] Coverage, compatibility, live-stack, and rollback gates are specified.

## Operator runbook

Run the additive Supabase migrations in filename order before deploying the API or web build, then regenerate both database type copies with `pnpm --filter infrastructure run db:types`. No source-event backfill is required: existing M5, M8, and M9 outboxes are the durable intent, and the unified bridge stages their open work when each organization is switched. Keep the M2 and M6 source workers running for mandatory deadlines. Start `pnpm --filter api run worker:notification-dispatch` for optional immediate mail and digests; `--once` runs one bounded cycle for smoke checks. Monitor the admin delivery list, source outbox lag, and worker safe error codes. SMTP acceptance is shown as **provider accepted**, not receipt.

For local Mailpit, use `SMTP_TLS_MODE=mailpit`, loopback `SMTP_HOST`, and port `54325`. For a customer relay, use `SMTP_TLS_MODE=starttls` or `tls`, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, optional credentials, and mount a PEM bundle via `SMTP_CA_CERT_PATH` when the relay uses a private CA. `SMTP_TLS_SERVERNAME` must match the certificate hostname when connecting by IP. Timeouts are bounded by `SMTP_CONNECTION_TIMEOUT_MS`, `SMTP_GREETING_TIMEOUT_MS`, and `SMTP_SOCKET_TIMEOUT_MS`. Store passwords and CA material in deployment secrets, outside exported organization configuration and logs. A TLS or relay outage leaves source work durable and visible; it must not block core triage, evidence, or reporting actions.

Cut over one organization at a time after old optional-worker leases drain. The service-only `set_notification_delivery_mode_atomic(organization_id, 'unified')` RPC serializes the switch with legacy claims; `updated` or `unchanged` is success. `active_lease` requires waiting and retrying. To roll back, stop the unified worker and call the same RPC with `legacy`. The guard cancels never-attempted queued dispatches while leaving their source events open for legacy processing. `unsafe_rollback` means an attempted, digest, or preference-suppressed item cannot safely return to legacy; reconcile it with its source and retained audit facts before retrying. Never force a direct settings update or delete delivery evidence to make a rollback pass. Manual retry of exhausted work rechecks current source, recipient, and permissions. An expired lease with uncertain SMTP acceptance requires operator review because the relay may already have accepted the message.

An expired digest lease exhausts its child dispatches with the safe `lease_expired_ambiguous` code. The scheduler leaves that batch intact and will not resend it automatically; an administrator must reconcile possible SMTP acceptance and explicitly retry eligible exhausted children. Reconciliation handles at most 100 batches per transaction, so repeat the worker cycle if more are pending.

## BRD-to-test traceability

| BRD requirement | Implementation boundary | Executable evidence |
| --- | --- | --- |
| FR-WF-005 category preferences and digest schedule | `@repo/contracts/notifications`, self-scoped preferences API, `notification_preferences`, digest batch scheduler, `/account` panel | `notification.schema.spec.ts`, `notifications-use-cases.spec.ts`, `m12-03-notification-digest-scheduling.test.sql`, `digest-notification-dispatch-worker.spec.ts`, `notification-preferences-panel.spec.tsx` |
| FR-WF-008 mandatory critical routing | M2/M6 source queues, critical route and eligible-recipient SQL, admin API and `/organization` panel | `product-retention-worker.spec.ts`, `reporting-deadline-monitor-worker.spec.ts`, `m12-03-critical-delivery-operations.test.sql`, `notification-admin-panel.spec.tsx` |
| FR-WF-009 durable delivery and failure visibility | M5/M8/M9 source handoff, `notification_dispatches`, leased worker, safe SMTP receipt, admin list/retry | `m12-03-notification-delivery.test.sql`, `m12-03-triage-supplier-bridge.test.sql`, `notification-dispatch-worker.spec.ts`, `mail.service.spec.ts`, `notifications.e2e-spec.ts` |

## 2026-10-02 completion and release evidence

The forward-only `20261002070559_m12_03_critical_recipient_unavailable.sql` migration updates the existing M6 send-time details RPC without adding tables or columns. An obsolete, submitted, cancelled, or rehearsal source still cancels its delivery. An otherwise live mandatory deadline with no eligible recipient now commits `dead_letter`, the safe `recipient_unavailable` code, and an audit fact in one transaction. The existing admin list shows it as exhausted. After an authorized destination is restored, the existing versioned retry queues it; a stale or duplicate retry does not queue another copy. The historical `20261001155100_m12_03_rehearsal_delivery_guard.sql` remains unchanged. Rollback requires a new forward migration restoring the prior function definition, after reviewing unresolved recipient failures; never edit an applied migration or delete delivery facts.

The admin delivery query runs only with `can_view_audit`; route editing and retry retain their separate manage permission. The account form uses the shared quiet-hours schema before saving and keeps the draft on validation, conflict, or network failure. No optional organization was switched to unified delivery. SMTP relay behavior remains `provider_accepted` after `250` acceptance, without claiming inbox delivery or exactly-once receipt. A local TLS relay test confirms rejection of an untrusted certificate and wrong hostname, plus acceptance with the configured CA and matching hostname. Mailpit still uses unauthenticated SMTP on port `54325`.

| Requirement or regression | Executable evidence |
| --- | --- |
| Missing/revoked M6 recipient, repaired route, duplicate effective recipient, concurrent retry, safe audit | `apps/infrastructure/tests/m12-03-rehearsal-delivery-guard.test.sql`; API repository and worker specs |
| Audit permission revoked or granted without unauthorized polling | `notification-admin-panel.spec.tsx`, `notifications.queries.spec.tsx`, `notifications.e2e-spec.ts`, `apps/web/e2e/m12-03-notifications.spec.ts` |
| Quiet-hours validation and saved draft across organization switches | `notification-preferences-panel.spec.tsx`, `apps/web/e2e/m12-03-notifications.spec.ts` |
| Certificate/hostname validation and acceptance semantics | `apps/api/src/mail/mail.service.tls.spec.ts` |
| Mandatory dispatch bypasses optional mute and quiet hours, unavailable-recipient failure, admin retry, and one Mailpit message per event after repeated worker cycles | `apps/web/e2e/m12-03-notifications.spec.ts` against a run-scoped local organization |

Local verification passed `pnpm verify`, `pnpm test:live`, focused SQL/Jest/Vitest suites, `db:lint`, generated-type alignment, and the Chromium browser journey. The focused web modules measured 95.43% statements, 87.62% branches, 91.66% functions, and 95.43% lines. The changed M6 worker measured 93.93% statements and 89.36% branches; the mail service measured 94.85% statements and 84.09% branches. The reporting repository measured 91.42% statements, 86.2% branches, 94.73% functions, and 92.07% lines after adapter contract tests were added. The SQL path also has transactional coverage. The browser test writes only a uniquely named organization and account, cleans those IDs, and leaves seeded data intact. Desktop/mobile preference, delivery, failed-recipient, retry, audit-only, and forbidden screenshots are produced in that test's Playwright output.

A local read smoke measured 40 successful responses per endpoint at five concurrent requests: preferences p95/p99 109/111 ms, delivery listing p95/p99 94/97 ms, below the 400/1000 ms targets on this seeded stack. A 100-request burst reached the existing 60-per-minute route throttle and returned 429 after the first 60, as expected. These numbers do not establish production latency at realistic tenant size or load.

Parallel full-suite runs intermittently exceeded existing five-second SBOM and fifteen-second showcase test timeouts under local contention; each affected test passed in isolation. The complete test lane passed with `pnpm exec turbo run test --concurrency=1`, and the production build passed. Keep this test-runner load sensitivity visible when interpreting CI results; it is unrelated to notification delivery behavior.

The local Supabase migration ledger predates this work and contains only a subset of the repository's historical migration files. The new function migration was applied in one local transaction and only its version was recorded. The broad `supabase db diff --local --schema public` output therefore cannot serve as a clean drift assertion for this restored stack; compare this function, grants, and the migration version directly, then validate the full migration chain in a fresh staging database before production deployment. Local Supabase MCP confirmed zero unified organizations and zero leftover run-scoped test organizations after the browser run. Security advisors report existing private service-owned notification tables with RLS enabled and no browser policies; the migration adds no new table or RLS policy.

Deploy this schema change before API/web. Keep the optional dispatcher in legacy mode for existing organizations, drain their legacy optional leases, and perform any later unified cutover one organization at a time. The critical M2/M6 source workers continue independently. Relay timeouts and ambiguous acceptance still require operator review; a customer SMTP relay does not provide bounce or inbox-confirmation evidence by default.

Residual constraint: SMTP provides no trustworthy inbox-receipt or exactly-once guarantee. Provider acceptance can precede the database completion; uncertain attempts are quarantined for review. Customer-specific SMTP behavior, actual production load, and a real recipient inbox still require deployment validation.
