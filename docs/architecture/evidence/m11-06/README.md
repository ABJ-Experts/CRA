# M11-06 implementation evidence

The target was `milestone-1` at `80c6703`; `8ec7fd5` is an ancestor. This change preserves M11-01 through M11-05. The local Supabase project is `cra` at `http://127.0.0.1:54321`.

## BRD to implementation and checks

| BRD reference | Implemented boundary | Regression evidence |
| --- | --- | --- |
| FR-INT-007, p35; V2 roadmap pp67-68 | Outbound Linux agent, non-root service/container, canonical file and allowlisted HTTPS readers, encrypted bounded SQLite queue, mTLS/HMAC push; no listener or command route | `apps/agent/src/*.spec.ts`, `apps/agent/src/transport.integration.spec.ts`, Docker/native SQLite smoke, `apps/agent/README.md` |
| FR-INT-009, p35; integration matrix p51 | Scoped enrollment, owner revocation, one ordered source per connector, replay ledger, stage/ACK idempotency, existing reviewed sync plan/commit | `apps/infrastructure/tests/m11-06-agent-trust.test.sql`, `apps/api/src/connectors/agent/*.spec.ts`, `apps/api/src/connectors/agent-adapter/agent-backed-adapter.spec.ts`, `apps/api/src/connectors/worker/connector-sync-worker.spec.ts` |
| Integration screens p55 | Connector catalogue/detail agent state, one-time token, safe health/backlog, staged pages, viewer read-only, recovery guidance | `apps/web/app/(workspace)/connectors/connector-agent-section.spec.tsx`, `apps/web/app/_features/connectors/agents.api.spec.ts`, `apps/web/e2e/m11-06-agent.spec.ts` and screenshots below |

The agent reads canonical product/release records only. Teamcenter and Windchill remain customer-specific catalogue references; M2 PLM owns source mappings and customer write enablement. SSO, SIEM, object storage, and ENISA remain with their domain owners.

## Wire and persistence references

- Shared request/response schemas and parsed types: `packages/contracts/src/connectors/schemas/agent.schema.ts`, `packages/contracts/src/connectors/types/agent.type.ts`.
- Human management: `GET /api/v1/connectors/:connectorId/agents`, `POST .../enrollments`, `POST .../:agentId/revoke` in `apps/api/src/connectors/agent/agent-management.controller.ts`.
- Dedicated HTTPS agent ingress: `POST /api/v1/agent/enroll` and `POST /api/v1/agent/frames` in `apps/api/src/connectors/agent/agent-ingress.controller.ts`; `apps/api/src/agent-main.ts` starts the separate listener.
- Atomic database work: the four `20261001*m11_06*.sql` migrations add `connector_agents`, `connector_agent_nonces`, `connector_agent_batches`, scoped RPCs and trigger. No existing tenant rows were backfilled or reset. Generated types are in both Supabase and API type files.
- Existing commit boundary: `apps/api/src/connectors/agent-adapter/agent-backed-adapter.ts` feeds staged pages to `ConnectorSyncWorker`; the existing SQL sync cursor transaction commits product changes and provenance together.

## Verification observations

- The isolated live mTLS smoke accepted enrollment, signed heartbeat and batch, returned the same durable ACK for a duplicate batch, rejected a duplicate nonce, accepted a rotated credential, and rejected a revoked credential. A separate concurrent replay check sent two identical signed frames over independent authenticated TLS sockets: exactly one returned `201`, the other `409 replay`, and Supabase recorded one nonce. All exact test-owned connectors and associated agent, nonce, batch, cursor and audit rows were removed.
- The live Playwright owner/viewer journey passed. It covers keyboard activation, one-time token hiding after reload, owner revocation, viewer authorization, and conflict after revocation. The 40-read/5-concurrent status check measured p95 **139.2 ms** and p99 **140.7 ms** on the local stack, below the p95 400 ms and p99 1000 ms targets ([raw result](agent-status-read-load.json)). This smoke check is not a production load guarantee. The test creates and removes its own organization and viewer account.
- `pnpm verify` passed repository lint, typecheck, architecture gates, unit tests and builds. `pnpm test:live` passed infrastructure SQL/RLS checks, API E2E (5 tests), and the auth shell journey (33 checks). File-scoped live Playwright runs passed M11-06 agent, M11 integration hub, auth refresh/lockout, and M1 organization onboarding. `pnpm --filter infrastructure run db:lint` passed with warnings only in older functions. The M11-06 SQL test is rollback-only.
- Agent coverage: 24 passing tests, 97.3% statements and 82.5% branches. Focused API agent coverage: 140 passing tests, 92.06% statements and 86.45% branches. The shared contract schema, API route architecture, and web component/gateway tests also pass.
- Supabase MCP confirms migration ledger through the pending-revocation repair, all three agent tables RLS-enabled and non-forced, explicit service-role read access, pinned function search paths, and zero leftover M11-06 agent/fixture rows. `supabase db diff` replays all M11-06 migrations; it reports older unrelated constraint/default-grant drift. The security advisor reports three informational [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) for the service-only agent tables, which intentionally deny direct client access. The performance advisor reports four informational [foreign-key index notices](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and one [unused expiry-index notice](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). Current org/connector reads and nonce replay checks have supporting indexes; the issuer/revoker and full composite foreign-key indexes remain advisor suggestions to evaluate with production row counts and delete plans. The expiry index supports nonce pruning once traffic accumulates.

Screenshots from the isolated Playwright MCP seeded-owner journey: empty (generated artifact removed during repository cleanup), pending (generated artifact removed during repository cleanup), revoked (generated artifact removed during repository cleanup). The passing Playwright suites also captured the catalogue (generated artifact removed during repository cleanup), viewer read-only (generated artifact removed during repository cleanup), pending (generated artifact removed during repository cleanup), and revoked (generated artifact removed during repository cleanup) views. Tokens are hidden in these captures.

## Deployment and recovery

Apply the additive migrations and generated types before deploying the API and separate ingress. Mount the CRA agent CA intermediate, server TLS key/certificate and encrypted-vault keyring; keep the agent ingress closed until these are configured. Install the agent using `apps/agent/README.md` and its versioned Linux package or non-root container. Allow outbound HTTPS/mTLS to the CRA ingress; an optional CONNECT proxy must pass TLS through. No inbound customer firewall rule is needed.

On rollback, stop the agent and ingress and deploy the prior application version. Retain agent tables, staged batches, queue files, encryption keys and audit facts; do not reset tenant data. A revoked or expired installed identity needs a new connector and reviewed enrollment, preserving the old connector's evidence.

## Residual validation

- No customer Teamcenter/Windchill schema or write path was available for validation. The agent does not write to those systems.
- A real Linux systemd install/upgrade/uninstall was not run on this macOS host. The Docker build and native SQLite smoke passed.
- HTTPS source reads are direct to pinned addresses; source-side proxy support needs separate review. The CRA ingress CONNECT proxy path was exercised.
- The queue's physical disk ceiling is conservative and HTTPS cursor replay memory covers the latest 1,024 accepted pages. External source fidelity remains a deployment contract.
- Automated WCAG conformance tooling is not installed. Browser checks covered keyboard focus/activation, reduced motion, semantic controls and textual status; formal WCAG 2.2 AA review remains for deployment.
- The existing Playwright suite has test files importing other test files, so this journey was run with a file-scoped temporary configuration. No global browser profile or unrelated site data was cleared.
