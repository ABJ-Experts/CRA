# M4 CPE fallback and continuous advisory re-evaluation

## Scope and preserved contracts

- **User outcome:** Product-security users can see a clearly marked, deterministic CPE/NVD candidate when an SBOM component has no usable PURL, and can understand an advisory-driven finding transition without losing an analyst decision.
- **In scope:** CPE 2.3/URI parsing, NVD configuration-tree evaluation, lower-confidence evidence, targeted advisory re-evaluation, a minimal audited applicability hold, and finding transition history.
- **Out of scope:** parallel PURL/CPE matching, VEX or suppression workflows, reachability, analyst approval queues, and a withdrawal-management UI.
- **Preserved:** `/api/v1`, existing PURL/OSV response behavior, M4 feed and KEV behavior, auth cookie paths/JWKS verification, permission merge order, finding propagation, and the existing matching-results surface.

## Concrete problem and direct alternative

M4-02 deliberately returns no candidate without a canonical PURL, while NVD affected records can express product/version predicates as recursive CPE configuration trees. The present flat NVD range projection loses logical and platform semantics. A controller query over every tenant component after feed promotion would rescan unbounded data, cannot atomically preserve a human decision with an audit fact, and fails on restart. A durable, indexed discovery and tenant-job lifecycle is the smallest direct design that meets the present 50,000-component/retry requirement.

## Selected patterns

- **Pure matching strategies:** The existing PURL/OSV policy and new CPE/NVD policy are distinct current algorithms with one immutable evaluation draft result. PURL is selected exclusively when structurally valid; CPE is selected only if PURL is missing or invalid. Remove the CPE policy when NVD CPE source support is removed.
- **Composite evaluation:** NVD configuration nodes are recursive and leaves/nodes need one tri-state operation. The policy evaluates `AND`, `OR`, negation, `vulnerable=false`, version boundaries, and unresolved platform predicates without guessing. Remove it only if NVD supplies a non-recursive authoritative applicability API.
- **Durable fair job:** A material immutable-source fingerprint enqueues bounded global discovery, which emits tenant-first leased jobs. It exists because a promotion can affect many organizations, duplicate delivery/restarts are normal, and source promotion cannot synchronously fan out tenant writes. Remove it only if source changes are transactionally applied to every affected tenant by a bounded database primitive.
- **Finding/evidence/hold split:** A finding keeps automatic and proposed state; immutable evaluations/source versions retain evidence; the nullable human hold has a limited applicability verdict and rationale. This prevents upstream data from erasing an analyst decision. It can be simplified when human applicability records are superseded by a full VEX feature.

Dependency direction remains functional React evidence UI -> typed web gateway -> thin Nest controller -> application use cases and inward ports -> Supabase adapters/RPCs. The CPE policy is pure TypeScript; no controller, page, or UI queries Supabase directly.

## Rejected patterns

- A parallel CPE result/finding table is rejected because it duplicates the established finding identity, lifecycle, enriched projection, and audit surfaces.
- A browser timer or in-process event emitter is rejected because it cannot prove completion or recover after a worker restart.
- A global job per organization at promotion time is rejected because a large feed update can monopolize the queue; bounded global discovery preserves tenant fairness.
- A full VEX/suppression state machine is rejected because the requirement is a narrow, direct analyst applicability hold only.

## Data and tenant boundaries

- The authenticated `CurrentUser` supplies actor and organization scope. Every tenant RPC takes `p_organization_id` first and filters document, component occurrence, finding, human hold, job, and audit joins by it. Cross-tenant resources return no row and the controller maps that to 404.
- Immutable source-record versions retain their full normalized NVD tree and a matching-relevant fingerprint. Parsed PURL/CPE identity fields and source/finding indexes choose candidates; no tenant-wide component scan is permitted.
- Each job claim/persist/transition writes the job checkpoint, finding state, and safe `audit_logs` fact in one transaction. `(scope, source-version, organization, idempotency key)` uniqueness makes repeat delivery harmless. Leases, retry time, and terminal failure support restart recovery.
- The migration is additive: `canonical_purl` becomes nullable, all new state has safe defaults, existing PURL rows remain valid, generated types are regenerated after application, and prior API code continues to consume the old columns. Rollback stops the new worker/controllers before a later contract migration; it retains source/evaluation/finding history.

## API and UI boundaries

- Feature-first schemas/types under `@repo/contracts/vulnerabilities` define CPE evidence, re-evaluation status/history, paths, query, human-verdict input, and responses with `z.output` types.
- Existing matching status/findings reads remain `can_view_sboms`. A direct human-verdict command requires `can_edit_findings`, a bounded rationale and idempotency key. History reads are organization-scoped.
- The central browser API client validates command input and all successful bodies. The existing matching panel renders method, confidence, source version, tree rationale and transition reason as text; its existing low-confidence/reviewable filters remain available.

## Failure modes, tests, and observability

- Malformed CPE/configuration, unknown platform predicates, unparseable versions, and stale/rolled-back source data fail closed to reviewable or source-unavailable evidence, never an assumed affected result. Provider/database failure retains the prior effective verdict and retries the leased job without logging secrets or raw SBOM payloads.
- Test characterization first, then CPE unit/golden data, contracts/API 404 and idempotency, worker restart/fairness, transaction/audit/RLS/plan checks, and local browser flows. Metrics carry only dataset digest, policy/table versions, stable counts, and FP/FN rates.
- The new or materially changed units must meet 80% branch/function/line/statement coverage. Supabase SQL tests verify RLS/grants/search paths/index use and no public executable function surface; advisor warnings must not gain a new critical/high result.

## Review checklist

- [x] The direct controller/rescan alternative was considered and rejected for concrete restart/fairness/audit gaps.
- [x] Each selected pattern has a current trigger, participants, and a test seam.
- [x] Browser state is not an authorization or finding-lifecycle authority.
- [x] Security-critical finding/job/audit transitions are transactionally durable.
- [ ] Focused coverage, local live stack checks, full verification, Playwright E2E, and independent review remain execution gates.
