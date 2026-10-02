# M6 signed manual submissions and immutable reporting evidence

## Scope and preserved contracts

- User outcome: an approved reporting stage can be packaged, filed manually,
  and evidenced without confusing any of those actions.
- In scope: server-signed packages, receipt-backed actual filings,
  acknowledgements, and verifiable evidence exports.
- Out of scope: regulator API delivery, AI, fabricated acknowledgements, and
  any retention/deletion policy.
- Preserved: `/api/v1`, existing session/JWKS/cookie boundaries, tenant
  isolation, submitted historical records, and report permission semantics.

## Concrete problem and direct solution

M6-04's approval RPC currently creates a submission and closes the stage. That
cannot distinguish approval, package download, and an external filing. The
direct feature-local solution is to retain the existing reporting approval and
submission records, add package and acknowledgement facts, and make the
database own the explicit state transition to an actual filing.

## Selected patterns

- A focused signing/storage adapter exists because Node cryptography and
  Supabase Storage are external boundaries with distinct failure behaviour.
- Immutable reporting facts and an idempotent command record exist because
  package generation and filing need a durable audit trail and safe retries.
- A deterministic STORE-ZIP is reused from tenant export rather than adding a
  generic archive framework.

No global workflow engine, event bus, signing framework, or new role system is
introduced.

## Data and tenant boundaries

The authenticated request supplies the organization and actor. Every RPC is
organization-first, locks referenced approval/package/stage rows, and checks
tenant ownership, permission, active membership, proof expiry, exact
revision/hash, and idempotency. The actual filing, deadline anchor, timeline,
and audit fact share one database transaction. Storage is private, object paths
are opaque and never returned, and a successful storage upload must be
finalized transactionally before it is downloadable.

## API and frontend boundaries

Reporting contracts own all JSON and multipart metadata. The controller parses
path, body and multipart fields, delegates to use cases, and returns only
parsed success responses. Web transport validates outgoing input and returned
responses. The functional reporting editor separates approval, package,
external filing and evidence export; entered filing fields remain locally held
on recoverable errors.

## Failure modes and rollback

Expired/replayed proofs, stale packages, changed drafts, cross-tenant IDs,
revoked permissions, duplicate filings, invalid receipts and storage failures
fail closed without marking a stage submitted. A failed upload produces no
downloadable package and can safely be retried. Deploy additive migration and
generated types first, API second, web last. Roll back API/web before database;
historical and newly durable evidence stays intact.
