# M14-03 retention and archival boundary

Filtered exports reuse the existing `export_artifact` evidence class. They introduce no retention policy, automatic deletion schedule or source-evidence erasure decision. Their 24-hour availability expires access; it does not authorize deleting private storage, immutable snapshot rows, job metadata or audit evidence.

The service-only `m14_03_export_cleanup_eligibility(organizationId, jobId, cleanupRunId, leaseOwner, checkpointVersion)` RPC is a **read-only dependency projection**. It uses the existing organization retention policy, four availability authorities, authoritative facts, source-product legal holds, evidence legal holds, protection watermark and explicit pending candidate on a fenced `retention_cleanup_runs` lease. Unknown tenant/job pairs return only `not_found`. Its output always includes `cleanup_authority_unavailable` and `deletionAuthorized: false`; successful authority reconciliation is not a deletion grant. No public controller or browser role can execute it.

Verified baseline boundaries:

- M1 already defines `export_artifact` in `20260810124500_m1_tenant_administration_foundation.sql`, alongside `organization_retention_policies`, `retention_authority_states`, `retention_authoritative_facts`, `evidence_protection_watermarks` and cleanup ledgers.
- `OrganizationsModule` in `apps/api/src/organizations/organizations.module.ts` injects `UnavailableEvidenceCleanupAdapter` into the generic retention worker. Its `remove()` implementation in `apps/api/src/organizations/tenant-administration/worker/supabase-tenant-lifecycle-worker.adapter.ts` throws `dependency_unavailable`. This remains intact.
- M8's `claim_evidence_document_deletion_cleanup_atomic` operates on an approved document deletion intent. `place_evidence_document_legal_hold_atomic` in `20260921123000_m8_05_retention_rpc_contract_alignment.sql` rejects new holds only after that document reaches `cleanup_claimed` or `deleted`. This source-owned irreversible decision does not apply to a derived filtered export, and M14 does not broaden it.
- M13's `complete_organization_purge_atomic` in `20261006081818_m13_02_audit_retention_lifecycle.sql` unconditionally adds `audit_archival_required`. This boundary remains intact; M14 neither deletes the audit ledger nor silently permits tenant purge.
- `m14_03_immutable_snapshot` and tenant-qualified restrictive foreign keys continue protecting `export_snapshot_rows` and `export_jobs`. The projection supplies dependency visibility without adding an unvalidated deletion escape hatch.

## Deployment and rollback

Apply the additive `20261009120148_m14_03_export_retention_dependency.sql` migration through the normal CLI workflow and regenerate database types. It only creates a diagnostic function, pins its search path and explicitly grants execution to `service_role` after revoking browser/public grants. It changes no existing cleanup, hold, purge or immutable-row function. Rollback disables callers while retaining the compatible function and protected artifacts; no data deletion is needed.

The rollback-only `apps/infrastructure/tests/m14_03-export-retention-dependency.test.sql` verifies service grants, stable/read-only behavior, forged tenant suppression, expiry without deletion, missing authority, complete projections without deletion authority, stale worker rejection, legal-hold protection, retained jobs and the preserved M13 archival gate. Its fixtures roll back and do not remove existing data.

## Residual operational limit

Expired filtered-export artifacts and frozen rows remain retained, so private storage and snapshot volume grow. A future approved archival/cleanup design must bind the exact frozen source set to source-owned deletion authority, provide durable tombstones and audit, fence a bounded storage-deletion handshake, define new-hold behavior before irreversible effects, and amend immutable-row deletion only within that validated context. It must also register derived export dependencies with any future tenant-purge implementation. Retention policy changes, evidence erasure and removal of M13's archival gate require separate architecture review.
