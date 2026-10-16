# M13-05 Tenant-scoped SIEM Forwarding Implementation Plan

> **For agentic workers:** Use subagent-driven development with independently owned contracts/policies, database, transport, API/worker and UI slices. Each follows failing test -> implementation -> coverage -> independent review. Preserve others' work.

**Goal:** Deliver explicitly selected authorized tenant audit events to public customer collectors over HTTPS or TLS syslog in JSON/CEF with durable retry, stable event identity, lag/history and reviewed replay.

**Architecture:** Functional React -> injected AuditSiemGateway -> authenticated transport -> feature-first shared Zod contracts -> thin Nest controller -> application policy/port -> Supabase adapter. Reuse M11 credential and transport safety primitives and M13 source authorization; separate forwarding persistence from webhook/export workflows.

**Tech Stack:** Existing Next.js/React, NestJS, Zod, Supabase/PostgreSQL, Node HTTPS/TLS/crypto, Vitest/Jest/Playwright. No new dependencies.

**Spec:** User-approved M13-05 plan, FR-AUD-012; CRA-Sentinel Technical BRD v2.0 pages 36-37/51/54-56; docs/architecture/m13-05-siem-forwarding.md.

## Global Constraints

- Baseline milestone-1 144883d24b5c32167fbce0ec12466d96bfe78f30, clean and remote aligned.
- Public collectors only. HTTPS bearer or mTLS; TLS syslog mTLS. No UDP, plaintext, anonymous forwarding, private routing, security downgrade or new dependencies.
- Future events on initial enablement. Tenant-only ledger; organization-less security/platform events and forwarding receipts excluded.
- Structural fields only. No before/after, content, metadata, free text, emails, network identifiers, canonical proofs or credentials.
- User-bound authority rechecked before send; explicit authorized takeover on revocation.
- Stable event UUID, at-least-once duplicates, no authenticity/exactly-once claim.
- Preserve /api/v1, narrow refresh cookie, ES256/JWKS, zero session skew, permission merge order, auth-actions, menu/MSW and M1-M13 behavior. No POST/PATCH refresh replay.
- CLI additive migrations/types only, non-forced RLS, explicit grants/search_path. No resets, blanket migration replay, ledger repair, source changes or automatic purges.
- Minimum 80% statements/branches/functions/lines for new/materially changed modules; RED/GREEN required.

## Review Focus

1. Secret canaries and unknown audit producers must never enter payloads (contracts/policy tests).
2. Authorization revoked between claim and socket creation must block send (worker/transport tests).
3. Collector accepted but worker crashed must replay the same event identity (durability tests).
4. Recipient changes must cancel old work and require reviewed replay (transaction/lifecycle tests).
5. Syslog successful socket writes must never be labelled confirmed receipt (transport/UI tests).

## Task 1: Contracts and pure policies

**Ownership:** packages/contracts/src/audit/{schemas,types}/siem.* plus barrels/tests; apps/api/src/audit/siem/domain.

**Interfaces:** siem*Schema and Siem* z.output types for catalogue, destination create/update/operations/credentials/public state, deliveries/paging/replay, structural events. Endpoint config {name,transport:'https'|'syslog_tls',format:'json'|'cef',endpoint,eventClasses,productIds}. Mutations requestId UUID and expectedVersion (creation also destinationId UUID). Projection/CEF/JSON functions never consume arbitrary content.

- [x] Write/run RED tests for strict payload fields, closed class/action/resource registry, secret canaries, public endpoint syntax, product IDs <=100, version/replay invariants and decimal sequences.
- [x] Implement runtime schemas/trusted types, actual-producer catalogue, fail-closed immutable source policy, JSON/CEF formatting (8 KiB maximum; no truncation).
- [x] Run GREEN focused contracts/domain tests and >=80% all coverage metrics.

## Task 2: Database workflow

**Ownership:** CLI-created migration(s), infrastructure SQL tests, export-registry classification, generated type copies via db:types.

**Interfaces:** private organization-first SIEM RPCs for configuration, credentials/lifecycle, reads, replay, staging, claims, reauthorization and fenced completion; coordinate exact names with API slice before implementation.

- [x] Confirm CRA local identity through MCP/config and catalog; no unrelated cloud access. Read-only all-table inventory and relevant grants/functions/indexes/source relationships.
- [x] Write/run RED SQL tests for three-table existence, private grants, receipts/rollback, idempotency/conflict, cursor atomicity, source/product authorization, revoked authority, lease/revision fencing and epochs.
- [x] Create exactly siem_destinations, siem_deliveries, siem_delivery_attempts. Existing audit_logs action-specific security receipts are durable unchained orgNULL, strict structural metadata and keyed command digests; no fourth command table or evictable operation map.
- [x] Transactionally stage references and advance sequence cursor; separate scan from delivery progress. Fresh permission/source checks before payload disclosure, aggregates and delivery. Resolve every product relationship from trusted source rows.
- [x] Capture head on initial enablement. Max10 destinations/tenant; stage250 events/1MiB; max10000 outstanding/destination stops cursor advancement.
- [x] Persist dataset epoch/database identity; pause on mismatch. Non-forced RLS, private table access, explicit RPC grants/search_path, FK public.users, tenant indexes and deployment-local registry.
- [x] Apply only owned additive migrations locally, generate types using existing command, run GREEN SQL/RLS/concurrency and lint checks. Preserve historical ledger discrepancies.

## Task 3: Transport and vault

**Ownership:** apps/api/src/audit/siem/infrastructure/{node-siem-transport,siem-vault}.* and fixture/runbook.

- [x] RED tests all four JSON/CEF x HTTPS/syslog modes, Unicode framing, TLS/mTLS validation, bearer credentials, DNS pinning, redirects, malformed headers, rate limit, outage, rotation, ambiguous receipt and secret exclusions.
- [x] Reuse AES-GCM vault with siem:destination identity AAD. Encrypt credentials/custom CA; decrypt only in delivery adapter; never return/log/cache plaintext credentials.
- [x] HTTPS POST, JSON or UTF8 CEF, 10s timeout, bounded headers, no redirects/response-body logs; 2xx means accepted. Syslog RFC5424 with RFC5425 octet-count framing,6514 default, minTLS1.2, mTLS, SNI/certificate checks; successful writes mean sent_unacknowledged.
- [x] Exact deployment SIEM_APPROVED_TARGETS_JSON {protocol,hostname,port} allowlist. No IP literals/userinfo/query/fragment/private DNS. Re-resolve/pin socket each send without weakening existing webhook rules.
- [x] Controlled TLS collector fixture for deduplication and injected failures; GREEN tests/coverage; no live customer sends.

## Task 4: Application/API/worker

**Ownership:** apps/api/src/audit/siem application, repository adapter, controller/module, worker/entrypoint/package command/tests.

**Routes:** /api/v1/audit/siem GET catalogue; GET/POST destinations; GET/PATCH destinations/:id; POST credentials,credentials/revoke,test,enable,disable; GET deliveries,deliveries/:deliveryId; POST deliveries/:deliveryId/replay-preview,replay.

- [x] RED tests permission coverage, tenant forgery, strict provider parsing, durable audit failure before disclosure, mutation replay/conflict, revoked authority, restart/crash and before-send checks.
- [x] Reads require can_view_audit + can_view_connectors; creation also can_create_connectors + can_export_audit; edits/test/enable/replay require can_edit_connectors + both audit permissions; credentials additionally owner role.
- [x] Thin controller parses body/query/path and JSON response. Web inputSchema/schema preserves GET refresh and no POST/PATCH replay. History50 default200max tenant-bound keyset cursor.
- [x] Worker command worker:audit-siem --once. Two global slots/one tenant, round-robin,60s fenced leases,6attempts, jitter5-300s, boundedRetryAfter,24h retry window. Retry network/408/425/429/retryable5xx; terminal failures retained.
- [x] Explicit disable cancels/fences pending and reenable starts currenthead. Infrastructure/revoked authority pauses preservecursor/backlog; explicit takeover reauthorizes. Recipient/scope/format changes require cancel_pending_start_future + reason, fencework,newboundary,test+enable.
- [x] Credential rotation keepscursor/backlog but fencesfutureattempts. Datasetmismatch pauses. Replay preview binds currentrecipient/sourceprojection/version/digest, replayreason+confirmation; creates linked newdelivery stableeventID; never sendoldpayload blindly.
- [x] GREEN focused tests/coverage and independent security review.

## Task 5: Operational UI

**Ownership:** apps/web connectors/siem page, feature gateway/hooks/components/tests, catalogue/menu/nav/protectedroutes and authorized auditlink.

- [x] Read web AGENTS and installed Next guide, existing PRODUCT/DESIGN/craft-floor; no new visual world/fonts/GSAP/decorative imagery.
- [x] RED gateway/hook/component tests for schema calls, secret clearing, draft preservation, orgswitch, UUID retention, all states and uncertainty labels.
- [x] Implement functional /connectors/siem + AuditSiemGateway. Config/credential rotation/test/enable/disable, authorized history/lag/safe failures, reviewed replay and currentauthority. Secret mutations do not retain credentials in query cache/variables.
- [x] Existing semantic tokens/cn/shared subpaths, accessible labels/focus/status announcements/tables, reduced motion/locale timestamps. Loading/empty/forbidden/conflict/paused/degraded/retry. Clear tenant-bound state; preserve public drafts on transient errors.
- [x] GREEN tests/coverage, finalizedetector once and desktop/mobile inspect/fix/confirm.

## Completion and deployment

- [x] Independent reviews with no unresolved critical/high findings; requirement-to-test mapping.
- [x] Focused contracts/API/web, infrastructure SQL/RLS/concurrency, pnpm verify, applicable pnpm test:live. Retry MCP advisors/logs and record unavailability accurately.
- [x] Playwright MCP only CRA development with seeded owner/restricted users; screenshots of config/delivery/replay/errors; preserve other sites' cookies/storage.
- [ ] Benchmark disposable10k/100k/1m synthetic events, outages/mixedtenants/memory/recovery/readp95<400ms/p99<1000ms; actualegressblocked coreoperation. Record measured limitations, never assume pass.
- [x] Deploy schema/types -> pausedAPI/worker -> UI -> testcollector -> explicitenable. Rollback disable routes/worker/UI retainingtables,credentials/auditreceipts/sourceevidence. Runbooks collector/rotation/restore/migration/rollback and residualrisks. No authenticity/zero-bug/legalcertification claims.

Execution evidence and explicit residual limits: [completion record](../../architecture/evidence/m13-05-siem-forwarding.md). Production deployment was not performed; the deployment checkbox denotes the documented sequence/runbooks and local additive schema application. Playwright MCP was initially unavailable; the later isolated MCP retest and original installed-runner evidence are both recorded.

Completion gates: pnpm verify and pnpm test:live passed. Browser runner passed Chromium/Firefox/WebKit; the MCP-specific gate was subsequently satisfied through an isolated local MCP session. Benchmark checkbox remains open for unmeasured sustained wire/production-load/worker-peak guarantees, as recorded in the evidence.

Follow-up MCP-specific gate: passed using a separate owned local Playwright MCP session. The original configured bridge remains unavailable. Evidence: [MCP retest](../../architecture/evidence/m13-05/playwright-mcp-retest.md).
