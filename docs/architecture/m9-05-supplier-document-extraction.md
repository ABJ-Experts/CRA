# M9-05 — Reviewable supplier document extraction

## Scope and preserved contracts

- Authorized internal reviewers receive source-grounded suggestions for certification held, validity dates, scope, contact, and declared component versions from a clean supplier evidence version.
- Suggestions are advisory. A reviewer confirms each field after M9-03 acceptance, corrects it if needed, or rejects it. Manual review and manual field entry remain available when AI is disabled or unavailable.
- Existing M9 request, invitation, portal, and submission behavior; M8 evidence immutability, scan, retention, legal holds, and search; M7 snapshots; and the M3 supplier SBOM boundary remain unchanged.
- No automatic certificate validation, evidence acceptance, supplier registry update, compliance claim, cloud provider fallback, or general chatbot is introduced.

## Concrete problem and selected design

M8 records normalized text but no page map. M9-03 records a whole-submission decision but no individual document facts. The existing tenant settings had no supplier-document inference policy or gateway. Directly calling a model from the supplier feature would bypass central policy and leave no durable run provenance.

- A shared Nest AI gateway owns one local Ollama route, immutable prompt version, bounded structured output, policy checks, and refusal/error mapping. The provider adapter implements an inward-owned gateway port. Remove this boundary only if all inference is retired.
- An additive page map on the existing M8 derived-text row binds page text to the immutable version/hash. It is populated only from the existing local extractor and verified storage path; current search text remains intact.
- One durable inference-run ledger holds task, tenant, version/hash, lease, model/prompt, and outcome. Gateway calls use bounded input/output token budgets; per-run token usage is not yet persisted. One supplier-document-field table holds each candidate, citation, decision, original value, correction, actor, and time. Confirmed rows are the version-linked metadata projection. A separate generic suggestion store, event bus, vector index, and supplier registry mirror add no present value.

## Why not simpler? Selected and rejected patterns

A direct call from the existing supplier controller to Ollama could produce text, but could not enforce one provider/data-residency policy, record a restart-safe inference attempt, or validate a citation against an immutable M8 version before a decision. Storing only a JSON blob on the submission would also conflate competing candidates and make per-field correction, optimistic concurrency, and transactional audit unreliable. The present workflow therefore uses the existing controller → application → infrastructure direction, with an application-owned gateway boundary and narrowly scoped Supabase RPCs. The shared contract is the versioned, schema-constrained candidate list; the provider adapter can be removed if inference is retired. The run ledger is needed for worker leases and provenance, not an event bus. A generic document chatbot, vector store, parallel OCR engine, registry mirror, and global provider singleton were rejected because none solves a current requirement and each expands the trust surface.

## Data and tenant boundaries

- Nest verified identity supplies actor and organization. Every service-role query is organization-first and joins request, product, submission, accepted review, evidence version, and clean page map before returning or changing anything. Public portal bearers never authorize extraction or field decisions.
- A suggestion is displayed only if its page exists and its Unicode code-point offsets reproduce its exact quoted passage. Conflicting certificates and dates stay separate. Model text never becomes instructions, tool arguments, HTML, or cross-tenant retrieval.
- Starting a run is idempotent. A database lease makes a restart safe; completion requires the current lease and unchanged source hash. Confirmation uses the field version and idempotency key, and writes the decision and audit fact in one transaction. A new source version or rejected/quarantined evidence invalidates pending application without changing historical records.
- Tenant provider/data-residency policy defaults to disabled/local-only and is checked before any network call and again before persistence. The configured loopback Ollama endpoint is the only provider route. Missing configuration, budget exhaustion, refusal, timeout, and malformed output produce safe run outcomes while leaving manual review usable.

## API, UI, and failure behavior

- Feature-first Zod contracts define parameters, bodies, successful responses, field keys, confidence, page spans, run state, and decision state. Nest uses Zod pipes and response parsing; the web gateway parses outgoing bodies and incoming JSON.
- The supplier reviewer opens a code-split operational panel with competing candidates, source hash/run/model, confidence and plain-language status. Accepted evidence from previous re-request cycles remains reachable. Selecting a candidate navigates the verified PDF to its page and highlights the exact passage in an accessible text pane. The page and text cite the same immutable version. Field history uses bounded keyset pagination.
- Confirmation is disabled until the submission is accepted. Selected-field confirmation excludes candidates below the provisional 0.80 threshold; every selected field is an explicit reviewed decision. Manual entry, individual correction, and rejection keep unsaved edits after validation, conflict, or network failure.
- No evidence preview, download, supplier portal, or submission review depends on gateway health.

### Boundary and rendering details

- `@repo/contracts/supplier-evidence` holds strict request, query, path, and response schemas; trusted types derive from `z.output`. The controller parses all consumed inputs and each successful JSON result. The web API passes both an outgoing `inputSchema` and incoming `schema`; unsupported keys are rejected rather than silently applied. Defaults such as the bounded read page size are applied only by the contract.
- React panels remain functional and own presentation and local recoverable form state. The plain TypeScript gateway and repository classes own injected transport and persistence lifecycles respectively; their composition roots are the Nest module and worker bootstrap. Pure field/citation checks stay immutable functions. Neither the page nor controller directly queries Supabase.
- Invalid input, forbidden scope, stale version, conflicting field version, and missing citation fail closed with stable errors. Duplicate idempotency keys return the recorded decision. A lost worker lease cannot complete a run; a restarted worker may reclaim it. Provider refusal, malformed output, timeout, local service outage, and exhausted budget mark extraction unavailable without disabling manual entry. Browser network errors retain edits for retry. No SMTP operation is introduced; existing JWKS/session verification remains the sole identity source.

## Tests, observability, and rollout

- Characterization tests first pin the M9-03 review and M8 viewer/search behavior. Contract/policy tests cover unknown fields, Unicode spans, conflicting candidates, malformed/refused model output, local-only routing, and no cloud fallback.
- Real PostgreSQL tests cover tenant/product substitution, revoked grants, clean/accepted/version gates, concurrent decisions, idempotency, source changes, lease replay, RLS, direct grants, and atomic audit. Browser tests cover manual recovery, correction, rejection, citation interaction, keyboard/focus, narrow layout, and preserved input.
- Synthetic evaluation records field accuracy and source grounding for noisy, multilingual, ambiguous, no-evidence, and hostile documents by prompt/model version. The harness is present, but this workspace has no configured Ollama model, so the release accuracy gate remains closed and bulk confirmation remains disabled.
- Deploy additive migration and generated types before API/worker and web. Rollback disables inference and the panel while retaining runs, decisions, M8/M9 evidence, retention state, and M7 snapshots. Logs contain stable IDs and safe categories, never document text, bearer tokens, or model prompts.

### Review checklist and release boundary

- [x] Direct implementation and rejected alternatives are documented above; every new boundary has a present-tense provenance, policy, or durable-lease trigger.
- [x] No user/tenant/session state is global; verified identity and explicit organization/product scope are required by the service-role and RPC paths.
- [x] Controllers and pages are thin; application policy does not depend on a concrete Supabase adapter; JSON inputs and outputs have feature-first Zod contracts.
- [x] React remains functional; security-critical decisions and audit occur in one database transaction.
- [x] Focused unit, contract, database, and browser checks are included in the M9-05 evidence record; existing auth, M1–M8, and navigation behavior remains in the regression gate.
- [ ] A real configured local model must pass the synthetic accuracy/source-grounding evaluation and an agreed confidence threshold before release. The absence of Ollama here keeps that gate closed; bulk confirmation is disabled.
