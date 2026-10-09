# M4 signed offline vulnerability bundles and CSAF reconciliation

## Scope and preserved contracts

- **User outcome:** an owner or administrator can safely import a complete,
  signed offline feed snapshot in an air-gapped deployment and can inspect
  vendor CSAF assertions alongside, rather than instead of, public advisory
  evidence.
- **In scope:** multipart preflight/confirmation, deployment keyring and
  compatibility validation, atomic promotion, mirror-age provenance, CSAF 2.0
  validation and source assertions, alias reconciliation, targeted M4-04
  re-evaluation, and the existing Security operational surface.
- **Out of scope:** accepting unsigned archives, an air-gapped application
  fork, downstream CSAF publishing, vendor-signature trust without a vendor-key
  contract, and regulatory submissions.
- **Preserved:** `/api/v1`, existing feed and finding identities, M4-04 human
  holds, ES256/JWKS and cookie contracts, deny-by-default routes, public-source
  canonical fields, current browser gateway boundary, and the evidence-control
  room page structure.

## Concrete problem

The current mirror only obtains provider pages over configured network
adapters. A controller-side file import would couple untrusted multipart bytes,
key verification, disk staging, per-feed rollback rules, and promotion into a
single request; a partial failure could expose a mixed mirror. Separately, a
CSAF document contains vendor-specific product/status/remediation assertions
that cannot safely replace public records merely because aliases coincide.

## Why not simpler?

A direct JSON upload cannot prove which exact bytes were approved, validate all
payloads before state changes, survive confirmation retries, or prevent a
per-feed rollback. Adding vendor fields to public source records would lose
conflicts and source history. The already-proven staged feed runs and immutable
source versions solve both problems when the import is a verified preflight
followed by a transactional promotion, and CSAF stays a source-specific feed.

## Selected patterns

- **Adapter:** a `CsafFeedProvider` implements the existing inward
  `VulnerabilityFeedProvider` contract because provider-index acquisition and
  CSAF document validation differ from NVD/OSV. Its removal trigger is a
  standardized upstream gateway with the exact normalized contract.
- **Facade/application use case:** an offline-bundle use case coordinates
  verifier, temporary storage, staged feed runs, and a repository confirmation
  RPC. It is needed because callers otherwise have to coordinate multiple
  security-sensitive steps. Controllers and React gateways only call this
  facade.
- **Persisted lifecycle state:** an additive import record records
  preflight/validated/promoting/completed/rejected/failed transitions. The
  trigger is an explicitly confirmed mutation that must be idempotent and
  restart-safe; a boolean cannot distinguish safe retry from rejected input.
- **Immutable policy functions:** manifest canonicalization, Ed25519 preimage,
  version compatibility, inventory, hash, and rollback checks are pure
  functions. They are removed or replaced only with a formally compatible
  deployment signing contract.

No global event bus, archive abstraction, generic reconciliation engine, or
vendor precedence strategy is introduced: the established feed worker/RPC and
canonical finding identity already provide the necessary boundaries.

Dependency direction remains functional React UI -> typed web gateway -> thin
Nest controller/use case and inward ports -> provider/Supabase adapters. The
worker uses the same application boundary. Public and vendor source versions
remain siblings; reconciliation records source-specific assertions and derives
one canonical identity without overwriting public fields.

## Data and tenant boundaries

The offline mirror and keyring receipt are deployment-global, so no browser
tenant input selects them. The authenticated actor is verified by the existing
admin guard. All organization finding/re-evaluation operations retain an
explicit `orgId` first argument and filter every service-role query; RLS is
defence in depth. A confirmation RPC locks included feed configurations in a
stable order, re-validates staged hashes/snapshot time/idempotency, promotes all
included feeds, audit facts, mirror timestamps, and re-evaluation enqueue facts
in one transaction. Failed preflight or confirmation leaves active records
unchanged. The migration is additive, and older API instances can ignore its
new columns/table.

## API boundary contracts

Schemas and `z.output` types live feature-first in
`@repo/contracts/vulnerabilities`. Multipart files are parsed at the Nest
boundary, while the manifest and command metadata are Zod parsed before the use
case. JSON success responses use `@ZodResponse`; the central web API client
validates outgoing commands and all successful responses. The UI only receives
safe key IDs, hashes/receipts, status codes, source timestamps, and
reconciliation evidence—never a public key, private material, provider
credential, or raw upload bytes.

## Failure modes

Unknown, revoked, expired, or out-of-window keys; malformed signatures;
duplicate/missing/reordered/oversized/corrupt payloads; unsupported application
range; insufficient staging capacity; provider schema drift; interrupted
confirmation; concurrent duplicate requests; per-feed rollback; stale source;
and database failure all fail closed before active-mirror mutation. Preflight
temporary files are cleaned in `finally`; the durable receipt uses redacted
failure codes. Network absence disables only connected CSAF acquisition; bundle
CSAF payloads use the same local validator and have no fallback. Vendor/public
status conflict is retained as reviewable evidence, not a status overwrite.

## Tests and observability

Characterization tests first pin existing strict NVD record parsing and PURL/NVD
matching. Unit tests cover canonical preimages, key rotation/revocation,
compatibility bounds, inventory/hash/disk failures, CSAF schema fixtures and
unmapped product trees. Contract/API/RPC/live SQL tests cover idempotency,
atomicity, search paths/grants/RLS, rollback, source age, alias consolidation,
human-hold preservation, and fair restart-safe re-evaluation. Browser tests
cover forbidden/loading/degraded/completed and keyboard confirmation. Logs and
audits contain feed/import/correlation IDs and safe codes only.

## Rollback

Disable offline import and CSAF schedules/configuration before rolling code
back. Added tables/columns/functions are unused by the older application and
are retained with immutable source evidence; no historical mirror or finding is
deleted. A later contract migration may remove the feature only after all
deployment versions no longer use it.

## Review checklist

- [x] Direct solutions and their insufficiencies are documented.
- [x] The adapter, facade, lifecycle, and pure-policy triggers are current.
- [x] Source and tenant boundaries, idempotency, and transaction boundary are explicit.
- [x] Parsed contracts and central web transport are required.
- [x] Failure, rollback, coverage, live-stack, and security checks are enumerated.
