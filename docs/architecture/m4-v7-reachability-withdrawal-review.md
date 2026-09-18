# M4 reachability evidence and advisory withdrawal review

## Scope and preserved contracts

- **User outcome:** Security users can inspect a reproducible reachability conclusion and can review an advisory withdrawal, dispute, conflict, or reinstatement without losing the underlying match, source provenance, or analyst assessment.
- **In scope:** immutable reachability evidence, configured analyzer capability checks, finding-scoped evidence and review reads, advisory-source assertions, stale evidence, material review events, and durable notification retry state.
- **Out of scope:** source-code analysis, VEX creation, browser result upload, arbitrary analyzer registration, advisory deletion, and an M5 approval workflow.
- **Preserved:** `/api/v1`, deterministic M4-02/M4-04 matching, human-verdict semantics, existing auth/JWKS/cookie behavior, permissions, finding history, CSAF assertions, and the Evidence Control Room visual language.

## Concrete problem and direct alternative

The M4-04 finding ledger can preserve a human applicability verdict while a source changes, but source withdrawal currently resolves an automatic match as closed and has no place for immutable analyzer evidence. Storing the latest conclusion directly on `vulnerability_findings` would discard prior evidence, cannot safely distinguish a late analyzer run, and cannot deduplicate notification delivery. Two additive tenant-scoped ledgers are the smallest durable design: one immutable reachability result ledger and one material review-event delivery ledger.

## Selected patterns

- **Immutable result ledger:** A result needs versioned analyzer, artefact identity, ordered evidence, and freshness history. `vulnerability_reachability_results` owns this evidence; a finding remains the deterministic match authority. Remove only when a future generalized evidence ledger supersedes this feature.
- **Durable review outbox:** Withdrawal/dispute/reinstatement is persisted with audit and review state before notification. The notification worker leases and retries the event. This exists because provider delivery can fail after a security-relevant review state must be visible. Remove when a shared durable notification outbox replaces the feature queue.
- **Configured adapter boundary:** A server-side application input parses the shared reachability contract and checks a deployment-configured adapter/version/capability allowlist. No browser/API submission route exists because an untrusted analyzer name or raw artefact path would violate the evidence boundary.

## Rejected patterns

- New M5 approval states are rejected: an additive M4 review flag/history supplies the required visibility without inventing approval semantics.
- A generic analyzer catalog table is rejected: current adapter capability is deployment configuration, not tenant-managed data.
- A direct Supabase UI query is rejected: it would bypass tenant-authorized API response parsing.
- Reusing KEV alert rows is rejected: their lifecycle and recipient purpose are KEV-specific and would couple unrelated material transitions.

## Data and tenant boundaries

- `CurrentUser` supplies the organization for every read. Every service-role repository/RPC receives `organizationId` first and filters document, finding, evidence, source assertion, and review-event joins by it; absence maps to 404.
- Reachability input accepts only safe SHA-256 fingerprints and bounded text/JSON evidence metadata. It never persists artefact contents, paths that disclose a host, source code, credentials, or tokens.
- `not_reachable` requires configured analyzer/version support, a component and vulnerable symbol, and a non-empty ordered path. `unknown` and `not_analysed` retain explicit limitations instead of implying safety.
- Result recording, stale marking, review event creation, finding state, and audit facts are atomic/idempotent. A failed notification leaves the review event durable and retryable.
- The migration is additive with RLS enabled (not forced), explicit indexes/foreign keys, pinned security-definer search paths, revoked public RPC access, and explicit service-role grants. Previous code remains compatible until the new worker/routes are deployed.

## API and UI boundaries

- `@repo/contracts/vulnerabilities` owns all reachability/review path, input, response, and notification-status schemas and derives trusted `z.output` types.
- Thin matching-controller reads use `can_view_sboms`: finding-scoped `reachability-evidence` and `advisory-review` responses are parsed through `@ZodResponse`. The server adapter input is parsed before application logic; no browser mutation is exposed.
- The central web gateway parses successful responses. Functional detail components load them only when expanded and display textual freshness, analyzer provenance, confidence, source assertions, limitations, and review state. Ordered evidence is keyboard navigable and never hover-only.

## Failure modes, tests, and rollback

- Unsupported adapters, missing evidence, malformed hashes, missing symbols, late input, stale fingerprints, cross-tenant IDs, conflicts, provider failure, duplicate deliveries, and worker restart all fail without broadening access or deleting history. An unavailable notification provider leaves a visible durable review flag and performs controlled retry.
- Characterization tests pin the prior withdrawal/human-hold behavior before changing it. Contracts, unit/worker, API, repository, SQL/RLS, live-stack, browser accessibility, golden matching, and coverage tests prove the new behavior. Advisor output may not introduce a new critical/high finding.
- Rollback stops the new adapter/notification worker and routes first; additive tables/functions/evidence remain readable. A later contract migration may remove unused columns/functions only after all prior application versions are retired.

## Review checklist

- [x] Direct finding-column and generic-catalog alternatives were rejected for specific immutability and operational reasons.
- [x] Browser state is not an authorization or reachability authority.
- [x] Security-critical review/audit facts are transactionally durable.
- [ ] Focused coverage, live database checks, full verification, Playwright E2E, and independent review remain execution gates.
