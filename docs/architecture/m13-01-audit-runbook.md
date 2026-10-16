# M13-01 audit capture runbook

## Before enabling the new writer

Confirm the target is the local `cra` stack. Check `supabase status`, the local project reference, container name and migration ledger before any schema action. The Supabase MCP projects available during M13-01 planning were unrelated ERP projects; do not use them for CRA SQL. Never reset data, rewrite an applied migration, or fabricate historical audit events.

Apply the additive audit migration with the Supabase CLI, regenerate both generated type copies through `pnpm --filter infrastructure run db:types`, then deploy API and workers before any dependent web code. Check `audit_logs` columns, scoped event-key indexes, non-forced RLS, append-only grants, function `search_path`, explicit RPC grants and compatibility with the previous API. Keep older event rows at their original version.

## Normal operation

- A completed critical domain mutation has a matching v2 event with the same organization and stable operation identity. Repeated identical requests return that event; a changed payload under the same identity conflicts.
- Failed security attempts have `failed` or `denied` outcomes and are never displayed as completed state changes. Pre-tenant events use protected security scope assigned by the server.
- AI audit rows contain model and prompt versions, run and artifact references, input references, and a named human decision. They contain no prompt, source passage or extracted field content.
- Source-owned M1–M12 SQL writers remain the authority for their operation. Do not add an API-side second event to make a dashboard count increase.
- Invitation creation commits `invitation.created` with the pending row. A mail failure attempts token-fenced revocation and records `invitation.delivery_cancelled`; retry then creates a fresh token. If compensation reports `changed`, another resend or acceptance won the race and must not be revoked. If compensation reports `failed`, use the existing scoped invitation list/resend journey after database recovery; do not expose the raw token or email in audit.
- Worker claim, lease and retry noise is represented in the durable job ledger; audit only a meaningful business outcome or terminal transition.

Monitor audit write failures, unresolved external intents, duplicate-key conflicts, redaction rejects and `audit: false` on `/api/v1/health/ready`. Logs and alerts contain safe event IDs and counts, never secrets, bearer material, confidential before/after values or raw provider output. A degraded auth response is an availability exception and must be counted as an evidence gap for operator review.

## Incident response

If a critical mutation cannot commit its event, stop that operation and investigate database availability, grants, trigger errors and tenant scope. Do not switch it to fire-and-forget logging. If sign-in or refresh remains available while audit is degraded, record the interval and affected count from safe operational metrics; do not reconstruct successful events without verified source facts. If an external provider accepted an action but the outcome is missing, inspect the durable intent and provider evidence before manual reconciliation. Do not replay a potentially accepted action automatically.

MFA recovery can remove an identity-provider factor before a local persistence failure is observed. An unresolved `auth.mfa_recovery` intent is therefore an uncertain provider outcome, even when the HTTP response is 503. The recovery claim may itself be marked failed after partial provider deletion; that claim status does not prove the factors remain enrolled. Check factor state and the claim through authorized tools before resolving the intent, and do not automatically retry factor removal.

For a suspected secret leak, restrict audit read access, isolate the affected prospective writer, identify event IDs without printing payloads, and follow the approved incident process. Do not hash low-entropy secrets as a substitute for redaction. Preserve historical rows for authorized review and retention/legal-hold rules; no blanket scrub is part of this ticket.

## Verification and rollback

Run `node --test scripts/architecture/audit-operation-coverage.test.mjs`, focused contract/API tests, local SQL transaction/RLS tests, `pnpm --filter infrastructure run db:lint`, `pnpm test:architecture`, `pnpm verify`, and applicable local live-stack and Playwright journeys. Record branch/function/line/statement coverage for new modules and screenshots from the development server. Do not claim universal coverage while `best-effort` or `legacy-unverified` register entries remain.

On rollback, disable new enforcement in configuration, let in-flight critical transactions finish or fail, and review unresolved external intents before restoring older workers. Leave additive columns and event rows in place. Apply a forward corrective migration for schema defects; do not reset or delete user data.

The M13-01 closure migrations `20261005124457`, `20261005124622`, `20261005124632`, `20261005124710`, and `20261005125332` add narrowly scoped source projections and replace two existing RPC bodies. When reverting an API/worker binary, first stop new chat test and reporting pack commands, review pending provider intents and pack reservations, and keep these additive database writers active until old callers have drained. A later forward migration may retire a writer after the source flow has been reviewed; do not drop audit rows or disable the guard to make a failing operation pass. Existing legacy direct SQL writers continue to use the database redaction safeguard.

`20261005133028` adds `users.profile_audit_version` and exact profile retry replay. `20261006054130` preserves the audit projector's `STABLE` volatility. Keep both migrations when rolling an API version back: the older caller can ignore the additive column, while retry identities already used by the newer caller remain auditable. A retry after an independent profile revision must return conflict and require a fresh user action; never infer success from the idempotency key alone. Review `user.profile_updated` by event key and source revision, without reading or logging profile values.
