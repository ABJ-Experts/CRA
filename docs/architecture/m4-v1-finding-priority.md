# M4 V1 Finding Priority

## Scope and preserved contracts

- User outcome: reviewers see a reproducible, explainable priority for each
  mirror-backed vulnerability finding.
- In scope: deterministic priority projection on the existing enriched-finding
  read route.
- Out of scope: regulatory classification, M6 report submission, reachability
  scoring, and any mutable browser-side priority calculation.
- Preserved: existing finding identity, mirror provenance, tenant-first RPCs,
  and the existing `GET /api/v1/sbom-documents/:documentId/vulnerability-enriched-findings`
  route.

## Concrete problem

The enriched-finding projection already exposes CVSS, EPSS, KEV, confidence,
and a human assessment, but presents no stable priority. Requiring each caller
to combine those fields would make ordering and explanations diverge.

## Why not simpler?

A JSX-only label would be untrusted, unavailable to API clients, and could
drift from exports. A single pure server policy, projected at the existing API
boundary, supplies the exact same result to every consumer without a new
workflow or persistent command.

## Selected patterns

- Pattern and trigger: immutable pure policy; one deterministic algorithm is
  required now and does not justify a Strategy hierarchy.
- Participants: `evaluateVulnerabilityPriority` owns arithmetic; the
  Supabase enrichment adapter applies it after parsing mirror-backed rows;
  the contracts own the public output shape; the React view renders it.
- Dependency direction: controller -> application port -> infrastructure
  adapter -> pure policy. The policy depends only on contract-shaped values.
- Removal trigger: remove the projection and its contract field if priority is
  superseded by an approved persisted risk engine.

## Rejected patterns

- Strategy: there is one approved formula version today, not multiple live
  algorithms.
- New persistence workflow: the inputs are already versioned source facts and
  the formula version is returned, so a read projection is sufficient until a
  historical priority-snapshot requirement exists.

## Data and tenant boundaries

- Identity and organization are selected by `SupabaseAuthGuard`; the existing
  SQL RPC receives organization ID first and actor ID second.
- No write, provider, or browser state participates in priority calculation.
- Additive contract expansion is backward compatible only after API and web
  deploy together; existing routes and pagination remain unchanged.

## API boundary contracts

- Contract: `@repo/contracts/vulnerabilities` enriched finding schema.
- Success: enriched finding rows include a strict priority projection with a
  formula version, score, tier, and factor explanation.
- The existing Nest response interceptor and browser response parser continue
  to parse the complete response.

## Failure modes

- Missing CVSS/EPSS/KEV data is scored deterministically as zero contribution
  and visibly represented in factors.
- A malformed mirror response still fails closed at the existing adapter
  schema boundary.
- Tenant or authorization failures retain the existing 404/503 semantics.

## Tests and observability

- First: pure-policy tests cover exact score, threshold, unavailable-data,
  not-affected verdict, and deterministic repeatability.
- Contract and adapter tests prove the projection is parsed on the existing
  route. Browser component tests assert the priority is visible.
- E2E exercises the existing mirror-backed enriched-finding screen; no feed
  synchronization is triggered by this feature.

## Rollback

The projection is read-only and additive. Rollback removes UI rendering first,
then the API projection after all consumers tolerate its absence; no migration
or data cleanup is required.
