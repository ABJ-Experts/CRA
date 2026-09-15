# M6 ENISA SRP readiness

## Decision and current evidence

Automated ENISA SRP transport is deliberately unavailable. ENISA's CRA SRP
FAQ, updated 10 September 2026, states that no API is available in the
initial SRP release and that notifications must be submitted through the
platform interface. The FAQ also requires personal EU Login accounts with MFA
for Assigned Representatives. Source:
https://www.enisa.europa.eu/topics/product-security/single-reporting-platform-srp/frequently-asked-questions

The reporting editor therefore directs users to the signed package and the
existing manual external-filing flow. It does not collect credentials, open a
portal, scrape an interface, or simulate an ENISA acknowledgement.

## Scope and preserved contracts

- In scope: make the unavailable integration boundary visible and repair the
  manual-evidence read model that remains the permanent fallback.
- Out of scope: provider transport, endpoint discovery, credential storage,
  portal automation, provider attempt records, and background filing.
- Preserved: explicit human approval, fresh filing reauthentication, immutable
  package/submission/acknowledgement facts, tenant isolation, `/api/v1`,
  session/JWKS behavior, and the existing permission model.

## Direct solution

No new application port, provider framework, configuration, API route, or
database table is needed while no machine contract exists. The UI is a
presentational notice adjacent to the existing manual controls. The durable
submission record receives a `recorded_at` timestamp so the evidence read API
does not rely on a nonexistent column and can distinguish the recorded fact
from the user-supplied external submission time.

## Conditions for a future transport increment

Do not begin provider transport until all of the following are attached and
reviewed: an official specification and version, supported operations and
endpoints, authentication and secret-delivery mechanism, sandbox fixtures,
provider idempotency and status-reconciliation behavior, acknowledgement
semantics, and an approved mapping from internal stage fields to SRP fields.

A future adapter must submit only an exact approved package, validate outbound
and inbound schemas, redact credentials, persist uncertain timeout outcomes
without replaying a filing, and leave manual filing usable throughout.

## Deployment and rollback

Deploy the additive database migration and generated types before API or web
changes. Roll back application code before the migration; immutable historical
evidence remains readable.
