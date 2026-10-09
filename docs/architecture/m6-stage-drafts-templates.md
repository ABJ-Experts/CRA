# M6 collaborative reporting stage drafts

## Scope and preserved contracts

- User outcome: authorised responders collaboratively prepare a stage-specific report, see every field's origin, resolve concurrent edits safely, and reuse reviewed tenant family content.
- In scope: V1 drafts, immutable submission snapshots, prior-submission prepopulation, release-scoped Member States, field provenance, optimistic revisions with expiring locks, and V2 family templates.
- Out of scope: AI generation, automatic approval/submission, ENISA transport, changes to submitted reporting-stage metadata, and unrelated product changes.
- Preserved: `/api/v1`, reporting obligation/deadline APIs, existing permissions and custom-role machinery, narrow refresh cookie, JWT verification, audit callers, and mock passthrough.

## Concrete problem and direct solution

`reporting_obligation_stages` holds deadline metadata only. A JSON column on it cannot preserve immutable submitted content, prior-stage snapshots, template-version history, per-field provenance, or concurrent editing. The direct feature-local solution is reporting-owned draft, revision, submission, family-template, and template-version records, connected to the existing tenant-scoped obligation/stage/release records.

## Selected patterns

- Persistent state: draft lifecycle has editable, submitted, locked and conflicting states; SQL RPCs own transitions.
- Command record: save, lock, submit, and template operations require idempotency, expected revision, actor evidence and durable audit facts.
- Feature facade plus Supabase adapter: web/API contracts differ from RPC payloads.

No generic editor, lock service, workflow engine, event bus, AI provider, or new base role is introduced.

## Data and tenant boundaries

The existing auth guard supplies verified `RequestUser.id` and organisation. Every RPC accepts `p_organization_id` first and validates the obligation, stage, referenced product/release, actor membership, template, and prior submission in that tenant. Save/submit/template transactions atomically store revisions/snapshots, command idempotency, reporting timeline events, and durable audit facts. The migration is additive, enables non-forced RLS, grants only service role, pins function `search_path`, and is safe for old API/web code.

## API and frontend boundaries

Contracts stay in `@repo/contracts/reporting`; controllers parse every input and `@ZodResponse` every JSON output; web supplies input/output schemas. UI is a functional, compact reporting editor with accessible provenance labels, validation states, lock/conflict recovery, and local-input preservation. Mutations are never automatically replayed after refresh.

## Failure handling

Cross-tenant/deleted references fail as not found; revoked users and missing permissions fail closed; active locks return a stable locked outcome; stale versions return the current server draft for explicit reload/diff; expired locks can be reclaimed. Prepopulation reads only immutable prior submissions. Template application excludes event timestamps and is review-required. AI-origin fields require a named accepting user and timestamp; the editor remains fully usable without AI or external egress.

## Rollout and rollback

Deploy migration/generated types, API, then web. Roll back API/web first; additive draft/template evidence remains retained. No submitted snapshot is changed or deleted.
