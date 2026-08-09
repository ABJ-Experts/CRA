# Feature Design Template

Complete this document before introducing a new abstraction, provider, state
machine, cross-feature dependency, or persistent workflow. Delete instructional
text only after every decision is concrete.

## Scope and preserved contracts

- User outcome:
- In scope:
- Out of scope:
- Existing routes, response shapes, public signatures, cookie paths, database
  behavior, and UI states that must remain unchanged:

## Concrete problem

Describe the observed coupling, variation, lifecycle, recursive structure, or
external boundary. Include evidence from current code, failures, measurements,
or two real implementations.

## Why not simpler?

Show the direct implementation first and explain which requirement it cannot
satisfy. “Future-proofing” and a desire to use a named pattern are not evidence.

## Selected patterns

For each pattern, record:

- Pattern and concrete trigger:
- Participants in this feature:
- Dependency direction:
- Contract shared by implementations:
- Removal trigger if the variability disappears:

## Rejected patterns

Record nearby patterns considered and why each adds ceremony, coupling, hidden
state, or operational risk.

## Data and tenant boundaries

- Verified source of user and organization identity:
- Every service-role query and its explicit organization filter:
- Transaction/atomicity boundary:
- Idempotency and concurrency behavior:
- Additive migration, generated types, deploy order, and rollback compatibility:

## API boundary contracts

- Feature contract folder and request/query/parameter schemas:
- Success response schema and parsed `z.output` type:
- Nest input pipes and `@ZodResponse` / `@NonJsonResponse` declaration:
- Browser `inputSchema` and response `schema` call sites:
- Compatibility behavior for transforms, defaults, unknown keys, and errors:

## Frontend logic and rendering

- Functional rendering components:
- Plain `.ts` logic classes and the concrete dependency/lifecycle they own:
- Pure policies kept as immutable functions:
- Composition root and test seam for every class instance:

## Failure modes

List database, provider, network, JWKS, SMTP, duplicate request, stale state,
invalid transition, authorization, cancellation, and partial-side-effect
failures relevant to this feature. State whether each fails closed, retries,
compensates, or returns a stable error.

## Tests and observability

List the failing characterization test first, then contract, unit, integration,
E2E, concurrency, failure-injection, live-stack, and coverage checks. Include
logs/metrics that distinguish invalid user input from infrastructure outages
without leaking secrets.

## Rollback

State the code, configuration, migration, and data rollback path. Database work
uses expand/deploy/contract sequencing so the previous API can run safely after
the additive migration.

## Review checklist

- [ ] The direct solution was considered first.
- [ ] Every selected pattern has a present-tense trigger and a contract test.
- [ ] No request, user, tenant, or session state is global.
- [ ] Controllers/pages contain no provider query or domain decision.
- [ ] Domain/application layers do not import frameworks or concrete adapters.
- [ ] Boundary input and external responses are schema-validated.
- [ ] Wire schemas and parsed `z.output` types live in separate feature folders.
- [ ] Every JSON route and browser request parses both applicable directions.
- [ ] JSX is functional; any logic class has a real dependency or lifecycle trigger.
- [ ] Security-critical effects are synchronous or transactionally durable.
- [ ] Focused coverage for new/materially changed modules is at least 80%.
- [ ] Compatibility and live-stack gates are listed.
