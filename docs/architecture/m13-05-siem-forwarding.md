# M13-05 SIEM forwarding design

## Scope and preserved contracts

Forward selected structural tenant audit facts to public HTTPS/TLS-syslog collectors in JSON/CEF. Future-only activation, stable event IDs, durable retry, safe history, explicit recipient-change treatment and reviewed replay. No global security/platform subscription, historical backfill, private route, plaintext, repair, deletion or exactly-once claim. Preserve all existing audit writers/canonical bytes, M13 explorer/range/export, M11 webhooks, API prefix/session/auth/RBAC/menu/mock contracts.

## Concrete problem

M11 NodeWebhookTransport is HTTPS JSON-only with mandatory product-event schemas. Its AES-GCM vault, DNS safety/pinning and retry primitives already solve credential/egress boundaries. M13-03 event visibility supplies source-owned tenant/product checks. SIEM needs two transport modes, two encodings, future-ledger cursor, independent authority and explicit unacknowledged syslog semantics.

## Why not simpler?

Sending from AuditService.log would couple best-effort writers to collector outage and lose restart identity. Reusing webhook tables requires fake connector/product records and incompatible protocol/payload fields. A direct durable three-table workflow meets the requirements without a new bus/framework/dependency.

## Selected patterns

- Adapter: Supabase/private RPC and Node TLS/HTTPS differ from inward-owned delivery/storage ports. Application owns interfaces; adapters implement them. Contract-test transport modes and provider parse/errors. Remove adapters only if external provider boundaries disappear.
- Facade: focused AuditSiemGateway/application entry points coordinate config/history/replay without provider calls in pages/controllers. Tests pin public contracts; replace with direct functions if coordination disappears.
- Immutable commands/persisted states: replayable config and leased delivery require operation identity, optimistic versions and fences. No command bus or class hierarchy; transitions are SQL transactions plus pure policies.
- Strategy: JSON/CEF and HTTPS/TLS syslog are real variants with shared structural event/delivery contracts and four-pairing tests. No speculative variants.

## Rejected patterns

No global singleton with tenant state, event bus, abstract factory, observer-driven critical evidence, new connector framework or transport-security fallback. Native Node and existing vault suffice.

## Data and tenant boundaries

Verified request user/org exclusively from auth. Every service-role RPC accepts org first and filters jobs/config/attempts/source relationships. Enabling user must remain active with audit/export/connector/source/product authority. All related product IDs resolve through source rows, never metadata. Unknown/deleted evidence fails closed. Browser state is presentation only.

Exactly three private non-forced-RLS tables: siem_destinations, siem_deliveries, siem_delivery_attempts. Domain mutation, cursor staging and strict action-specific organization-less security receipt share transactions; these receipts are not forwarded. Operation UUID + keyed normalized-input digest enables durable replay/conflict without secret disclosure. Optimistic version and lease fences prevent stale writes. Dataset epoch/database identity invalidates prior work on restore.

Additive CLI migration and generated types first, API/worker paused second, web last. Classify workflow deployment-local; preserve historical migration-ledger discrepancies and original retention/legal-hold authorities.

## API boundary contracts

Shared runtime contracts audit/schemas/siem.schema.ts; z.output types audit/types/siem.types.ts. Routes /api/v1/audit/siem catalogue,destinations,credentials,test,enable,disable,deliveries,replay-preview/replay. Nest Zod inputs and ZodResponse; gateway inputSchema/schema. Strict unknown-key rejection, normalized endpoint inputs, decimal sequence strings. No POST/PATCH auto-refresh replay; no non-JSON public response.

## Frontend logic and rendering

Functional /connectors/siem rendering and focused configuration/credentials/history/replay components. Injected AuditSiemGateway owns transport; hooks coordinate lifecycle and clear tenant-bound state. Pure immutable projection/retry/format policies. Existing transport/query composition and injected fake seams for tests; no React classes or global identity state.

## Failure modes

DB/receipt failure rolls back and blocks disclosure. Source/authority revocation pauses before send. Stale versions/changed operation criteria conflict. DNS/private address/TLS/credential failures never downgrade. Network/408/425/429/retryable5xx retry boundedly; permanent/exhausted failures remain visible. HTTP2xx is acceptance only; syslog writes are unacknowledged. Crash-after-send can duplicate stable event ID. Recipient changes fence/cancel old work; reviewed replay projects current authorized source for currentrecipient. Byte/cap limits stop without silent truncation/cursorloss. Dataset mismatch pauses. Explicit disable is audited intentional future stop, not infrastructure outage.

## Tests and observability

First RED tests cover strict structural contracts/secret canaries, SQLprivategrants/receiptrollback/cursor and lease fencing, transport4pairings, APIpermission/provider parsing and gateway/UIstates. Follow with source/product/identity revocation, DNSpinning, UnicodeCEF/framing, response failures, credentialrotation/replayrecipient, restarts/concurrency, liveRLS/API/browser and >=80% allmetrics. Safe reason codes/status/age/retry counts; no bodies/credentials/bearer URLs/network identifiers inlogs. Benchmarks and egressblocking on disposable/ownedfixtures; no retainedevidence tampering.

## Rollback

Disable SIEM worker/routes/UI and retain additive tables, durable receipts, credentials and source evidence. Previous code runs with additive schema. No destructive rollback, repair, backfill or purge.

## Review checklist

- [x] Direct solution considered and rejected on durability/protocol grounds.
- [x] Selected patterns have present requirements and contract tests assigned.
- [x] No global tenant/session state; inward-owned ports and thin presentation.
- [x] Runtime/wire schemas separate from z.output types; both JSON directions parsed.
- [x] Critical facts transactional; explicit organization/source checks.
- [x] >=80% all coverage metrics and live/compatibility gates pass.
- [x] Independent review has no unresolved critical/high findings.
