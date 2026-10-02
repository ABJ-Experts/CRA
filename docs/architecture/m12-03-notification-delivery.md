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

Residual constraint: SMTP provides no trustworthy inbox-receipt or exactly-once guarantee. Provider acceptance can precede the database completion; uncertain attempts are quarantined for review. Customer-specific SMTP behavior, actual production load, and a real recipient inbox still require deployment validation.
