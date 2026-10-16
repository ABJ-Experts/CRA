# M15-06 preflighted upgrades and signed offline releases

## Scope and preserved contracts

Deliver guided single-host Linux Compose upgrades from mounted signed media.
Application images and forward-only compatible application migrations may change;
PostgreSQL, Auth, REST, Storage and the independent supervisor remain pinned.
Rollback replaces compatible images only. It never restores source data, reverses
migrations, resets queues, changes approvals, or rewinds security/licence state.
Preserve `/api/v1`, cookies/JWKS, frozen auth actions, zero epoch skew, permission
resolution, source-domain retention/holds and menu/mock behavior.

## Concrete problem

The repository has verified isolated backup tooling but no application deployment
unit, release trust protocol or restart-safe upgrade controller. Backup verification
quarantines and destroys its disposable target; it is not a production restore.
Backup capture's short SQL fence cannot be held during DDL or an upgrade outage.

## Why not simpler?

A shell script or API-owned job loses control when images stop or the host restarts.
An application table cannot independently authorize replacing the application that
owns it. Existing backup runs and framework-upgrade records have unrelated frozen
semantics. Use no new source tables, columns or foreign keys.

## Selected patterns

- Existing adapter/port composition: private controller -> use cases -> host
  control/deployment ports -> Linux adapter. Concrete trigger: privileged Docker
  and migration operations must stay outside tenant ingress.
- A focused durable state machine: authenticated append-only host journal records
  intent before effects and results after them. Concrete trigger: restart between
  migration commit, image activation and exposure.
- Functional operational UI with injected gateway, inheriting the operator shell.
- Share pure contracts; retain narrow provider-specific infrastructure. Remove a
  port if its external boundary disappears, not by adding a workflow framework.

## Rejected patterns

No generic workflow framework, event/command bus, new database job catalogue,
bundle-provided Compose/scripts, browser upload subsystem, platform forks,
production restore adapter or infrastructure-version upgrades.

## Data and tenant boundaries

Instance-bound mounted mTLS grants authorize view/stage/apply/rollback separately.
Tenant ownership and backup grants confer no deployment authority. The executor
owns private mounts, trust and credentials; normal API/web containers do not.
All journal/control responses cross strict shared schemas. No raw environment,
credentials, tenant payloads, filesystem paths or native stderr enter reports.

The stable journal sits outside release, database, object, media and disposable
restore roots. Atomic flushes, exclusive execution and authenticated monotonic
records survive process/image replacement. Entire-host rollback resistance needs
an independently retained authority checkpoint; local authentication is not TPM
or hardware-backed rollback protection.

## API boundary contracts

Feature-first contracts: `@repo/contracts/upgrades/schemas` and `/types`.
Private routes: `/api/v1/operator/instances/:instanceId/upgrades`.
Capabilities/media, stage, preflight, runs, apply/reconcile/rollback and redacted
results use parsed input/output. Mutations carry durable idempotency identity and
optimistic version; apply additionally binds the fresh review fingerprint.
No tenant route or automatic mutation replay is added.

## Frontend logic and rendering

Extend the existing operator workbench. Preserve semantic tokens, `cn()`, shared
UI subpaths, readable focus and keyboard navigation. The explicit operational
brief takes precedence over marketing layouts, random typography, remote assets
or motion dependencies. Persist drafts during transient outages, invalidate
approval after scope/media/grant changes, and ignore late abandoned responses.

## Failure modes

Verify purpose-separated Ed25519 trust, exact bytes, content inventory, expansion
bounds and image platform/digests before effects. Stage immutable private copies.
Reject unknown paths, schema/ledger drift, unsafe migrations, missing backup/key,
inadequate resources, concurrent maintenance and unmanaged writers.

Close ingress, stop claims and positively acknowledge drained work. Unknown or
uncertain effects block advancement. Preserve source queue outcomes. Pin exact
verified backup material against cleanup. Journal exposure intent before any
worker start/ingress reopening; automatic rollback is pre-exposure only.
After exposure or uncertain compatibility retain maintenance and actionable
recovery evidence. Never silently restore data or claim an HTTP 200 is healthy.

## Tests and observability

TDD for contracts, signatures/archives, journal durability, preflight, lifecycle,
rollback, private authority and UI races. At least 80% branches/functions/lines/
statements for new/materially changed modules. Exercise failure injection,
duplicate/concurrent commands, restart after commit/lost acknowledgement,
revoked trust/grants, drain refusal and egress-denied operation.

Use disposable N/N-1/N-2 deployment fixtures, current owner auth/navigation
regressions, Playwright MCP desktop/mobile screenshots and database catalog/RLS
checks. Full qualification uses a separately provisioned Linux reference runner;
the current Docker allocation is approximately 3.8 GiB and shares live services.
Historical original-source missing object/capacity blockers are not repaired.

## Rollback

Deploy disabled by default. Provision mounts, pinned runtime, trust and independent
control authority before enablement. Retain exact previous compatible artifacts,
additive schema, backup holds, journal and sequence floor after failed candidates.
Unqualified real release paths stay blocked. Feature rollback disables control
while preserving evidence and maintenance decisions; do not remove journal or
apply destructive down migrations.
