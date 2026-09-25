# M9-01 supplier registry and component responsibility links

## Scope and preserved contracts

- **User outcome:** authorized internal operators can maintain tenant-owned
  supplier details, contacts, criticality, and release-specific component
  responsibilities, then trace a finding to zero, one, or several current
  supplier candidates.
- **In scope:** internal registry/detail screens, explicit duplicate review,
  archive-only history, exact occurrence responsibilities, existing supplier
  SBOM request association, and finding navigation.
- **Out of scope:** public supplier directory/portal access, procurement or
  risk scoring, automatic name matching, version-range interpretation, and
  changes to evidence retention, immutable SBOMs, or M3 portal tokens.
- **Preserved:** `/api/v1`, auth/JWKS/cookie contracts, permission merge order,
  existing supplier-SBOM request/invitation/submission wire shapes, M2 product
  relationships, M3 normalized components, M4 matching, and M7/M8 evidence.

## Concrete problem and direct solution

M3 retains a supplier display name only on an SBOM request. It has no
tenant-owned supplier identity, contacts, criticality, responsibility history,
or safe reverse join from a finding. Joining a finding to that mutable display
text would merge same-named suppliers and lose document/release provenance.

The direct alternative is a `supplier_name` column on components. It cannot
represent multiple suppliers, contacts, archive history, explicit duplicate
review, or a release-specific finding projection. M9-01 therefore adds three
focused registry tables, one backward-compatible request FK, and transactional
RPCs; it does not introduce a generic workflow, event bus, portal identity, or
version-range parser.

## Selected and rejected patterns

- **Facade/use case:** a focused supplier application service coordinates
  supplier, contact, responsibility, and request-association commands. Remove
  it if the feature becomes a single direct read.
- **Adapter and inward-owned port:** the application owns the supplier port;
  a Supabase adapter owns atomic RPC mapping, tenant filters, and provider JSON
  parsing. Controllers and pages do not query Supabase.
- **Immutable relationship history:** a responsibility is ended or superseded,
  never retargeted. The source occurrence and canonical identity/version are
  copied as historical facts. A supplier/contact is archived rather than
  deleted. Remove this only if source provenance is no longer required.

Rejected: M2 `product_relationships` links products rather than normalized
SBOM packages; supplier-name matching is ambiguous; a generic history/event
store duplicates `audit_logs`; and a separate supplier RBAC model duplicates
the existing permission matrix and custom-role merge machinery.

## Data, tenant, and transaction boundaries

- `supplier_organizations`, `supplier_contacts`, and
  `supplier_component_responsibilities` are additive, RLS-enabled/non-forced,
  service-role-only tables. They use organization-scoped restrictive foreign
  keys, optimistic versions, bounded facts, archive/end timestamps, and active
  indexes. No name or email is globally unique.
- A responsibility references one exact
  `vulnerability_component_occurrences` row and validates its organization,
  product/release, SBOM document/component, canonical identity, and version in
  the atomic command. A supersession can advance only to the same supplier,
  product, canonical identity, and identity kind in a later release-specific
  occurrence. It may have several active suppliers. No active row is returned
  as explicit `unknown`, never inferred from an SBOM supplier string.
- `sbom_supplier_requests.supplier_id` is nullable and is populated only by an
  explicit authorized association. Existing display-name request rows are not
  backfilled or silently merged; archiving a supplier retains its request and
  responsibility history.
- Every state-changing RPC takes `p_organization_id` first, locks the affected
  tenant rows, verifies membership and referenced product/release/occurrence,
  enforces idempotency or expected version, and inserts its `audit_logs` fact
  in the same transaction. Functions pin `search_path`, revoke `PUBLIC`, and
  grant only `service_role`.
- Supplier duplication is advisory and safe: create detects normalized
  same-name candidates; a retry must explicitly affirm every current candidate
  before a distinct row is inserted. It never updates or merges a candidate.

## API and presentation boundaries

- `@repo/contracts/suppliers/{schemas,types}` owns strict Zod request, path,
  query, response, duplicate, request-history, and finding-resolution shapes.
  Trusted values use `z.output`; the Nest pipes and web transport parse both
  directions.
- Internal registry reads require `can_view_suppliers`, `can_view_products`,
  and `can_view_sboms`; mutations additionally require
  `can_manage_suppliers`. Finding resolution also requires
  `can_view_findings`. Owner/admin receive the new keys through the established
  presets; custom roles may add them. No base role or merge order changes.
- The registry is a compact internal Operate surface: paginated search table,
  detail panels, explicit create-distinct choice, accessible status/form
  feedback, and preserved draft state. A finding detail loads a small current
  supplier panel separately, so existing triage response shapes stay stable.

## Failure modes, tests, and deployment

| Failure or edge case                                          | Required result                                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Same supplier name/email                                      | Show permitted candidates; require explicit distinct-record confirmation; never merge. |
| Cross-tenant, wrong product/release, or mismatched occurrence | Return safe denial before names, contacts, counts, or history are disclosed.           |
| Concurrent archive/edit/link command                          | Lock and compare expected version; replay idempotent creates or return conflict.       |
| Superseded occurrence or ended responsibility                 | Preserve history but exclude it from current responsible-supplier results.             |
| No active responsibility                                      | Return `unknown`, not an invented supplier.                                            |
| Legacy request display name                                   | Keep it unlinked until an authorized operator explicitly associates it.                |

Begin with contract/policy characterization tests, then controller/use-case/
repository and live pgTAP RLS/constraint/audit tests. Verify new modules at at
least 80% coverage, the menu/auth regression gates, accessibility, and local
Playwright flows with uniquely named fixtures. Deploy expand-only migration and
CLI-generated types before API and web. Rollback disables new routes/UI while
retaining every supplier, contact, responsibility, request association, and
audit fact; it never deletes or reopens evidence/SBOM access.

## Review checklist

- [x] Direct display-name linking was rejected for concrete ambiguity and
      provenance failures.
- [x] The feature uses only focused facade, adapter, and immutable-history
      patterns with present-tense triggers.
- [x] Existing supplier portal sessions and wire shapes remain unchanged.
- [x] Tenant scope, durable audit, optimistic concurrency, and idempotency are
      database-authoritative.
- [x] New contracts are feature-first and parsed at API/web boundaries.
- [x] Focused contracts/API/web suites, local SQL boundary checks, and owner
      browser flows cover create, duplicate review, contact creation, and the
      explicit unknown-responsibility state.
- [x] A uniquely named, local-only normalized product/release/component/finding
      fixture verifies the browser's multiple-responsible-supplier journey.
      It has two exact active occurrence responsibilities and is retained for
      repeatable local verification; no production or remote data was read or
      modified.
