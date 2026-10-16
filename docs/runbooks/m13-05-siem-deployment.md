# M13-05 deployment, recovery and rollback

## Deployment

Confirm the CRA project URL/reference and environment before any database command. Apply the additive `20261007*_m13_05_*.sql` migrations in timestamp order through the established Supabase CLI workflow. Do not replay older migrations, repair the historical ledger, reset data or force RLS. Regenerate both database type copies with `pnpm --filter infrastructure run db:types` after migration. The three SIEM tables are deployment-local, private to constrained service-role RPCs, and excluded from portable tenant data.

Deploy the API and dedicated worker paused, then the web surface. Configure the exact public collector protocol, hostname and port in `SIEM_APPROVED_TARGETS_JSON`; configure the existing connector vault keyring through secret management. Do not place credentials in this document, URLs, logs or environment examples. Follow [transport and vault maintenance](m13-05-siem-transport.md) for collector validation and master-key references.

An authorized owner creates credentials. An authorized enabling user selects registered classes and explicit accessible products, validates the collector, then enables separately. Initial enable captures the current committed tenant chain boundary: earlier events are not backfilled. Run the worker with `pnpm --filter api run worker:audit-siem`; `--once` processes a bounded iteration for operational verification. Keep multiple workers within the two global/one tenant lease contract.

## Operational recovery

Inspect authorized destination health and bounded delivery history. Distinguish scan progress, pending work, HTTP collector acceptance, TLS syslog receipt uncertainty and exhausted failures. Retryable failures retain stable event IDs. Do not infer receiver durability from an HTTP 2xx or syslog socket write. Use the stable payload ID for receiver deduplication.

Revoked authority pauses delivery; a currently authorized user must explicitly take over. Credential rotation retains backlog and fences future sends; traffic already dispatched cannot be recalled. Explicit disable cancels pending work and fences leases. Re-enable starts at a new current boundary. Recipient, format or source-scope changes require the explicit cancellation/future-start policy, reason, test and enable cycle.

Replay requires a current authorized preview, recipient/version confirmation and reason. It produces a linked delivery with a newly authorized structural projection, retaining the stable source-event identity. Never send old payloads blindly to a changed recipient.

## Restore procedure

Pause writes and SIEM workers, drain transactions, then use the M13-04 operator-only dataset epoch rotation procedure before reopening access. Dataset identity/epoch mismatch pauses forwarding and quarantines old backlog. Review retained jobs and explicitly perform fresh-start handling; do not silently reuse an old cursor. An unmarked identical restore cannot be detected from hashes alone. No restore, chain repair or source-evidence modification is part of this deployment.

## Rollback

Disable the new worker, SIEM routes and web entry point. Retain the additive tables, dataset metadata, encrypted envelopes, delivery/attempt history and durable security receipts. Do not reverse migrations by dropping evidence or purge source records. Preserve all master keys needed by retained envelopes, immutable HMAC request fingerprints and backups. Original audit producers, explorer, exports and range verification remain independent of collector availability.

## Verification fixtures

Use disposable synthetic databases for tamper/load scenarios. The development browser fixture uses owned loopback TLS listeners through a test-only adapter; production endpoint validation has no private-address exception. Scope browser contexts to the CRA origin and put Playwright runner artifacts under an owned `/tmp` output directory. Do not clear other sites' cookies/storage or overwrite prior test evidence. Retained development fixture configurations should be explicitly disabled after testing.
