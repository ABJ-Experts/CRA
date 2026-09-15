# M3 SBOM streaming normalization

## Scope and preserved contracts

- **User outcome:** authorized users can inspect the deterministic, tenant-scoped
  component and dependency graph of validated immutable SBOM evidence.
- **In scope:** bounded streaming extraction, canonical component records,
  provenance, graph resolution, durable hidden progress, completed-document
  read APIs, and the product-release UI foundations.
- **Out of scope:** advisory matching, license decisions, SBOM diff/export, and
  composite documents.
- **Preserved:** M3 intake and validation routes, immutable raw sources,
  `/api/v1`, ES256/JWKS sessions, refresh-cookie path, RBAC merge order, and
  `can_view_sboms` / `can_upload_sboms` gates.

## Concrete problem and selected boundaries

The M3-02 worker collects a full Buffer before JSON/XML/tag-value validation.
That cannot safely process the required 50,000 components. A streaming parser
and a durable graph lifecycle are therefore concrete current needs, rather than
an abstraction for future formats.

- **Streaming parser boundary:** a Node readable is consumed under byte and
  component ceilings and emits normalized component/edge batches. It is
  implemented format-by-format behind one parser contract. It has no Nest or
  Supabase dependency and is removable if only one supported format remains.
- **Normalization lifecycle:** the existing ingest job remains the lifecycle
  authority. A normalized document is hidden while processing. A tenant-first
  atomic RPC resolves edges, derives depth/parent projection, writes audit
  facts, and is the only operation that exposes it as completed.
- **Read projection:** controllers delegate to application use cases, which
  depend on inward repository ports. The Supabase adapter is the only concrete
  query implementation. Browser calls go through `SbomsApi` and shared Zod
  contracts.

## Data and tenant boundaries

- Verified organization and actor identity comes from `SupabaseAuthGuard`; CI
  credentials retain their upload-only flow.
- Every service-role method takes `organizationId` first and each RPC verifies
  active membership plus `can_view_sboms`; foreign document/component IDs are
  indistinguishable from missing IDs.
- `sbom_documents`, components, identities, dependencies, and source mappings
  are additive tenant-owned tables. RLS is enabled with member policies and no
  direct browser grants; service role scoping remains the primary boundary.
- Document identity is immutable document SHA-256 plus normalizer version per
  organization. Replays and restart batches use unique constraints/upserts;
  version upgrades add a new reproducible document rather than overwrite one.
- The schema is intentionally unpartitioned for this milestone. Tenant-leading
  indexes cover PURL and name/version queries; reassess partitioning after
  sustained multi-million component rows.

## Deterministic failure policy

- Terminal: byte/component ceilings, malformed stream, duplicate local ref,
  and conflicting identity for one local ref.
- Warning and omitted edge: missing target, duplicate edge, self-link, and a
  cycle-forming edge. Invalid supplied PURLs retain their source value and are
  warnings with no canonical PURL.
- Graph sorting uses source position and local references. Resolution and depth
  are iterative, avoiding recursion for deeply nested/disconnected graphs.
- Provider/database failures leave the lease recoverable. Tenant deletion
  removes tenant rows by cascade; release archival preserves existing evidence
  but prevents new intake. No bytes, signed URLs, or credentials enter logs or
  diagnostics.

## Tests, operations, and rollback

- Characterize M3-02 validation behavior before replacing worker reads. Test
  each format, limits, PURL escaping, version preservation, graph warnings,
  concurrent replay, failure between batches, RLS, and 50k stream performance.
- Use the local development stack only for E2E; create run-scoped owner data,
  never reset or delete unrelated evidence, and inspect only created rows.
- Deploy additively: migration and generated DB types first, then API worker,
  then UI. Roll back by disabling worker/UI reads while retaining immutable
  sources and hidden rows; repair forward and replay rather than overwrite.

## Review checklist

- [x] The full-buffer direct implementation was rejected for the demonstrated
      50k requirement.
- [x] Controllers/pages do not query Supabase directly.
- [x] Normalization state is durable and completed visibility is atomic.
- [x] Runtime contracts parse browser/API values in both directions.
- [x] Tenant scoping, RLS, source provenance, and failure policy are explicit.
