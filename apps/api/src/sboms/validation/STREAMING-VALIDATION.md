# Streaming validation runtime

`m3-03.2026-09-28.1` validates bounded JSON root projections and every root
array item against the pinned official JSON schemas. Array count and uniqueness
constraints are evaluated across the stream. SPDX 3 uses the existing pinned
JSON-LD package-SBOM profile, not a claim of unrestricted SPDX 3 graph support.

CycloneDX XML requires `xmllint` on PATH (Linux package `libxml2-utils`). It runs
with `--stream --nonet --noout` and the local XML catalog. DTD declarations are
rejected by the streaming parser before invoking native validation. Missing or
timed-out native validation is a retryable provider failure, never valid input.

`assets/cyclonedx/spdx-license.xsd` is copied byte-for-byte from the locked
`@cyclonedx/cyclonedx-library@10.2.0` dependency's
`res/schema/spdx.SNAPSHOT.xsd` (Apache-2.0), SPDX license-list edition 3.28.0.
SHA-256: `468d556a2aecd13b4e2ca23925874200391462074c32cd0aa58ce770331fc30d`.
The XML report's schema hash combines the selected XSD and this companion hash.
The catalog prevents the schema's SPDX import from requiring network access.

Temporary sources use private `cra-sbom-*` directories and mode-0600 files,
with a configured byte ceiling. They exist only while the worker verifies,
validates and normalizes an immutable original and are removed on every ordinary
success/failure. A killed process can leave an unreferenced private temporary
file; restart re-reads the retained immutable source rather than trusting it.
Operational cleanup may remove stale `cra-sbom-*` directories only after proving
no active worker owns them. No database evidence is removed by spool cleanup.

SPDX 3 `verifiedUsing` references resolve through a compact ID/digest catalog from
this same verified source. The worker's replay receives that catalog so forward
references are available before each durable batch. No package or graph payload
is retained for this lookup. Catalog entries are bounded by the configured
component limit; each package has at most 100 verification references and each
lookup identifier at most 2048 characters. Oversized inputs fail explicitly.
Unresolved, conflicting or malformed declarations produce diagnostics rather
than invented digests. Weak and variable-algorithm declarations remain raw;
the existing quality policy independently decides whether a digest earns credit.
Direct streaming callers using `onBatch` must supply the verified first-pass
catalog for forward references; retained unit callers resolve after the scan.
