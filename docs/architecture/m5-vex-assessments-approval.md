# M5 VEX assessments and approval

## Scope and preserved contracts

- **User outcome:** authorized tenant users can submit an OpenVEX-aligned
  applicability assessment for an active finding, inspect its immutable
  revision history, and—when the policy requires it—obtain an authorized
  approval or rejection.
- **In scope:** tenant-wide assessment reads and submissions, revisions,
  evidence links, approval policy by finding severity, approval/rejection,
  history, and an assessment projection in M5 finding detail and queue.
- **Out of scope:** bulk propagation, suppression, VEX publication/export,
  regulatory report approval, assignment, automated approval, a replacement
  role system, and M4 matcher changes.
- **Preserved:** `/api/v1`; M4's document-scoped
  `POST /sbom-documents/:documentId/vulnerability-findings/:findingId/human-verdict`
  contract and its `affected`/`not_affected` human-verdict semantics; M4
  re-evaluation behavior; M5 saved views and their legacy
  `assessmentStates` filter; cookies, ES256/JWKS verification, refresh path,
  session revocation, permission merge order, mock passthrough, menu
  contracts, and the Evidence Control Room UI language.

## Concrete problem

The existing M4 human verdict is a mutable, document-scoped matcher review.
Its atomic function,
`record_vulnerability_finding_human_verdict_atomic`, updates
`vulnerability_findings.human_*` and records an audit entry. It has only two
verdicts, a rationale, and no approval-policy snapshot, VEX justification,
versioned revisions, or tenant-wide approval workflow. Reusing it would either
overwrite the source needed by re-evaluation or fabricate a VEX justification
that was never supplied.

M5 instead needs an independent tenant-wide record. A finding may be revised
after its assessment is submitted, while historical content must remain
inspectable, an outdated approval must not carry to the revision, and a policy
change must not retroactively approve pending work. Security-relevant state
and the audit record must either commit together or fail together; the general
`AuditService.log` is asynchronous and cannot establish that invariant.

The current M5 queue function also has an observed wire-key mismatch: the
contract sends `reEvaluationStates`, while the SQL filter reads
`reevaluationStates`. M5-02 repairs it forward and characterizes it before
changing the projection.

## Why not simpler?

The direct solution is one focused assessment table queried by finding, with
one current revision per active finding and explicit SQL functions for submit,
approve, reject, and policy update. It is sufficient because this milestone
has one durable assessment workflow and one persistence boundary.

Updating M4's `human_*` columns cannot preserve old revisions or distinguish
legacy matcher judgment from VEX. A browser-managed approval state cannot
withstand concurrent edits or demonstrate durable audit evidence. Separate
write and audit calls can partially succeed. A generic workflow engine,
command/event bus, or reusable approval framework would add hidden state and
cross-feature coupling without a second demonstrated workflow.

## Selected patterns

- **Direct composition with an adapter — an external persistence boundary is
  present.** React uses a focused findings gateway; Nest delegates to an
  assessment use-case facade and inward-owned port; the Supabase adapter calls
  assessment RPCs. Dependency direction is React presentation -> gateway /
  transport -> controller -> application use case and port -> Supabase adapter
  -> PostgreSQL. The adapter parses trusted RPC JSON with the shared contract
  before returning. Remove the adapter only if Supabase ceases to be the
  persistence boundary.
- **Immutable revision ledger — submitted facts must not be overwritten.**
  `vulnerability_finding_assessments` stores content, actor, timestamps,
  supersession, policy snapshot, workflow result, and version. A partial
  current-row invariant ensures one current revision for each
  `(organization_id, finding_id)`. A revision inserts a new current row and
  clears the predecessor's current marker in the same transaction; it starts a
  fresh approval decision. The only permitted mutation to an existing current
  revision is an approval/rejection workflow transition protected by its
  version. Remove this ledger only if the BRD stops requiring history and
  revisions.
- **Transactional command records — a duplicate or partial write is a real
  risk.** Submit, approve, reject, and policy-update inputs carry UUID
  idempotency keys; their RPC locks the current row, compares a normalized
  payload digest, returns the original result for an exact retry, and returns a
  conflict for a reused key with different content. The same transaction
  inserts the audit fact. This is local SQL coordination, not a command bus.
- **Policy snapshot — future configuration must not decide past work.** An
  organization/severity policy override resolves against the built-in
  Critical/High-required default when absent. Submission snapshots severity,
  effective policy version, and whether approval is required. Pending rows are
  never reclassified by a later policy update. Remove the snapshot only if
  approval policy ceases to vary over time.
- **Feature-local code-split presentation — detailed history and edit controls
  are a bounded heavy screen.** The existing M5 detail panel composes a lazy
  assessment card and modal forms. Existing query hooks/gateway are the test
  seam; virtualized queue focus behavior stays feature-local. No generic grid
  or workflow UI framework is introduced.

## Rejected patterns

- A new base role or replacement RBAC model would violate the existing
  additive custom-role merge contract. The feature adds only permission keys.
- A database reimplementation of custom-role resolution is rejected: the Nest
  permission resolver remains the authority for application permissions; RPCs
  independently verify active membership and tenant scope.
- A mutable current-assessment-only record cannot retain approved/rejected
  history or invalidate an old decision after a revision.
- A separate audit worker, fire-and-forget event, or browser retry cannot make
  the audit/state pair durable.
- Reusing M4 document endpoints would make a tenant-wide VEX assessment depend
  on a selected document and break M4 compatibility.
- Offset pagination, generic filter DSLs, global event state, and product ACLs
  are not introduced. The M5 queue remains keyset-based and organization-wide.

## Data and tenant boundaries

- **Verified identity:** `@CurrentUser()` supplies the authenticated user and
  organization selected by the existing organization/session machinery.
  Controllers derive `organizationId` from that trusted request, never from a
  request body, query string, or browser state.
- **Assessment record:** a row exists only for a submitted OpenVEX-aligned
  status: `under_investigation`, `affected`, `not_affected`, or `fixed`.
  Absence means `not_assessed`. `not_affected` requires exactly one of
  `component_not_present`, `vulnerable_code_not_present`,
  `vulnerable_code_not_in_execute_path`,
  `vulnerable_code_cannot_be_controlled_by_adversary`, or
  `inline_mitigations_already_exist`; other statuses do not accept a
  justification. Detail and optional evidence are bounded and schema
  validated.
- **Evidence:** an evidence row is either a tenant-owned internal evidence
  identifier or a validated HTTPS URL, never both. The submit RPC validates an
  internal reference is active and belongs to the same organization; it never
  fetches external URLs. The UI renders external URLs with `noopener` and
  `noreferrer`. Missing evidence is explicit, not a failed or false result.
- **Every service-role operation:** all assessment read/mutation and
  policy-list/mutation port calls accept `organizationId` first and actor ID
  second. Their RPCs filter the active finding, assessment, assessment
  evidence, policy, membership, and audit result by `organization_id`; related
  M5 findings remain same-organization and active. Cross-tenant, revoked,
  archived, or deleted references return the same safe unavailable/not-found
  result and never widen a query.
- **Permissions and authentication:** reads require `can_view_findings`;
  submit/revise requires `can_edit_findings`; approve/reject requires additive
  `can_approve_findings` and an AAL2 session; policy configuration requires
  additive `can_manage_finding_approval_policy`. Owner/admin defaults receive
  these grants; member/viewer do not; custom roles add grants through the
  existing resolver. The approval AAL2 check is action-level and does not
  change cookie paths, global refresh behavior, or JWT validation.
- **Transaction boundary:** each write RPC verifies active membership and
  tenant ownership, acquires an advisory/row lock for the finding/current
  revision, validates transition and expected version, applies the assessment
  or policy change, inserts durable audit evidence, and returns its parsed
  result in one PostgreSQL transaction. Any constraint, audit, or validation
  error rolls back the state change.
- **Concurrency and idempotency:** every write has an expected version and
  UUID key. A stale version produces an actionable conflict with the latest
  representation; an exact duplicate returns the original outcome; a reused
  key with a different normalized payload conflicts. Approval/rejection cannot
  act on a superseded, non-current, already decided, or policy-not-required
  assessment. A revision requires a change reason; rejection requires a
  decision reason.
- **Migration and deployment:** the migration is additive: tables, constraints,
  indexes proved by plans, RLS (enabled, non-forced), tenant policies,
  security-definer functions with `search_path = public, pg_temp`, and explicit
  revoke/grant (service role only). Foreign keys use `public.users.id`.
  Generate database types only through the Supabase CLI after the migration.
  Also replace the queue SQL's `reevaluationStates` lookup with the contractual
  `reEvaluationStates` key.

## API boundary contracts

- **Feature contract:** `@repo/contracts/vulnerabilities` receives a focused
  `vulnerability-assessment` schema/type feature for finding params, status /
  justification validation, evidence input, current/history response, policy
  response, submit/revise, approve, reject, and policy-update inputs. Triage
  queue schemas extend additively with `vexStatuses` and `approvalStates` and
  preserve `assessmentStates`.
- **Routes:** the M5 controller exposes `GET` and `POST
/findings/:findingId/assessment`, `POST
/findings/:findingId/assessment/:assessmentId/approve`, `POST
/findings/:findingId/assessment/:assessmentId/reject`, `GET
/findings/assessment-approval-policy`, and `PUT
/findings/assessment-approval-policy/:severity`. Static policy routes are
  registered before the `:findingId` routes.
- **Parsing:** Nest uses the existing Zod path/body/query pipes and
  `@ZodResponse`; use cases and adapters receive `z.output` types, and adapters
  parse successful RPC JSON before use. The browser's central authenticated
  transport validates outgoing bodies with `inputSchema` and successful bodies
  with the response schema. Unknown/invalid fields fail at the nearest
  boundary. Read refresh behavior remains GET-only; non-GET commands are never
  silently replayed.
- **Errors:** invalid input is a stable validation response; tenant-hidden IDs
  map to the same safe not-found behavior; stale versions and idempotency
  payload mismatches map to `409`; permission/AAL failures are forbidden;
  provider failures are safe unavailable errors. React preserves entered form
  state on validation, offline, and recoverable conflicts, with an explicit
  reload/retry action.

## Frontend logic and rendering

- **Functional components:** the existing code-split findings detail panel
  renders current VEX state, policy snapshot, evidence, legacy M4 matcher
  evidence, and immutable history. Feature-local forms cover submit, revision,
  approve, reject, and permission-gated policy editing; no page calls
  Supabase directly.
- **Focused gateway/lifecycle:** a plain TypeScript assessment gateway owns the
  authenticated HTTP transport and contract parsing. Existing React query
  hooks own fetch/cancellation/cache invalidation. Assessment changes invalidate
  the affected finding detail and queue projection only.
- **Pure policies:** status/justification availability, approval presentation,
  evidence rendering eligibility, and conflict messages are immutable functions
  with unit tests. They do not infer authorization from hidden UI controls.
- **Accessibility:** shared `Modal`, `Select`, `Button`, `cn()`, semantic
  tokens, focus-return behavior, visible focus, labels, and non-colour status
  text are reused. Existing virtualized rows retain active-row focus. The UI
  distinguishes validation, offline, forbidden, conflict, pending, rejected,
  approval-not-required, no-evidence, loading, and retry states while honoring
  reduced motion.

## Failure modes

| Failure                                                 | Behavior                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Invalid VEX status/justification or unsafe evidence URL | Zod and SQL constraints reject it; no write or audit is created.                                                  |
| Missing, archived, cross-tenant, or revoked reference   | Fail closed as a safe unavailable/not-found result; no existence disclosure.                                      |
| Duplicate command                                       | Exact idempotent retry returns the original result; different payload returns `409`.                              |
| Stale submit/revision/approval/rejection                | Lock/version check returns `409` with reload guidance; no automatic mutation retry.                               |
| Conflicting concurrent revise/approve                   | Only the lock winner can transition; the loser observes a conflict or no-longer-current assessment.               |
| Policy changes during pending approval                  | Existing assessment keeps the submission snapshot; only later submissions resolve the new policy.                 |
| Audit insert/transaction/provider failure               | Transaction rolls back assessment/policy state; API returns a safe unavailable error and logs non-secret context. |
| Browser network/cancellation/offline                    | Form values remain local; only GET refreshes after authentication refresh; user explicitly retries commands.      |
| AAL1 or revoked approval actor                          | Controller denies approval/rejection before the RPC; RPC membership verification remains defense in depth.        |
| M4 matcher re-evaluation                                | It never updates VEX rows; legacy human verdict and re-evaluation projection remain independently visible.        |

## Tests and observability

1. Characterize the M5 `reEvaluationStates` filter failure and M4 human-verdict
   route/response behavior before implementation.
2. Add contract and pure-policy tests for status/justification combinations,
   evidence validation, parsed input/output boundaries, policy defaults and
   snapshots, idempotency, optimistic conflicts, and permission defaults.
3. Add API tests for all route/path/body schemas, static route order,
   `can_view_findings`/edit/approve/policy permissions, AAL2 approval,
   `409` mapping, safe not-found responses, and M4 compatibility.
4. Add live Supabase tests for active membership and RLS/grants, same-/cross-
   tenant references, revoked access, archived evidence, duplicate and
   concurrent commands, transaction failure injection/audit rollback,
   re-evaluation preservation, and policy updates that leave pending records
   pending. Use `EXPLAIN (ANALYZE, BUFFERS)` to justify queue/approval indexes.
5. Add web tests for gateway parsing, form and status states, history,
   permission-gated configuration, conflict reload, evidence-empty state,
   modal focus return, and detail/queue invalidation. Run the local Playwright
   journey using run-scoped fixture records only, with a seeded owner for
   access and a test-owned MFA-enabled PSM role for approval; clean up only
   those fixtures and retain screenshots.
6. Run focused tests, generated type checks, database lint/diff, architecture
   checks, `pnpm verify`, applicable live tests, browser accessibility checks,
   and a read-only local Supabase metadata/advisor comparison. Record latency
   and failure logs with operation/organization-scoped identifiers only—never
   values, URLs with credentials, tokens, or other sensitive payloads.

## Rollback

Deploy in expand order: additive migration and CLI-generated types, API, then
web. The previous API can operate safely while the new schema is present, and
M4 remains untouched. If release health fails, roll back web first and then the
new API routes; retain assessment, evidence, idempotency, policy, and audit
records for investigation. Do not write a destructive down migration. A later,
separately approved contract migration may remove unused objects only after all
callers are gone.

## Review checklist

- [x] Direct focused composition was selected before a generic workflow.
- [x] Every selected pattern has a present-tense trigger and a test target.
- [x] Identity, organization, and session state are never accepted from the
      browser as authorization input.
- [x] Controllers/pages contain no Supabase query or workflow decision.
- [x] Application code depends inward on a port; the adapter owns RPC details.
- [x] Inputs and successful external responses are schema validated with
      feature-first `z.output` types.
- [x] Assessment/audit writes are transactionally durable.
- [x] M4, M5 saved-view, queue, authentication, and navigation compatibility
      gates are explicit.
- [x] Focused new/materially changed modules require at least 80% coverage and
      local live-stack/browser verification.
