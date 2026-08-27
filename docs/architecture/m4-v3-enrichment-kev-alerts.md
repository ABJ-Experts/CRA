# M4 enrichment and KEV regulatory alerts

## Scope and preserved contracts

- **User outcome:** A product-security operator can inspect traceable risk intelligence for a matched advisory and receive a durable, human-controlled KEV escalation only when the affected release is currently placed on the market or in support.
- **In scope:** source-version-derived CVSS, EPSS, KEV, CWE, aliases and references; a tenant KEV alert ledger; acknowledgement; durable notification retry; and an explicit reporting-obligation intent boundary.
- **Out of scope:** automatic obligation creation, reporting submission, M5 triage, M6 drafting, and treating EPSS as evidence of exploitation.
- **Preserved:** the existing matching endpoints and match provenance, `/api/v1`, ES256/JWKS auth, refresh-cookie scope, permission merge order, mock namespace, and M2 lifecycle authority.

## Concrete problem and direct alternative

M4 currently preserves source records and versions globally, while a tenant finding only preserves matching evidence. Rendering raw feed JSON in the browser or recomputing KEV from a browser-selected lifecycle would make provenance unauditable and authorization unsound. A mutable finding column would overwrite source corrections and match evidence. The direct alternative therefore cannot provide source-level traceability, durable exactly-once alerts, or restart-safe notification delivery.

## Selected patterns

- **Derived read projection:** the vulnerabilities application reads immutable current source-version facts and applies a pure deterministic selection policy. This exists because CVSS versions and feeds may disagree. It can be removed if one authoritative feed supplies every field.
- **Tenant alert ledger and leased worker:** one `vulnerability_kev_alerts` table contains the alert fact and delivery lease/retry state. This exists because a provider failure must not erase a regulatory alert and duplicate workers must be harmless. It can be simplified only if notification delivery becomes transactionally shared with alert persistence.
- **Inward reporting port:** `ReportingObligationPort` has an unavailable adapter until M6 supplies a real implementation. This isolates M4 from report ownership and is removable once M6 exposes a stable public command boundary.

Dependency direction is functional React UI -> typed web gateway -> Nest controller -> application use case/ports -> Supabase adapter and RPCs. Reconciliation runs inside the transaction that promotes KEV data, persists matching results, or changes an M2 lifecycle; pages and controllers never query Supabase directly.

## Rejected patterns

- A new taxonomy or obligation table is rejected because immutable mirror tables already own source evidence and M6 owns obligations.
- Reusing M2's product outbox is rejected because its event types and ownership are support-period-specific.
- A browser timer or in-memory dedupe is rejected because it cannot survive restart or prove exactly-once state transitions.

## Data and tenant boundaries

- The verified `CurrentUser` supplies organization scope. Every tenant RPC accepts `p_organization_id` first, validates the active actor and filters document, finding, release, alert, and recipient joins by it.
- The alert fingerprint canonically hashes vulnerability, release lifecycle, KEV status, listing date, due date, required action, vendor/project and ransomware fields. A unique tenant/release/vulnerability/fingerprint key makes duplicate reconciliation harmless.
- The same database transaction creates/resolves the alert and writes a safe audit fact. Alert evidence contains only product/release identifiers, advisory identifier, lifecycle, source version, timestamps and KEV facts; it contains no SBOM payload or component PURL.
- The migration is additive. Previous application versions continue to use existing findings routes; rollback stops the new controller/worker and retains alerts and audit facts.

## API and UI boundary

- New vulnerability contracts define strict path/query/input/success-response and delivery-status schemas, with trusted `z.output` types.
- Reads require `can_view_sboms`; acknowledgement and reporting intent require `can_edit_findings`, parse an idempotency key, and re-authorize at request time. Cross-tenant resources return not found.
- A new enriched-findings route does not alter the existing matching response. Values carry every conflicting observation, source record/version, upstream observation time and local retrieval time. Absent, stale and unavailable values are explicit; EPSS zero is valid.
- The existing matching result surface presents provenance in text, a deduplicated release-level alert, confirmation dialog, accessible failure states and no decorative workflow redesign.

## Failure modes and verification

- Only `placed_on_market` and `in_support` create high-severity KEV alerts. Development, end-of-support and withdrawn are explicit non-applicable states. Removed/rejected/disputed KEV resolves prior alerts without creating a new trigger.
- Delivery failure is retryable/dead-lettered after the durable alert exists. The unavailable M6 adapter returns a safe unavailable result and can never submit a report.
- Tests characterize M4-02 page/validation behavior, then cover contracts, provider parsing, source ordering, tenant 404, duplicate/restart reconciliation, lifecycle races, SMTP failure, unavailable/existing M6 responses, SQL RLS/grants, and live owner E2E with scoped cleanup.

## Review checklist

- [x] The direct solution was considered first.
- [x] Each selected pattern has a concrete trigger and test seam.
- [x] No browser state is authorization or lifecycle authority.
- [x] Controllers/pages contain no provider or database decision.
- [x] Source and HTTP boundaries use runtime schemas.
- [x] Security-critical alert and audit writes are transactionally durable.
- [ ] Focused coverage, live stack checks, full verification and independent review remain execution gates.
