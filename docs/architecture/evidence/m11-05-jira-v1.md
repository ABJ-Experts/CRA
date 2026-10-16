# M11-05 Jira Cloud V1 release evidence

## Scope and ownership

Jira Cloud remediation tickets are V1. ServiceNow incident/change remains V2 and is not enabled. A CRA actor previews minimal finding context and explicitly creates the first Jira issue. Later approved context updates are queued. Jira closure is a ticket-work signal and never changes M5 remediation availability, VEX approval, or regulatory obligations.

The baseline is `milestone-1` at `8b27465a20ce6218ca86a44c79c306e09019f29a`. The existing uncommitted draft was preserved and corrected: its caller-asserted event route and fictional issue-ID RPCs were removed. The Jira Cloud sandbox release gate remains open because no sandbox credentials were configured.

## BRD to implementation and tests

The mapping follows `CRA-Sentinel-Technical-BRD-v2.0-ABJ-Experts.pdf` p35, the p51 ticketing matrix, p55 screens, and the pp67-68 roadmap.

| BRD / criterion | Contract and implementation | Evidence |
| --- | --- | --- |
| FR-INT-004 ticket create/update | `vulnerability-remediation-ticket.schema.ts`; `VulnerabilityTriageUseCases.syncRemediationTicket`; `JiraRemediationAdapter`; owner preview and explicit create in `finding-remediation.tsx` | Contract specs, use-case specs, adapter simulator, M11-05 SQL test, findings UI specs |
| FR-INT-005 status intake | `JiraRemediationWebhookController` verifies the raw-body HMAC and delivery ID, refetches stable issue identity/property, then calls `record_verified_vulnerability_ticket_event_atomic` | Controller specs, adapter signature fixtures, SQL duplicate/stale/echo/move tests |
| FR-INT-006 scope and diagnostics | Owner binding fixes CRA product, connector, Jira cloud/project/issue type, custom fields and status transitions; operations retain correlation, attempt and conflict state | Binding dry-run specs, SQL tenant/RLS/transaction tests, owner/viewer browser checks |
| No feedback loop or domain closure | Correlation and revision suppress echoes; external closed maps to `external_closed_pending_review` only | M11-05 SQL closure, echo and out-of-order tests |
| Timeout, duplicate and concurrent action | Reserve before create; issue property carries correlation; a durable pre-POST marker distinguishes confirmed no-create rejection from uncertainty; uncertain create can only reconcile | Use-case/worker tests, adapter local simulator, SQL idempotency, retry and worker-claim tests |
| Provider outage and rate limit | Worker revalidates scope, retries bounded transient errors with `Retry-After`, marks permanent failure `sync_error` | Worker specs and M11-05 SQL operation tests |

## API, schema and storage

- Schemas and parsed types: `packages/contracts/src/vulnerabilities/schemas/vulnerability-remediation-ticket.schema.ts` and `packages/contracts/src/vulnerabilities/types/vulnerability-remediation-ticket.type.ts`.
- Authenticated API: `GET /api/v1/findings/:findingId/remediation-tickets`; `POST /api/v1/findings/remediation-ticket-bindings/dry-run`; `POST /api/v1/findings/remediation-ticket-bindings`; `POST /api/v1/findings/:findingId/remediation-tickets/preview|sync`; ticket `replay|transition` routes.
- Narrow public ingress: `POST /api/v1/jira/remediation-webhooks/:bindingId`. The path is a hint; HMAC, credential cloud ID, refetched issue and issue property establish identity.
- Local migrations `20260930153000` through `20260930154200` add/repair five M11-05 tables and scoped RPCs, align tenant export locks and redaction, fence active creates, and durably record an authoritative missing Jira issue. `20261001054112` adds safe create retry and delayed worker handoff. `20261001055853` returns the persisted operation timestamp and worker context in the parsed API shape. Both generated database type copies were regenerated through `pnpm --filter infrastructure run db:types`.
- `pnpm --filter api run worker:vulnerability-remediation-tickets -- --once` performs one bounded, tenant-fair operation cycle after an API build. Production scheduling must run the same entrypoint continuously.

## Configuration and operation

1. Configure the existing connector vault keyring and create a Jira connector with `providerHost=api.atlassian.com`, an Atlassian `cloudId`, and the approved `siteHost` (`*.atlassian.net`). Store a scoped service-account API token and an independent random webhook secret in the encrypted connector secret. Do not put either in browser state.
2. Grant the service account the granular scopes shown by the Jira catalogue and Browse/Create/Edit/Transition issue permissions only in bound Jira projects. Use the scoped-token gateway `https://api.atlassian.com/ex/jira/{cloudId}/...` ([Atlassian service-account tokens](https://support.atlassian.com/user-management/docs/manage-api-tokens-for-service-accounts/)).
3. Configure a Jira admin webhook secret, the exact CRA webhook URL with binding ID, and issue events. Jira signs `X-Hub-Signature` and sends a stable `X-Atlassian-Webhook-Identifier` across retries ([Atlassian webhook documentation](https://developer.atlassian.com/cloud/jira/platform/webhooks/)). Keep Jira API v3 project, issue, property and transition permissions scoped to the selected project ([Jira issue REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)).
4. An organization owner chooses the authorized connection, stable project ID/key, issue type, status mappings and allowed custom fields; dry-runs, then saves. A finding editor previews exact content and explicitly creates the first issue. Run the operation worker. Review `sync_error`, `conflict` and `deleted_or_moved` states before replay.
5. Never retry an uncertain create with a new idempotency key. Reconcile using the issue property and stable issue ID; an unresolved result requires owner review. A confirmed Jira 400/401/403/404/422 create rejection or a worker-confirmed interruption before POST can be retried with a new owner action after scope/field correction. Do not treat an external close as a CRA remediation or VEX decision.

## Local verification and release gates

Local CRA PostgreSQL has the M11-05 ledger versions through `20261001055853`; all five tables have RLS enabled without FORCE. Scoped RPCs use `SECURITY DEFINER`, pinned `search_path`, and explicit service-role grants. The M11-05 SQL suite, full infrastructure suite, and `db:lint` passed with no retained M11-05 fixture rows. Final `pnpm verify` passed lint, type checks, architecture gates, tests, and build; API ran 347 suites and 3,664 tests, and web ran 169 files. The export migration preserves M11-02 replay-snapshot and M11-03 webhook redaction rules. Supabase MCP exposed only unrelated ERP cloud projects, so no cloud project was queried or changed. There is no MongoDB MCP for this repository.

Focused Jira API coverage is 93.04% adapter lines, 82.4% of the changed Jira use-case region, and 80.9% of the changed Jira repository region; the new worker is 96.05% lines. A full API coverage run passed all 347 suites and 3,664 tests but exited nonzero against the configured global 80% gate: global lines 75.79% and branches 67.85%. The two large shared M5 files score 78.18% and 70.31% as whole files because legacy paths are outside the Jira suites. These percentages are not presented as whole-module 80% coverage; raising legacy/global coverage is a remaining release gate.

The Jira adapter test harness is a **local simulator**, not a live Jira sandbox. It covers issue creation with correlation, refetch, duplicate reconciliation, field update, transition, project move, revoked scope, timeout, and rate limit. Browser checks used the local CRA dev server on port 3002 (port 3000 belonged to an unrelated site): seeded owner sees the binding form, seeded viewer does not, viewer binding POST returns 403, forged webhook POST returns 401. A final Playwright MCP smoke after the safe-retry changes signed in as the seeded owner, opened the M9 local finding, and confirmed the empty Jira binding state and owner setup form. Generated screenshots were removed after verification. The live auth-session and access-control Playwright regressions passed (2/2) after temporarily setting only the CRA API web origin to port 3002. The general Playwright config currently discovers an M11-03 spec that imports other spec files and errors before selection, so the two checks used a temporary narrow config, then it was removed. A 50-request, five-concurrent local development sample of the ticket read endpoint returned 200 throughout, p95 155 ms and p99 165 ms; this is not a production load result.

Before release, use a dedicated Jira Cloud sandbox to verify: scoped service-account permissions; create metadata and custom fields; first create and issue property; real signed webhook and retry identifier; human status edit, move/delete, token revocation, 429, timeout and restart reconciliation; owner/viewer UI and accessibility. Record the sandbox cloud ID, test issue IDs and redacted response metadata without customer content.

## Migration and rollback

The local preexisting draft had three zero-row tables and four unsafe functions without a ledger entry. Object equivalence and zero-row state were checked before the forward repair. The local CRA ledger also has unrelated historical drift around missing migration `20260929104413`; the M11-05 SQL was applied to the identified local CRA database in scoped transactions without reset. Do not apply to an unrelated cloud project.

Apply migrations in version order before enabling API routes or workers. Rollback stops the Jira webhook/API routes and operation worker while retaining linked-ticket, operation, event and audit rows for reconciliation. Do not delete Jira issues or CRA data as a rollback shortcut.

## Residual risks

- Live Jira Cloud sandbox verification is outstanding; local simulator results do not establish production compatibility.
- External Jira operations cannot be exactly once across independent systems. The correlation property, durable pre-POST marker, reservation fence and reconciliation reduce duplicates. A crash after the marker but before POST remains conservatively blocked for owner review.
- Jira correlation lookup uses a two-day date cushion because JQL dates use the service account's timezone. It refuses to infer absence when the bounded 50-issue result is incomplete. Busy projects may need operator reconciliation rather than automatic retry.
- Real provider latency and production p95/p99 remain unmeasured; the browser sample only covers local development.
- ServiceNow and historical backfill are V2 work and are not represented as shipped here.
