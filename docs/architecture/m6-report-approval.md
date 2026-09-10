# M6 report approval and fresh reauthentication

## Scope and preserved contracts

- **User outcome:** an authorized person can approve and record a reporting
  stage submission only after a fresh, one-use reauthentication, while a
  drafter cannot approve their own content unless a separately authorized
  exception is recorded.
- **In scope:** reporting-specific proof issuance, approval state, exact draft
  revision/hash binding, default separation of duties, durable audit evidence,
  and the read-only approval view.
- **Out of scope:** changing Supabase authentication, cookie paths, MFA policy,
  background submission, or an external-regulator transport.
- **Preserved:** `/api/v1`, ES256/JWKS validation, refresh-cookie path,
  session revocation, existing lifecycle reauthentication grants, permission
  merge order, draft editing/template behavior, and existing submitted facts.

## Concrete problem

`submit_reporting_stage_draft_atomic` currently authorizes the drafter with
`can_edit_findings` and commits a submission. It has no fresh proof, report
submission permission, content digest, or separation-of-duties check. Reusing
the organization lifecycle grant would couple report approval to lifecycle
versions and its three fixed consumption actions.

## Why not simpler?

An AAL2/session-age check cannot prove that the user intentionally
reauthenticated for this exact report. Browser-held approval state can be
replayed or stale. A generic approval engine is unjustified: reporting is the
only current consumer with this exact draft/stage lifecycle.

## Selected patterns

- **Focused Supabase adapter and reporting port:** the web gateway calls shared
  Zod contracts; the controller delegates to the reporting use case; its
  repository invokes scoped SQL functions. Remove this layer if Supabase is no
  longer the reporting persistence boundary.
- **One-use action proof:** a reporting-owned proof row binds organization,
  actor, verified session, draft revision/content digest, expiry, and action.
  It exists because session age alone is explicitly insufficient. The proof is
  consumed in the same transaction as approval and audit evidence.
- **Immutable approval fact:** one approval record references the exact draft
  revision/hash and actor. It is deliberately not a generic workflow engine.

## Data and tenant boundaries

Identity, organization, and session ID come only from `RequestUser`, whose
guard verifies JWT, membership, session binding, and revocation. Every RPC
takes `p_organization_id` first; it locks and filters draft, stage, obligation,
membership, proof, approval, and audit rows by it. The transaction validates
the current draft digest/revision, effective permission, active membership,
proof expiry/one-use state, and SoD before consuming a proof and writing the
approval/submission/audit facts. A unique stage approval and row locks make
concurrent calls yield one success and one conflict.

The additive migration enables non-forced RLS, uses `public.users` FKs, pins
function search paths, and grants service-role execution explicitly. Deploy in
expand order (migration/types, API, web); rollback web/API first while retaining
durable approval evidence.

## API and UI boundaries

Contracts live under `@repo/contracts/reporting`. Bodies and path values are
parsed by Nest and successful responses by `@ZodResponse`; browser transport
validates outgoing and incoming values. The read-only panel presents the exact
draft content, provenance, validation state, digest/revision and SoD outcome.
It preserves entered credentials/reason only locally on recoverable errors;
credentials are never stored, logged, or returned.

## Failure modes and tests

Missing/replayed/expired proof, stale digest or revision, revoked membership,
tenant substitution, missing permission, self-approval without an authorized
reason, and concurrent approval fail closed without partial state. Provider
reauthentication failure returns a safe error. Tests cover contract parsing,
controller permission/session handling, SQL transaction/RLS behavior and the
browser conflict/forbidden/validation states.

## Review checklist

- [x] Direct session-only and lifecycle-grant reuse were rejected with current evidence.
- [x] Request/session/tenant identity stays server-authoritative.
- [x] Critical approval, proof consumption, and audit data share one transaction.
- [x] Controllers/pages remain free of provider queries and policy decisions.
- [ ] Focused, live, and browser checks completed.
