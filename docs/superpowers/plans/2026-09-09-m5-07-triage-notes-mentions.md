# M5-07 implementation plan

1. Add strict feature-local Zod contracts for paged notes, candidate lookup, and idempotent versioned mutations.
2. Add the additive note, revision, and mention queue migration; extend the established triage command ledger and export registry.
3. Extend the existing triage controller/use case/port/repository with org-first RPC calls and parsed wire responses.
4. Add a feature-local lease worker and content-minimal mail adapter that rechecks delivery eligibility.
5. Add the compact plain-text Notes panel, explicit mention selection, tombstones, and recoverable-save behavior.
6. Run contract, web, API, migration/live-stack, accessibility, and local Playwright checks without resetting existing data.

Key decisions: author-only update/delete; tombstone deletion; historical snapshots; one lifetime notification per note-recipient; no rich text; no notification content leakage.
