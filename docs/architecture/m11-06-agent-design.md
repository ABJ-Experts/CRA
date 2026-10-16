# M11-06 outbound-only agent design

## Scope and preserved contracts

FR-INT-007 and FR-INT-009 (BRD v2 p35) require a customer-hosted outbound-only
integration agent and least-privilege guidance. The integration matrix (p51)
describes customer-specific Teamcenter/Windchill mapping; it does not establish
turnkey vendor writeback. The operational surface follows the integration
screens on p55 and the V2 roadmap on pp67-68.

The agent reads one locally configured canonical source per connector and
submits product/release pages. It never listens on the customer host, executes
remote scripts, writes to the source, or provides a general proxy. SSO, SIEM,
storage, ENISA, and the M2 PLM engine remain with their domain owners.

Existing `/api/v1`, cookie/JWKS auth, RBAC merge order, mock namespace, and
`verifyAgentFrame` HMAC string stay intact. `ConnectorSyncWorker` retains the
reviewed dry-run/commit flow and its tenant-fair claims. `ConnectorPort.push`
keeps its server-to-provider meaning; agent submissions use a separate ingress.

## Concrete problem and selected design

`verify-agent-frame.ts` currently had a split `seen`/`record` in-memory nonce
cache and no ingress. A replica or restart could accept the same valid frame;
two concurrent calls could also both pass. The production nonce operation is
one PostgreSQL unique insert after HMAC verification. The local loopback double
implements the same atomic method for conformance tests.

The smallest existing storage path that preserves review is a staged agent page
read by an `on_prem_agent` `ConnectorPort` adapter. Building a second sync engine,
event bus, command channel, or vendor-specific PLM writer would duplicate the
existing durable plan/commit boundary. Three new tables hold the identity and
enrollment lifecycle, nonce ledger, and staged canonical pages; existing
`sync_runs`, plan items, cursors, and audit logs retain their current roles.

Presentation uses functional React and the `AgentsApi` gateway. Human API
controllers call agent use cases; agent ingress controllers call the same
application boundary after TLS and frame verification. Supabase repositories
implement organization-first methods. The agent host owns its local source
adapter and encrypted SQLite queue; the cloud never chooses its source URL,
path, or executable behavior.

## Trust, authorization, and data flow

An organization owner with connector edit permission issues a token bound to
one organization and connector for 15 minutes. The agent generates its own
private key and CSR; CRA issues a client certificate from its mounted agent CA
intermediate and a separate random HMAC key. Only encrypted token/key envelopes
are stored in Supabase. The private key and source credentials remain on the
customer host. Rotation is agent-initiated, with a maximum 24-hour previous-key
window; revocation is checked against the database for every frame.

The dedicated HTTPS ingress obtains the actual method/path and peer certificate
from its own TLS socket. It rejects an absent/invalid certificate for signed
frames, verifies the cert's issuer, fingerprint and SAN organization/connector,
then verifies HMAC over timestamp, nonce, body hash, method and path. A durable
consume-if-absent nonce operation prevents replay across replicas. Strict
versioned Zod parsing rejects unknown fields, malformed JSON, non-JSON content
type, oversize bodies, and out-of-window timestamps. Enrollment is the only
token-authenticated route; there is no agent command route.

One connector has one active agent identity and one ordered source stream.
Each page has a stable batch ID, sequence, source cursor and content hash. The
agent persists the encrypted page locally before sending. CRA stages a page
and its audit fact in one database transaction before ACK. Same ID and content
returns the original ACK; altered content or a sequence gap conflicts. A lost
ACK causes a retry with a fresh frame nonce and the same batch ID. The agent
advances its local checkpoint only in the transaction that records the ACK.
The sync worker reads the next staged sequence for the verified organization
and connector, plans it, and rechecks actor permissions and connector revision.
Existing SQL commits product effects, provenance/audit, and the sync cursor
atomically. It never writes to the internal source.

All service-role reads use organization and connector filters. Browser status
is presentational; owner and permission checks are server-side and fenced by
the current permission version. A revoked/disabled connector rejects frames,
prevents new claims, and invalidates old work through existing revision fences.

## API and UI boundaries

`@repo/contracts/connectors/schemas` owns human management inputs and outputs,
strict agent enrollment/frame schemas, and parsed wire types. Human routes are
`GET /connectors/:connectorId/agents`, `POST .../enrollments`, and
`POST .../:agentId/revoke` under `/api/v1`. Agent routes are
`POST /api/v1/agent/enroll` and `POST /api/v1/agent/frames` on the dedicated TLS
listener. Controllers parse consumed paths, queries and bodies and parse
successful responses; the browser supplies input and response schemas.

The connector detail has a separate agent branch showing enrollment, contact,
version/capabilities, backlog, safe error, staged-page status and sync runs.
The UI handles pending, empty, forbidden, offline, conflict and retry states,
uses locale dates and non-colour status labels, and does not cache enrollment
tokens in React Query. The catalogue gives read-only scope guidance when
customer privilege introspection is unavailable.

## Failure behavior and bounded operation

The agent is non-root. Its SQLite WAL queue uses durable transactions and
AES-GCM encrypted payloads with a service-account-only key. A full disk, source
replacement/truncation, invalid cursor, or source schema failure stops new
reads without dropping queued pages. Network, proxy and provider outages retry
with bounded backoff; the server's staged backlog cap returns backpressure.
The source adapter accepts only a locally approved NDJSON file or allowlisted
HTTPS GET target. It follows neither arbitrary redirects nor server commands.

Frames contain at most 200 records and 4 MiB. Source and server queues are
bounded; the worker continues tenant-fair claims. Errors exposed to operators
are fixed safe codes, never provider text or credentials. A disconnected agent
cannot block manual triage, reporting or evidence use. The agent runbook owns
TLS CONNECT proxy, egress, backup, install, upgrade, uninstall and recovery
steps; uninstall retains its queue and evidence unless explicitly removed.

## Tests, deployment, and rollback

Characterization tests protect the legacy connector and auth flows. Agent
tests cover strict contracts, wrong tenant/certificate, nonce concurrency,
expiry, rotation/revocation, idempotent batch ACK, out-of-order pages, crash
points, disk full, source change, outage and permission changes. SQL tests use
rolled-back fixtures and verify RLS/grants and atomic effects. Browser tests
exercise owner registration, status, review, rotation/revocation and keyboard
flows. Run focused coverage, live-stack integration, `pnpm verify`, DB lint,
Playwright, and load checks before release. Keep a BRD-to-test matrix and
observed residual risks in the operational runbook.

Deploy the additive migration and generated types before the API/ingress, then
the agent package and UI. Keep agent ingress disabled until its CA, cert/key
mounts, egress hostname and runbook are configured. Rollback disables agent
ingress and agents, retaining staged pages, keys/cert metadata and audit facts;
the previous API and browser remain compatible with additive tables. Do not
drop tables or erase customer evidence as a rollback shortcut.
