# M3 gap closure implementation plan

Baseline: clean milestone-1 at d5d1d05. Source: supplied BRD FR-SBOM-001–016, required SBOM screens and existing implementation. Preserve committed M2 and all dependencies; local CRA only, no reset/commit/push.

1. Complete read-only source/database audit and map all sixteen requirements to real symbols and tests. Confirm MCP local identity before database reads.
2. RED tests for production streaming validation parity, supported format/root/version/schema boundaries, XML backpressure and tag-value dependencies; repair shared ingestion without losing originals or permitting partial completed graphs.
3. RED browser/gateway tests for bounded hashing, lost initialization/PUT/completion retry identity and cursor history. Reuse existing reservation/idempotency/cursor contracts and installed hashing dependency.
4. RED contracts/application/controller tests for normalized CycloneDX/SPDX export and optional reviewed VEX. Reuse scoped immutable graph and existing reviewed VEX sources; do not create an export store/table. Validate format/version, permissions, product/tenant substitutions and absence/error behavior.
5. Correct evidence-backed quality/composite gaps: explicit declared top-level coverage limitations; preserve meaningful quality metrics/provenance and valid root edges. Connect the existing M4 ecosystem comparator to the M3 lineage worker after the final audit exposed unresolved version ordering; preserve historical report policies and inspect the latest finding projection before changing readiness. Verify diff/regression/dedupe/historical retention through the current engine.
6. Add accessible export/history/retry UI and shared gateway contracts. Preserve functional rendering, cn(), tokens and recoverable input. No AI prerequisite.
7. Focused >=80% coverage; local Postgres/RLS/storage and worker restart/bounded scale checks; independent security/correctness review. CLI migrations/types only if concretely necessary.
8. Run pnpm verify and live Playwright journeys with desktop/mobile screenshots and MCP cross-checks. Clean only exact generated fixtures. Produce requirement-to-test trace, reproducible commands, schema alignment, rollback and residual limits, then stop before M4.

Parser, export and web workers own disjoint files. Root owns integration/design/docs/database scheduling. All agents preserve others' changes and coordinate shared module/contract builds.

## Verified late follow-ups

- Repair source and supplier cursor boundaries in one CLI function-only migration, with real SQL exact-set page walks (13/113 sources; limits 1/10/100), equal timestamp ordering, filters and tenant isolation.
- Complete the pinned BSI technical-profile implementation described in the feature design. Separate duties: quality policy/worker/contracts and report projection; bounded original-file fact extraction; scoped storage evidence adapter. Root owns module integration and final gates. Reuse existing report JSON/findings, original storage and parser dependencies. Write RED tests before implementation. Preserve existing score formula and historical reports, and retain explicit human-review uncertainty instead of automatic conformity claims.
