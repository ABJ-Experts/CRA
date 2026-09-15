# ADR-0002: Connector trust and synchronization safety model

- Status: Accepted
- Date: 2026-08-19
- Owners: CRA maintainers

## Context

M2 V2 adds PLM/ALM product-structure synchronization (BRD FR-PROD-012) as a
new bounded context, `apps/api/src/connectors/`: a vendor-neutral connector
framework with a fixture-backed reference adapter. No real PLM/ALM vendor is
integrated this pass. The BRD conditionally requires an on-premises agent
"where customer networks or sensitive PLM data require it," but no real
customer network exists yet to deploy an agent against.

That conditional framing is exactly the trap ADR-0001 warns about: a decision
that gets made implicitly, feature by feature, once an agent is finally
needed, instead of once, deliberately, ahead of time. An agent channel is also
unlike anything else this codebase currently authenticates. Browser sessions
carry a first-party cookie the backend itself issued; service-role database
access is scoped by an `orgId` argument the API controls end to end. A
connector agent is a process on hardware CRA does not own, reachable over a
network CRA cannot inspect, sending frames unattended and on its own schedule.
It is the first channel where unauthenticated, remote-network traffic can
reach the API surface at all, so its trust model has to be settled as a
decision record before any code depends on it, not discovered while wiring up
the first real deployment.

This pass records that trust model and has a local-loopback verifier test
double for the application-frame portion. It does not deliver a
production-deployable agent binary, public agent ingress, certificate issuer,
or real customer-network deployment — there is nothing to deploy it against
yet. The code currently verifies canonical JSON frame size/type, timestamp,
nonce replay, HMAC, key age/revocation, and organization/connector binding.
It does **not** terminate or validate mTLS itself because no agent ingress
exists; a deployment is non-compliant until its ingress independently enforces
the mTLS requirements below and supplies a shared nonce store.

## Decision

The agent is always the connecting party. When a production agent is approved,
it dials outbound from the customer network to CRA's sync ingress; CRA never
opens a connection into a network it does not control. This is the same shape
already trusted for self-hosted CI runners and reverse-ETL agents, and it asks
nothing of a customer firewall beyond a single egress allow rule.

Every approved production connection requires both mutual TLS and per-frame
HMAC signing, and neither is treated as sufficient on its own. mTLS binds
channel-level identity to a private key held in the OS keystore or a TPM and
gives confidentiality in transit. Independently, every frame is signed:
HMAC-SHA256 over
`(timestamp, nonce, sha256(body), method, path)` using a key issued to that
agent, checked against a ±120 second clock-skew window, with a server-side
nonce cache that rejects any reused `(agent_id, nonce)` pair. Both checks are
required because corporate networks — the deployment environment this targets
— routinely run TLS-inspecting egress proxies that re-terminate TLS at the
boundary. A signature that lived only at the channel layer would not survive
that re-termination, so message-level authenticity has to be proven
independently of the channel. The reverse gap is just as real: a bearer token
or HMAC key alone, over plain HTTPS, gives up the private-key barrier mTLS
puts between a compromised agent host and a usable credential. Each mechanism
closes a hole the other leaves open; neither substitutes for the other.

Agent identity is established once, deliberately, and bound to an
organization from that point forward. An org owner issues a one-time,
single-use enrollment token with a 15-minute TTL. The future agent exchanges it
— still over an outbound-initiated connection — for a client certificate signed
by CRA's agent CA, with `organization_id` and `connector_id` embedded in the
certificate's SAN, plus an initial HMAC signing key. Every subsequent frame
must be checked three ways at once: the certificate's claims, the signing key's
bound org and connector, and the org and connector the frame's own payload
claims to act on all have to agree. Any mismatch is a hard reject, logged as an
audited security event, and counts toward an auto-suspend threshold.

Customer PLM/ALM credentials never leave the customer network when an agent is
in the path. The agent holds and uses them locally; CRA's server only ever
receives normalized product-structure payloads. The agent's own secrets — its
mTLS private key, its HMAC signing key — live in an OS-native secret store on
the agent host: a 0600-permission file under a dedicated service account, or a
platform keystore, and never in logs or job payloads. The direct-SaaS
reference adapter has no agent and no customer network in its path, but it
follows the same reference-indirection principle on CRA's own side: a
connector's stored configuration holds only an opaque secret reference, the
actual credential lives in a dedicated encrypted-at-rest store, and it is
resolved only by the sync worker process. The controller layer never sees it,
the browser never sees it, and no route in the API surface reads or exports
it.

Every credential is scoped to exactly one `(organization_id, connector_id)`
pair — never org-wide, never reusable across connectors. HMAC signing keys
carry a mandatory maximum age of 90 days; a frame signed with an over-age key
is rejected with a distinct `key_rotation_required` outcome rather than being
silently accepted past its intended lifetime. Rotation runs both the old and
new key as active for a 24-hour grace window so rotating a key is never an
outage. Revocation is synchronous: it is checked against a revocation list on
every frame, so the very next frame sent under a revoked identity is rejected,
not eventually reconciled, and revocation also cancels any sync run already
in flight under that identity, audit-logged.

Payload limits treat this as hostile input by default. Body size is capped per
frame — 4 MiB is proposed — with larger batches paginated across frames by the
agent itself; the same shape as this codebase's existing
`PRODUCT_COMPLIANCE_MAX_SYNC_INSPECT_BYTES` ceiling for the conceptually
similar problem of bounding an external payload before it is processed. Every
frame is validated against a versioned schema before any processing begins,
and unknown top-level fields are rejected rather than silently dropped.
Content-type must be exactly `application/json`; anything else is a hard 415,
never sniffed. Where compression is permitted at all, decompression enforces
a maximum compressed-to-decompressed ratio — 1:50 is proposed — and an
absolute decompressed byte ceiling, using streaming decompression with a hard
cutoff rather than decompressing fully and checking afterward. This is a new
class of risk for this codebase: nothing in CRA's existing upload paths has
had to defend against a zip bomb, because nothing else accepts content from a
remote, unattended, attacker-adjacent network the way an agent channel does.

This pass proves only the implemented application-frame model rather than
shipping an agent. The reference implementation is a local-loopback test
double, not a production artifact — no installer, no PLM connector logic, no
auto-update, no customer-facing configuration, and no test-CA/mTLS handshake.
It drives the literal HMAC/replay verifier rather than a mocked verifier. It
demonstrates: a correctly signed frame from an enrolled loopback identity is
accepted; a replayed `(agent_id, nonce)` pair is rejected; a frame signed with
a revoked or over-age key is rejected; a frame whose organization/connector
binding does not match the target is rejected; a frame outside the clock-skew
window is rejected; and an oversized, wrongly typed, malformed, or forged
payload is rejected before business logic runs. Production ingress has an
additional mTLS conformance requirement before it may accept a customer agent.

### Field authority preview and commit gate

A connector may never rely on implicit field ownership. The active
`field_authority_policies` row is scoped by organization, connector, entity
type, and canonical field, and its supersession chain is the audit history.
The no-row default is `manual_only`. A protected field cannot be
`external_authoritative`; a CRA-authoritative field produces an outbound
difference/warning or conflict, not a silent external write.

Changing a policy is owner plus `can_edit_connectors` work. The API first
offers a bounded, read-only impact preview. Its digest binds the proposed
policy, mapping version, and sampled canonical values; policy persistence
recomputes the digest against scoped current state and rejects a stale preview.
The preview itself cannot create a policy, conflict, product, run, or cursor.
The first commit after a material policy/mapping change needs a new dry run.
Dry-run plan items and conflict rows carry the policy identifier/snapshot and
permitted action so a later reviewer can see the exact decision basis.

### Cursor, plan, and commit semantics

`sync_runs` and `sync_connector_cursors` are database-authoritative, not
process-local state. The worker may pull and construct canonical records but
must save the plan and fetch-content hash before a human or approved automatic
commit can proceed. Commit identifies the exact adapter version, mapping
version, authority policy basis, fetched content hash, cursor, and idempotency
key. It replays the durable plan; it must not fetch or recompute a different
plan after review.

The database commit transaction applies the corresponding canonical
product/release/relationship operations, marks applied plan items, records
audit/provenance facts, transitions the run, and advances the connector cursor
as one unit. If any effect fails, the cursor does not move. Repeated pages,
events, network retries, and worker restart are safe through active-run
exclusivity, content/idempotency identity, applied-row markers, and optimistic
versions. Cursor expiry/backward movement is not repaired by guessing: the run
fails safely and an approved full reconciliation uses the same dry-run/conflict
gate. A full reconciliation cannot overwrite an open reviewed conflict.

Claiming work is organization-scoped. A worker obtains due organizations, then
claims at most one run for each organization per round through an org-first
claim RPC. Page/batch and cycle limits remain bounded. This gives one tenant's
backlog no right to claim other tenants' capacity or data. Rate limiting and
provider outage transition durable retry/circuit state and leave the last known
registry accessible.

### Embedded hierarchy semantics

The completion increment reserves `parentExternalId` as the canonical product
field for a vendor-neutral embedded hierarchy. It means the parent product
contains the current child product and maps only to M2's existing `embedded`
product relationship. It is not a generic relationship import, a variant,
release, quantity, baseline, or custom vendor relation.

Both child and parent must resolve through exactly one active mapping with the
same organization and connector. A missing/ambiguous parent, unsupported
hierarchy capability, stale graph version, manual/protected policy, or M2
cycle/depth failure yields an issue or conflict and performs no graph write.
An approved `accept_external` resolution uses the existing M2 relationship
preview/create/end application boundary and records connector/run provenance;
`keep_cra` retains the current relation; `enter_manual_value` requires an
explicit mapped CRA parent and reason. Connector work may supersede only an
edge marked with its own bounded connector provenance. It never changes a
manual edge and never infers an end/delete from source absence. A confirmed
tombstone is still subject to product retention/legal-hold archive rules and
cannot physically delete a protected CRA product, release, baseline, or edge.

### Agent lifecycle and incident runbooks

- **Disablement:** disabling/archive of a connector stops new claim and future
  batches. An already-running transaction reaches only its normal atomic
  outcome; it cannot silently enqueue continuation work. Operators record the
  outcome and require a new test/dry run before re-enablement.
- **Key/secret rotation:** agent HMAC keys have a maximum 90-day age. A
  replacement key overlaps the old key for no more than 24 hours. Connector
  provider secrets rotate through a new encrypted secret row/reference, never a
  job payload or configuration export. Validation uses connection test plus dry
  run before a commit.
- **Revocation/incident:** revocation is checked before every frame and rejects
  the next frame; operators disable the bound connector, cancel/fail future
  work, preserve redacted audit identifiers, rotate enrollment/signing/provider
  credentials, verify replay rejection, and re-enroll only after review. No
  secret, raw frame, or provider payload is copied into incident notes.
- **Provider outage and dead letter:** outage/rate limit follows bounded
  exponential retry and circuit-breaker state. After retry exhaustion the run
  is a reviewable failed/dead-letter item; it never blocks manual product,
  triage, reporting, or evidence access. Recovery is connection test -> fresh
  dry run -> review -> commit.
- **Reconciliation/migration:** adapter or mapping migration begins with a
  preview and full dry run. Cursor loss/expiry or a suspect provider snapshot
  uses full reconciliation rather than a guessed cursor. Additive migrations
  and forward repair preserve old API compatibility and retained provenance.
- **Air-gapped workflow:** if a customer cannot make the outbound connection,
  an approved offline bundle must be canonical-schema validated, encrypted and
  signed with replay protection, organization/connector bound, and submitted to
  the same dry-run/commit path. It is not a direct customer-database tunnel.

## Consequences

- The production-deployable agent binary, its installer, PLM-specific
  connector logic inside the agent, customer-facing configuration UX, and
  auto-update are explicitly out of scope this pass. They need their own ADR
  once a real customer network exists to build against, matching the BRD's
  own conditional framing.
- The reference and conformance adapter ships as direct SaaS-to-SaaS, with no
  agent in the path; this trust model is validated in isolation, through the
  loopback double, rather than against a live deployment.
- A real agent will need agent-facing ingress and CA/certificate-issuance
  infrastructure that has no existing precedent anywhere in this repo. That is
  genuine net-new operational surface and needs an infra owner assigned ahead
  of that future build, even though nothing is deployed this pass.
- The loopback double runs the literal application-frame verifier rather than a
  reimplementation. A future ingress must add mTLS verification and a shared
  nonce store to that same decision path; it must not treat the in-memory cache
  or a local pure-function test as production multi-instance replay protection.

## Alternatives considered

### Inbound-initiated connections

Rejected. CRA would have to open connections into customer networks it does
not control and cannot audit, which means asking every customer to punch an
inbound firewall hole for CRA. Outbound-initiated is the established pattern
for this exact integration shape and asks nothing of the customer beyond a
single egress allow rule.

### mTLS only

Rejected. Corporate networks — the environment this agent is built for —
routinely run TLS-inspecting egress proxies that re-terminate TLS at the
boundary. A signature that exists only at the channel layer does not survive
that re-termination, so mTLS alone is fragile in precisely the environment it
is meant to secure.

### Bearer token or HMAC only, over plain HTTPS

Rejected. Without mTLS, compromising the agent host is enough to impersonate
it indefinitely. mTLS's private key, backed by the OS keystore or a TPM, is a
barrier a stolen bearer token or HMAC key alone does not provide.

### Ship a production agent binary this pass

Rejected. The BRD frames the on-premises agent as conditionally required
"where customer networks or sensitive PLM data require it," and no such
network exists yet to deploy against. Building an installer, auto-update, and
customer-facing configuration surface ahead of a real deployment target is
speculative scope this pass should not carry; the trust model can be settled
and proven now without it.

## Rollback

This is a contract-only decision. Reverting it removes documentation and the
loopback double plus its tests — there is no production agent, no
customer-facing surface, and no migration to unwind. If a later ADR supersedes
the mechanism itself (SPIFFE/SPIRE in place of custom mTLS plus HMAC, for
example), only the loopback double and the ingress verifier change; the
reference adapter never speaks this protocol and is unaffected either way.
