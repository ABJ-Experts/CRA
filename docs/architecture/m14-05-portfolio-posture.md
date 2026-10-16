# M14-05 Portfolio posture and concentration

## Scope and preserved contracts

Read authorized portfolio posture and exact-version PURL concentration inside dashboard. Marketed release scope, optionally archived. Preserve existing org-wide RBAC, cookies/auth signatures/refresh/JWKS/session epoch/permission order/menu/mock namespace/export/report/source approval/retention authorities. No new grant system, cross-tenant view, matcher, risk score, persistent workflow or regulatory decisions.

## Concrete problem

M14-01 supports organization overview and one-product posture; M14-02 historical trends. Neither computes distinct shared canonical components across current verified inventories. Vulnerability occurrences cover only evaluated inventory, so starting there would hide missing matching coverage. Completed SBOM graph is immutable; release-local aliases and supersession require source-owned lineage.

## Why not simpler?

Browser aggregation of products/SBOM pages leaks broader source data, double-counts paths and produces incoherent pagination. Per-product RPC fan-out cannot meet realistic portfolio latency. A source-composed, set-based read facade is sufficient; no table/cache/backfill is justified.

## Selected patterns

- Adapter: PortfolioReadPort in application implemented by SupabasePortfolioRepository, because source projection is an external boundary now. A focused use case handles permission snapshots, tokens and output checks. Shared contract tests cover scope/outage/malformed data. Remove adapter only if provider boundary ceases to exist.
- Immutable policies and discriminated sections reuse current dashboard source gates; no new state machine. Pure representation/version policy is tested against installed PackageURL parser.
- Existing authenticated cursor codec binds live continuation and references to identity/filter/revision. It does not represent a historical snapshot; source changes require refresh.

## Rejected patterns

No generic analytics framework, event bus, worker, materialized view, matcher, closure/path table or new class hierarchy. No server cache initially, avoiding invalidation authority gaps.

## Data and tenant boundaries

RequestUser from verified guard is authority. Repository takes orgId first; each tenant table join filters organization and product/release/document relationships. Current active membership and effective permissions are reread, including org overrides. Legal entities are flat tenant records; relationships/responsible owners never expand access. Source gates precede SQL aggregation. Restricted sources return no payload.

RPC executes a coherent read snapshot; no critical mutation, idempotency command or audit write is introduced. Revision digest includes actual relevant source revisions/relationships; changed continuation returns409 rather than presenting a misleading stable rank. Completed graph/evidence remains untouched. Additive CLI migrations and CLI-generated types precede compatible API/UI. Preserve historical ledger mismatch and apply only new feature migrations.

## API boundary contracts

contracts/dashboard schemas and z.output types own strict query/response/error boundaries. GET dashboard/portfolio/products, concentration, concentration/detail; shared UUID filters/includeArchived/limit<=100/opaquecursor and opaque detail reference. Nest zodQuery/ZodResponse, browser schema parsing, adapter envelope parsing. Unknown keys fail; denied sections carry no counts/identifiers. Provider outage is503, invalid token400, foreign resource404, source revision409 portfolio_scope_changed.

## Frontend logic and rendering

Functional Portfolio workspace/detail/tables; plain injected PortfolioGateway owns HTTP boundary. Scoped query lifecycle reuses dashboard patterns, cancels prior-org requests and erases denied state. Pure formatting/filter policy remains immutable functions. Composition injects existing transport; tests replace gateway at boundary. Current Poppins/chrome/semantic tokens/cn and reduced motion take precedence over marketing GSAP/font suggestions.

## Failure modes

Membership/permission revocation fails closed; filters/tokens are not authority. Database/JWKS/network outages remain unavailable and may retain clearly stale same-scope data without broadening authorization. Foreign response scope is rejected and erased. Revision edits restart pages. Alias/path/release duplication uses distinct product identity/version; identity/version conflicts are missing evidence, not a match. No SMTP/storage/workflow side effect is required.

## Tests and observability

Focused failing characterization/policy/schema tests before implementation; SQL rollback/RLS/lineage/permission/concurrency tests, API envelope/auth tests, query/UI accessibility and Playwright owner/restricted/scope switch journeys. >=80% all coverage metrics. 10k/100k/1m membership benchmarks with1000 products and small-tenant concurrency, p95<400ms/p99<1000ms. Log safe endpoint/outcome/timing, never tokens/source content/user data. Full pnpm verify and applicable live gates; independent security review.

## Rollback

Disable portfolio entry points/routes, deploy previous compatible API/UI and retain additive RPCs/indexes/source evidence. No destructive down migration, source cleanup or historical ledger repair.

## Review checklist

- [x] Direct solution considered; every abstraction has present boundary and test seam.
- [x] No global user/tenant/session state, outward core imports, or page/controller provider calls intended.
- [x] Shared parsed wire contracts, independent source gates and org-first joins required.
- [x] No critical mutation; preserved evidence/retention and additive rollout.
- [x] Focused RED/GREEN and >=80% coverage complete; final web 22 tests meet all metrics, with API/contracts focused gates recorded in the verification evidence.
- [x] Compatibility/live/browser gates passed: 7,559 unit tests, 141 architecture tests, 168 SQL files, 30 live API tests, 33 auth checks and nine browser journeys.
- [ ] Performance acceptance: the final 200-sample-per-endpoint million-membership gate missed both p95 and p99 targets on all three routes. Exact results and limits are recorded in the verification evidence.
- [x] Independent review has no unresolved high/critical findings. NULL/empty identity normalization is correct, both added rollback SQL regression assertions passed, and stable UI review found no findings.
