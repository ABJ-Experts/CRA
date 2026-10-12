# M14-04 Scheduled reports

## Scope and preserved contracts

Save bounded definitions for every member export source and product readiness, preview before activation, recur daily/weekly/monthly, capture separate owner/recipient-authorized artifacts and send protected links through inbox/email. Exclude portal sources, public sharing, external addresses, attachments, arbitrary SQL/scripts, chat delivery and regulatory decisions. Preserve all interactive export/session, permissions, menu, mock and retention contracts.

## Concrete problem

M14-03 `export_jobs` requires a live member session and stores one requester-bound grant. M12 has durable email attempts but no analytics recurrence authority. Neither table models a versioned recurring definition, stable occurrence or recipient-specific artifact authority. Audit/trend exports currently consume transient UI tokens.

## Why not simpler?

Adding a cron column to exports loses definition versions, owner lifecycle and occurrence identity. Creating another export/delivery framework duplicates mature capture, renderer, storage and SMTP logic. Three bounded scheduling tables plus existing export/dispatch references are the smallest complete model; no revision, grant, attempt or generic event-bus table is introduced.

## Selected patterns

- State: persisted definition/run/recipient lifecycles with optimistic versions and fenced leases; exhaustive transition and replay tests. Remove only if recurring workflows are retired while retaining evidence.
- Adapter: ReportsPort and background export/source ports own provider-independent outcomes; Supabase/SMTP implement them. Contract tests pin scope/error mapping.
- Command records: immutable parsed config, idempotency key and expected version; transaction RPCs atomically mutate and audit. No command bus.
- Durable outbox: existing M12 dispatches own optional email; source report publication is durable before notice. No authorization-critical in-process observer.

## Rejected patterns

No cron framework, scheduler singleton with user state, generic BI factory, event bus, subclass renderer hierarchy or speculative cleanup service. Existing functions, focused classes and database locks express current needs.

## Data and tenant boundaries

HTTP identity comes from the verified RequestUser. Background authority is a definition/run/recipient reference plus current database membership and source policy, never a synthetic session. Every repository method takes organization first and every tenant query filters it. Definitions store <=20 distinct member UUIDs; transactions validate membership; normalized run-recipient rows have tenant-qualified foreign keys. Every preview/occurrence freezes configuration and schema digest. Removed recipients receive permanent revoked markers. Critical changes/publication/replay/download facts share durable M13 audit transactions.

Only three new tables: report_definitions, report_runs and report_run_recipients. Existing export jobs gain a strictly constrained scheduled subject/reference; member jobs still require session. Notification preferences gain independently versioned report-email columns, preserving legacy modes. New tables use enabled non-forced RLS, explicit service grants and pinned function search paths. Local historical ledger mismatch is not repaired or replayed; only new CLI migrations are applied using the documented staging baseline.

M13 audit source visibility treats `scheduled_report` as safe audit metadata gated by `can_view_audit`. This allows a report audit event to serve as the required predecessor of a later audit-range verification without disclosing report configuration, filters, recipient artifacts or content counts. The TypeScript source catalogue and SQL cached visibility policy must stay aligned. M1 owner-wide tenant archives explicitly exclude the three report workflow tables because frozen configurations are self-scoped and recipient rows include private manifests and session-bound grant material; source-owned business records and safe report audit facts remain in their existing export and retention authorities.

## API boundary contracts

`@repo/contracts/reports/schemas` owns definition/report selection, recurrence/date windows, mutations, paths/queries, responses and manifest. Parsed types derive with z.output under reports/types. Controllers use zodBody/zodQuery/zodParams and ZodResponse or NonJsonResponse(stream); gateways provide inputSchema/schema. Unknown/script/SQL/internal fields are rejected; saved config excludes pagination and transient tokens. Source contract hashes detect incompatible changes and pause instead of coercing. `/api/v1/reports` is authenticated/self-scoped with source permissions rechecked in application/RPC.

## Frontend logic and rendering

Functional reports workspace/editor/history/run detail and shared member schedule controls. ReportsGateway owns injected HTTP lifecycle; deterministic draft/source policy stays functions. Existing dashboard shell/sidebar/semantic tokens/Poppins identity remain authoritative. The user's restrained operational brief takes precedence over marketing-style hero/GSAP instructions. Preserve drafts, visible focus, keyboard operation, accessible labels and reduced-motion behavior.

## Failure modes

Database/network/provider uncertainty is unavailable/retryable without inventing authorization. Owner loss pauses and revokes; recipient loss skips/revokes; no rerouting. Schema changes require edit/preview. Duplicate commands/claims replay through stable keys; stale workers fail fencing. Only latest missed occurrence within 24h is eligible; gaps skip, folds choose first and month-day clamps. Paused schedules stop new generation/delivery. SMTP possible acceptance is terminal uncertainty, including expired attempted leases; no blind resend. Completed artifacts survive delivery failure. Grants are recipient/session-bound, one-use, 300s; authorization is rechecked after storage open and during streams. Artifact expiry is availability, not deletion authority.

## Tests and observability

Characterize interactive export and M12 behavior first; add failing policies/contracts, rollback SQL/RLS/concurrency, adapter/controller/worker/download, browser and accessibility tests. >=80% coverage for changed modules. Run pnpm verify and applicable live gates. Log safe codes/opaque workflow IDs, not email, filters, tokens or content. Measure bounded queue admission/manual priority and realistic read latency. Produce Playwright MCP screenshots and requirement-to-test evidence using owner login and isolated fixtures; never clear unrelated site data.

## Rollback

Disable new scheduling and delivery dispatch creation, stop scheduled worker, retain additive schema, definition snapshots, artifacts, audit and compatible authorized read/download paths. No automatic deletion or destructive migration. Existing M1/M2/M8 retention and holds, M6 deadlines and M7 snapshots remain source authorities.

## Review checklist

- [x] Direct solution considered; patterns have demonstrated triggers and test boundaries.
- [x] No global user/session state, page/controller provider calls or outward core dependency.
- [x] Shared runtime schemas/parsed types and response/transport parsing are required.
- [x] Critical effects are durable and rollback retains evidence.
- [ ] New/refactored module coverage >=80%.
- [ ] Focused, compatibility and live-stack gates passed.
- [ ] Independent review has no unresolved high/critical findings.

## Implementation coordination contract

All implementers use the following names and wire shapes; changes require coordination before callers are updated.

- `ReportConfiguration`: `{title, report, schedule, dateWindow, recipientUserIds, emailEnabled}`. `report` is `{kind:"list",source,format:"csv"|"xlsx",context,filters,columns?}` or `{kind:"readiness",productId}`. `schedule` is `{frequency:"daily"|"weekly"|"monthly",timezone,localTime,weekday?,monthDay?}`. `dateWindow` is `{kind:"fixed"}` or `{kind:"rolling",days:7|30|90}`.
- `ReportDefinition`: `{id,ownerUserId,definitionVersion,version,state,config,configDigest,schemaVersion,nextDueAt,previewRunId,pauseReason,createdAt,updatedAt}`; definition state is draft/active/paused/archived. Schema version is `m14_04_v1`.
- `ReportRun`: `{id,definitionId,definitionVersion,kind,state,scheduledFor,occurrenceKey,createdAt,finishedAt,safeErrorCode}`; kind preview/scheduled, state scheduled/running/succeeded/failed/paused.
- `ReportRunRecipient`: `{id,userId,generationState,emailState,safeErrorCode,expiresAt,artifacts}`; generation waiting/running/ready/skipped/failed/revoked, email pending/off/queued/accepted/uncertain/failed/skipped. Artifact shapes reuse ExportArtifact. Owners never receive another recipient's artifacts.
- Responses: definition `{data:ReportDefinition}`; definitions `{items:ReportDefinition[],nextCursor:string|null}`; run detail `{run:ReportRun,recipients:ReportRunRecipient[]}`; run list `{items:ReportRun[],nextCursor:string|null}`; recipients `{items:{id,displayName}[]}`; email preference `{mode:"immediate"|"off",version:number}`.
- Input schemas: `reportConfigurationSchema`, `createReportDefinitionSchema` (config + idempotencyKey), `updateReportDefinitionSchema` (config + expectedVersion + idempotencyKey), `reportMutationSchema` (expectedVersion + idempotencyKey + optional previewRunId), `reportDefinitionParamsSchema` (definitionId), `reportRunParamsSchema` (runId), `reportRecipientParamsSchema` (runId,recipientId), `reportDownloadParamsSchema` (runId,recipientId,grantId), `reportListQuerySchema` (cursor?,limit default25 max50), `reportRunsQuerySchema` (definitionId?,cursor?,limit default25 max50), `reportGrantInputSchema` (artifactId), `reportEmailPreferenceInputSchema` (mode,expectedVersion,idempotencyKey).
- Response schemas: `reportDefinitionResponseSchema`, `reportDefinitionListResponseSchema`, `reportRunDetailResponseSchema`, `reportRunListResponseSchema`, `reportRecipientsResponseSchema`, `reportEmailPreferenceSchema`, `reportManifestResponseSchema`, `reportDownloadGrantResponseSchema`.
- SQL API RPCs take p_organization_id and p_actor_user_id first: `m14_04_create_definition(p_input)`, `m14_04_update_definition(p_definition_id,p_input)`, `m14_04_get_definition(p_definition_id)`, `m14_04_list_definitions(p_query)`, `m14_04_mutate_definition(p_definition_id,p_operation,p_input)`, `m14_04_preview(p_definition_id,p_input)`, `m14_04_get_run(p_run_id)`, `m14_04_list_runs(p_query)`, `m14_04_replay(p_run_id,p_input)`, `m14_04_recipients()`, `m14_04_manifest(p_run_id,p_recipient_id)`, `m14_04_grant(p_session_id,p_run_id,p_recipient_id,p_artifact_id,p_token_digest)`, `m14_04_redeem(p_session_id,p_run_id,p_recipient_id,p_grant_id,p_token_digest)`, `m14_04_get_email_preference()`, `m14_04_set_email_preference(p_input)`. RPC success returns the complete response envelope above; errors use SQLSTATE 42501/40001/22023/57014.
- Worker RPCs: `m14_04_schedule_due(p_worker_id,p_limit)` → bounded count; `m14_04_claim_recipient(p_worker_id)` → null or `{organizationId,recipientId,runId,definitionId,definitionVersion,ownerUserId,userId,config,scheduledFor,workerId,version,exportJobId}`; `m14_04_admit_export(p_organization_id,p_recipient_id,p_worker_id,p_expected_version,p_context)` → export private job; `m14_04_claim_export(p_worker_id)` → M14-03 private export job/null; `m14_04_publish_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version,p_manifest)` → outcome; `m14_04_fail_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version,p_code)` → outcome. Extra authorization/status RPCs may be added inward without changing public shapes.
- One provenance manifest is stored on each report_run_recipient and returned by its dedicated manifest route. It contains scheduled schema version, definition/version/config digest, occurrence/run/recipient, export manifest, as-of and permission scope. Existing exportManifestSchema stays unchanged.
