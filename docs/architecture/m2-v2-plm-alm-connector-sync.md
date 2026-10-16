# M2 V2 PLM/ALM connector synchronization

## Scope and preserved contracts

- **User outcome:** an authorized organization can configure the shipped
  reference-conformance connector, test it without exposing a credential,
  preview field ownership, run a durable dry run, review conflicts, and commit
  an idempotent product/release synchronization while manual registry use
  remains available during provider trouble.
- **In scope:** the vendor-neutral connector boundary, encrypted secret
  references, product/release identity mappings, per-field authority history,
  dry-run plans, conflict records, durable runs/cursors/retries, safe
  diagnostics, connector observability, and the reference-conformance adapter.
  The completion increment adds `parentExternalId` as a policy-controlled,
  embedded product-component relationship input.
- **Out of scope:** turnkey Teamcenter, Windchill, Jira, Azure DevOps, or
  another vendor package; a general ETL service; an automatic AI conflict
  resolver; customer-network database access; SBOM ingestion; physical
  deletion of retained CRA product history; and a production-deployable
  on-premises agent. ADR-0002 records the future agent trust contract and the
  local verifier proof, not an agent release.
- **Preserved:** `/api/v1` routing and cookie paths; global deny-by-default
  authorization; existing product/release contracts and M2 relationship
  invariants; product-registry manual maintenance; permission merge order;
  MSW ordering; generated database types; semantic-token UI; and the eight
  frozen auth action signatures. A connector outage never changes an existing
  product/release or blocks a registry read.

## Concrete problem

The current M2 product registry owns tenant-scoped product, release, lifecycle,
retention, and relationship facts. A PLM/ALM source can provide the same
identity and descriptive fields but has a different availability, cursor, and
authority model. Directly putting provider code in a controller or allowing an
adapter to write `products` would couple the domain to a vendor, make a network
failure block normal product use, and permit an external value to silently
replace a CRA compliance value.

The feature already has a bounded baseline in `apps/api/src/connectors/` and
the additive connector migration. `ConnectorPort` is the only adapter seam;
the reference adapter supplies deterministic records. The database holds the
eight connector tables: `connectors`, `connector_secrets`,
`product_external_identities`, `field_authority_policies`, `sync_runs`,
`sync_run_plan_items`, `sync_conflicts`, and `sync_connector_cursors`.
Current work must complete the missing route/contract alignment, real
connection-test execution, organization-scoped worker claims, structured plan
diff persistence, and `parentExternalId` hierarchy application before calling
the feature complete.

## Why not simpler?

The direct implementation is an import controller that receives vendor JSON,
matches `internalCode`, and updates a product row. It cannot preserve vendor
payload isolation, make an ambiguous identifier safe, explain a field's system
of record, survive a page retry, atomically advance a cursor, or retain the
values and actor behind a review decision. A background job that owns its
cursor only in memory similarly duplicates changes after restart and can let a
large tenant starve other tenants.

The smallest durable design is the existing connector state model plus an
inward-owned port, a persisted dry-run plan replayed by commit, and the M2
embedded relationship operations for hierarchy. No generic workflow, ETL,
graph, external event, queue, or separate relationship projection is added.

## Selected patterns

- **Inward-owned adapter port.** `ConnectorPort` owns connection testing,
  capabilities, pull, and approved push in canonical types. A connector
  adapter may translate a vendor payload only before it returns
  `ExternalRecord`; the connector worker, product domain, contracts, and SQL
  never import a vendor SDK or vendor shape. The current concrete
  implementation is `ReferenceConformanceAdapter`; an adapter package is added
  only with a second, actual provider and its conformance fixture.
- **Versioned authority record plus pure policy.**
  `field_authority_policies` has an active row and supersession chain for each
  `(organization, connector, entity type, field)`. The immutable
  `decideFieldAction` function uses one of `external_authoritative`,
  `cra_authoritative`, `newest_with_review`, or `manual_only`. A missing row is
  `manual_only`, so no field is silently external-authoritative. Protected
  fields can never use `external_authoritative` and require a reason.
- **Read-only authority impact preview.** `POST .../mapping/preview` computes
  a bounded 50-record sample and SHA-256 digest from the proposed policy,
  mapping version, and sampled canonical values. The save request carries that
  digest; the API recomputes it from current scoped state and rejects a changed
  preview. Saving a policy creates/supersedes an auditable policy row, but does
  not mutate a product. A dry run remains mandatory before the first commit
  after a materially changed mapping or authority policy.
- **Scoped external identity mapping.** An active mapping key is
  `(organization_id, connector_id, entity_type, external_id_normalized)`.
  Normalize with NFKC, whitespace removal, and lowercase—the same rule used by
  product/release normalized keys. A first-seen record can match exactly one
  unclaimed normalized product code or release version under its resolved
  product; zero matches creates a canonical record, and one-or-more ambiguous
  candidates requires a manual link/merge. Unlink/merge supersedes historical
  rows instead of rewriting provenance.
- **Persisted plan then replay.** The worker builds canonical `PlanItem` and
  conflict data without product mutation, persists a structured field-diff
  object, hashes the fetched content, and places the run in
  `waiting_for_review` or ready-to-commit state. Commit uses that exact plan,
  adapter version, mapping version, policy snapshot/digest, fetch hash, cursor,
  and an idempotency key; it does not calculate a new diff behind a reviewer’s
  back.
- **One atomic cursor ownership boundary.** `commit_sync_run_atomic` owns
  product/release changes, plan application markers, audit facts, run status,
  and cursor advance in one organization-scoped transaction. The cursor moves
  only after all corresponding batch effects are durable. The unique active-run
  index gives one non-terminal run per connector; content hashes, plan item
  application markers, and optimistic entity versions make duplicate page,
  retry, and worker restart replays non-regressing. A full reconciliation uses
  the same conflict/plan gate and never silently replaces an open reviewed
  conflict.
- **Tenant-fair durable worker.** `sync_runs` is both queue and run record.
  It stores actor/system identity, correlation and idempotency identifiers,
  versions, cursor state, counts, retry/lease state, and terminal result.
  `list_due_sync_run_organizations` supplies due tenants; the claim RPC takes
  the selected organization as its first scoping argument. One bounded claim
  per due organization per round prevents a single backlog from using all
  workers. The retry state records rate limit/provider failure, uses bounded
  exponential backoff, opens the connector circuit after repeated failure, and
  leaves current registry data readable. A canceled/disabled connector is
  checked before each durable batch; an in-flight batch can finish only through
  the normal atomic outcome and cannot schedule subsequent work.
- **Existing M2 embedded graph.** `parentExternalId` is an explicit product
  authority field and means an external parent product contains the external
  child product. It maps to the existing `embedded` parent-to-component edge;
  it does not introduce a connector-specific relation or change release,
  variant, quantity, or baseline semantics. A plan resolves child and parent
  through active mappings scoped to the same connector and organization. A
  missing/ambiguous parent, cycle, stale graph version, unsupported hierarchy,
  or protected/manual policy is a non-mutating plan issue or conflict. An
  approved external resolution calls existing M2 relationship preview/create/
  end use cases and tags the edge provenance with connector/run identity.
  Only an edge with that bounded provenance can later be superseded by this
  connector; manually owned edges are never changed. Absence of a source
  record never ends a relation. Confirmed tombstones are retention-aware
  archive requests only, never physical deletion.

The dependency direction is functional React UI -> connector gateway ->
same-origin parsed HTTP transport -> `@repo/contracts/connectors` -> thin
`ConnectorsController` -> `ConnectorsService`/worker and pure policy ->
inward-owned connector/product relationship ports -> Supabase adapter/RPC.
Controllers, pages, and the connector domain do not call external providers or
Supabase directly.

The port and persisted-plan patterns may be removed only if all external
product structure is retired. The graph integration remains a direct caller of
existing M2 relationship use cases; it is removed with connector hierarchy
capability, not replaced with another relationship store.

## Rejected patterns

- Vendor switches or payload branches in React, controllers, or product
  services leak vendor behavior beyond an adapter and cannot be conformance
  tested independently.
- A mutable `external_id` column on `products`, an org-wide identifier key, or
  automatic many-candidate matching would lose mapping history and allow
  cross-tenant or cross-connector identity resolution.
- A default external authority policy, a timestamp-only last-write-wins rule,
  or a policy without version history allows silent compliance overwrite and
  cannot explain a prior decision.
- A process-local queue/cursor, global `FOR UPDATE SKIP LOCKED` claim without
  organization input, or an unbounded per-tenant drain violates restart safety
  and tenant fairness.
- A connector-specific product hierarchy table duplicates the authoritative M2
  graph and could bypass M2 cycle, graph-version, audit, retention, and
  finding-propagation effects.
- Treating a missing page, a permission-filtered source record, or an unknown
  tombstone as deletion has no reliable semantics and risks retained data.
- Signed diagnostic URLs, log payload dumps, or browser secret references turn
  operational support into a credential/data exfiltration path.
- A production agent installer, listener, or inbound customer-network access
  is speculative until a customer deployment design exists. The ADR defines
  its mandatory security boundary without claiming this feature ships it.

## Data and tenant boundaries

- The global guard supplies verified user and active organization identity;
  selected browser organization state is presentation only. Every connector
  repository/RPC method accepts organization ID first and applies it to
  connector, secret, mapping, policy, run, plan item, conflict, cursor,
  product, release, and relationship reads/writes. A foreign identifier gives
  `not_found`, never a display-name leak.
- The eight connector tables have RLS enabled, no `PUBLIC`, `anon`, or
  `authenticated` grants, and explicit `service_role` access. Every
  security-definer RPC pins `search_path = public, pg_temp`; the additive
  follow-up migration revokes `EXECUTE` on
  `enforce_sync_run_status_transition` from browser/public roles and grants it
  only to `service_role`.
- Connector configuration rejects secret/token/password-shaped keys. Secret
  value storage encrypts it under `CONNECTOR_SECRET_ENCRYPTION_KEY` and returns
  only `hasSecret`; only a worker resolves the secret just before adapter use.
  Secrets, raw provider payloads, diagnostics, run state, audit payloads, UI
  state, and logs never contain secret values.
- Mapping, policy, run, plan, conflict, cursor, product/release mutation,
  relationship mutation, and audit need the same transaction boundary where
  the database owns both sides. The plan/review phase is deliberately
  non-mutating; commit and its cursor advancement are durable together. Failed
  work records an error/retry state and leaves prior product data usable.
- Indexes cover active external identity lookup, current policy lookup,
  organization/connector run history, organization-scoped due-run claims,
  plan rows, conflicts, cursor rows, and audit actor joins. Batches are bounded
  to 200 records; worker cycles have a bounded total claim count and fair
  organization rotation. Larger providers require measurable quota/worker
  capacity changes, not a larger unbounded default.
- Migrations are additive: connector schema/RPC/grants/indexes first; generated
  types second; API/worker third; UI last. The previous API tolerates the added
  schema. Roll forward fixes incorrect authority or cursor behavior; no
  rollback deletes retained provenance, conflicts, mappings, product history,
  or existing M2 graph edges.

## API boundary contracts

- Runtime schemas and parsed `z.output` types live feature-first under
  `@repo/contracts/connectors`. They own all connector path/query/body inputs,
  response envelopes, policy previews, identities, runs/plan items, conflicts,
  metrics, retry acknowledgements, and diagnostics metadata. Controller,
  gateway, and UI do not restate their wire shapes.
- Every controller path/query/body uses `zodParams`, `zodQuery`, or `zodBody`.
  Every JSON success response uses `@ZodResponse`; the diagnostic export uses
  an explicit non-JSON response contract for a redacted Blob download rather
  than a fictional signed URL shape. The web `ApiClient` parses outgoing input
  with `inputSchema` and successful returns with `schema`.
- `POST /connectors/:connectorId/test` resolves the connector server-side,
  resolves a secret only within the test/service boundary, invokes
  `ConnectorPort.testConnection`, then durably records only success/failure,
  latency, and a stable error code. The returned connector is secret-free.
- `POST /connectors/:connectorId/mapping/preview` is read-only and owner plus
  connector-edit permission protected. `POST .../mapping` requires the current
  preview digest and creates/supersedes the policy. Read/listing requires
  `can_view_connectors`; connection/create/run uses
  `can_create_connectors`; configuration, identity actions, cancellation, and
  retry use `can_edit_connectors`; secret and authority changes additionally
  require owner. Existing permission names remain server enforced.
- Sync routes offer dry-run start/list/detail/plan inspection, conflict list
  and resolution, commit request, cancel, retry, and redacted diagnostics.
  Conflict resolution checks open status, expected version/external hash,
  permitted action, actor, nonblank reason, and a policy-valid manual value;
  it records before/after/provenance atomically. A commit returns stable
  `dry_run_expired`, `stale_preview`, `blocked_by_conflicts`, or `not_found`
  outcomes rather than replacing data.
- Unknown keys are rejected at wire boundaries. Existing Zod transforms/defaults
  are retained only for shared pagination. API provider errors map to stable
  connector outcomes; outage remains distinct from invalid request and never
  becomes an authentication, permission, or product-not-found response.

## Frontend logic and rendering

- Functional workspace connector pages compose focused connection,
  mapping/authority, identity, dry-run, conflict, and run-status components.
  They use existing semantic tokens, `cn()`, shared UI subpaths, accessible
  labels/alerts/focus movement, and fail-open navigation behavior while
  permission data is loading or unavailable. The connector sidebar entry is
  added through the shared menu contract and its parity test.
- `ConnectorsApi` is the plain gateway lifecycle boundary: it owns typed
  endpoint invocation, body/response schemas, Blob diagnostic download, and
  no-store cookie transport. Rendering components do not construct URLs,
  resolve secrets, call Supabase, or invoke a provider.
- UI state distinguishes disconnected, testing, unauthorized, mapping
  incomplete, preview available, dry-run, conflicts present, waiting for
  review, syncing, stale, rate limited, retrying, partial provider outage,
  failed, canceled, and completed. Product registry pages remain usable and
  clearly show last successful freshness when the connector fails.
- Diagnostics export contains IDs, status, counts, cursor age, adapter/mapping
  versions, normalized error codes, and redacted failure summaries only. It
  omits secret reference/value, token, header, authorization state, raw payload,
  confidential fields, and unnecessary product content.

## Failure modes

| Failure                                                                                              | Required behavior                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid or missing request/session/permission                                                        | Reject at Zod/guard boundary; foreign tenant identifiers return `not_found`.                                                                                                                                                                                                                         |
| Missing/invalid adapter, secret, or connection                                                       | Record a safe test failure/error code; never expose the secret; leave product data unchanged.                                                                                                                                                                                                        |
| Provider unavailable or rate limited                                                                 | Set retry/backoff/circuit state and surface stale freshness; manual product access stays available.                                                                                                                                                                                                  |
| Cursor expired, invalid, backward, duplicate, or out of order                                        | Do not advance cursor; fail/retry safely or require full reconciliation. Content hash, applied markers, and optimistic versions prevent duplicate/regressive apply.                                                                                                                                  |
| Repeated page/event or worker restart                                                                | Replaying the same planned batch is idempotent; durable commit and cursor update occur together.                                                                                                                                                                                                     |
| Mapping/policy/adapter change during run                                                             | Existing plan version/digest becomes stale; commit is rejected and a new dry run is required.                                                                                                                                                                                                        |
| Connector disabled/canceled while leased                                                             | Do not claim/schedule later work. An in-flight operation finishes only via its atomic outcome, with no silent later batch.                                                                                                                                                                           |
| Missing/unreliable tombstone or external absence                                                     | Record skipped/invalid state; never delete/end product, release, baseline, or edge from absence. Confirmed tombstone remains retention-aware archival only.                                                                                                                                          |
| Ambiguous external identity, unknown owner, missing parent, unsupported relation, or hierarchy cycle | Produce an issue/conflict and require review; never auto-merge or bypass M2 graph checks.                                                                                                                                                                                                            |
| Two reviewers resolve the same conflict                                                              | Optimistic conflict version and external-value hash permit one durable resolution; the later actor receives a stable conflict/stale result.                                                                                                                                                          |
| Product/release/relationship write, audit, or cursor persistence failure                             | Transaction rolls back every product and cursor effect; run has retry/failure state and retains the plan.                                                                                                                                                                                            |
| Large/hostile provider or agent payload                                                              | Bound page/frame size and canonical schema before planning. Agent ingress rejects content type, malformed JSON, replay, invalid signature, expired/revoked key, and oversized content before business logic. Compression is not accepted until a streaming decompression/ratio guard is implemented. |
| Agent loss after send before acknowledgement                                                         | Frames are replay-safe by nonce/content signature; receiving side uses normal sync idempotency keys/content hashes. A production shared nonce store is required before multi-instance agent ingress.                                                                                                 |
| Secret rotation/revocation                                                                           | New and old agent keys may overlap for the documented grace window; revocation is checked before every frame and cancels future work. Connector secret rotation creates a new encrypted row/reference and never writes a value to a run/audit/UI/log.                                                |

## Tests and observability

- Start with characterization tests for the currently exposed routes, wire
  schemas, permissions, response envelopes, connector worker row shape, and
  reference adapter test result. Add red tests before each correction.
- Contract and policy coverage includes every authority value; no-policy
  default; protected values; bounded preview digest; policy supersession;
  field diff structure; capability discovery; connection success/auth/malformed
  failure; normalization; cross-tenant identity; ambiguous product/release/
  parent resolution; link/unlink/merge audit; and redacted diagnostics.
- Unit/worker coverage includes organization-scoped claim fairness; duplicate
  pages/events; same-timestamp cursor siblings; restart/replay;
  rate-limit/provider/circuit retry; cursor expiry; disabled connector;
  cancellation; policy/mapping change; conflict state race; full versus
  incremental reconciliation; and a large-tenant bounded-claim fixture.
- SQL/live integration coverage includes RLS/grants/search paths; service-role
  only RPCs/trigger helper; org-first filters; FK/index requirements; atomic
  plan/commit/cursor behavior; retention-safe tombstone; conflict provenance;
  identity history; no browser secret access; and hierarchy preview/create/
  policy conflict/cycle/manual-edge preservation. SQL tests create unique
  run-scoped data and clean only that data.
- Browser E2E covers connection -> secret -> actual adapter test -> policy
  preview/save -> dry run -> hierarchy review -> commit -> freshness/cursor/
  count display; protected hierarchy conflict resolution; outage/retry with a
  usable registry; tenant 404/no-name leak; accessible unauthorized/loading/
  error states; safe diagnostic download; and desktop/mobile screenshots. It
  runs solely against local CRA services and run-scoped fixtures.
- Metrics/logs distinguish provider latency, sync lag/cursor age, throughput,
  per-action counts, conflicts, retries, circuit state, dead letters, tenant
  claim/queue use, connection-test outcome, and agent frame rejection category.
  Logs contain organization/connector/run/correlation identifiers and counts,
  never secrets, payloads, or sensitive product values. The existing
  `connector_compliance_metrics_snapshot` is the database snapshot source.
- Completion requires focused coverage at or above 80% for new/materially
  changed modules, connector SQL tests against the live local stack,
  `pnpm test:architecture`, `pnpm lint`, `pnpm check-types`, `pnpm test`,
  `pnpm build`, and complete applicable Playwright E2E. Non-mutating Supabase
  inspection verifies local migrations/schema/grants/indexes and run-scoped
  cleanup; it does not touch the unrelated hosted project.

## Rollback

Stop the connector worker and hide/new-command routes to halt new runs; core
registry/product APIs continue on the existing data. The schema, provenance,
dry-run plans, conflicts, and cursor history are additive and remain safe for
the prior API. Correct an adapter, authority, mapping, graph, cursor, or grant
fault with a forward migration/code change and a fresh dry run; never rewind a
cursor to force a blind apply, remove a conflict to unblock a commit, or delete
retained product/relationship history.

For provider recovery, re-enable the connector after credentials/mapping are
validated, perform a connection test and dry run, resolve the surfaced
conflicts, and commit the new bounded plan. For cursor loss/expiry, run full
reconciliation through the same review/commit gate. For agent incident,
disable/revoke the bound identity, record the incident without payloads,
rotate credentials, verify replay rejection, and reconnect only after a new
approved enrollment. Air-gapped customers use an approved offline canonical
bundle that is schema-validated, signed/replay-protected, and imported through
the same dry-run/commit path; no direct customer database connection is
introduced.

## Review checklist

- [x] The direct vendor import/controller path was rejected for concrete
      authority, provenance, replay, tenant, and availability failures.
- [x] Each selected pattern has a current trigger, dependency direction,
      contract/conformance seam, and removal trigger.
- [x] No request, user, organization, cursor, or worker ownership is global.
- [x] Controllers/pages do not call a provider, Supabase, or product graph
      implementation directly.
- [x] Vendor payloads stop at `ConnectorPort`; contracts contain canonical
      input/output only.
- [x] Inputs and successful responses are schema parsed; secrets/raw payloads
      are excluded from browser, logs, diagnostics, events, and run state.
- [x] Security-sensitive product/audit/cursor effects share a durable
      organization-scoped transaction.
- [x] Authority, identity, conflict, tombstone, hierarchy, cursor, retry,
      disablement, and agent replay paths have explicit test and recovery
      behavior.
- [x] Migration/deploy/rollback use additive expand/deploy/contract sequencing
      and preserve current product/session/permission contracts.
