# M9-05 Supplier Document Extraction Implementation Plan

> **For agentic workers:** Implement task by task with a failing test before production code. Review each security boundary before advancing.

**Goal:** Extract source-grounded supplier document fields as suggestions and require attributable field confirmation after evidence acceptance.

**Architecture:** Reuse M8 local OCR and verified evidence access, the M9 supplier request/review workflow, and feature-first contracts. A shared AI gateway calls only a configured local Ollama runtime. Database RPCs enforce scope, provenance, concurrency, and audit atomically.

**Tech Stack:** pnpm, TypeScript, NestJS, Next.js, Zod, PostgreSQL/Supabase, local Poppler/Tesseract, Ollama, Jest, Vitest, SQL tests, Playwright.

**Spec:** `docs/architecture/m9-05-supplier-document-extraction.md` and BRD v2.0 FR-SUP-008/AI-4.

## Global Constraints

- Keep `/api/v1`, existing auth cookies/JWKS, M9 portal scope, M8 immutable versions, M7 snapshots, and org-first service-role access.
- No cloud fallback, automatic evidence acceptance, certificate validation, supplier registry update, or data reset.
- Use shared Zod input/output contracts, atomic audit, idempotency, and at least 80% coverage for new/materially changed modules.
- UI follows the incumbent Poppins/semantic-token operational design and WCAG 2.2 AA; extracted content renders as text nodes only.

## Review Focus

1. A source with two plausible validity dates yields two visible candidates, never one inferred winner; contract and UI tests cover it.
2. A hostile page instructing the model to call a tool or expose another tenant has no tool route or cross-tenant retrieval; gateway and SQL tests cover it.
3. A reviewer opens a suggestion before a new upload and confirms afterward: stale version/hash fails, edit remains in the form; SQL and browser tests cover it.
4. OCR page offsets around non-BMP Unicode still highlight the exact quote; extractor and SQL tests cover it.
5. Worker death after claim is recoverable without duplicate suggestions or confirmation; lease/replay SQL and worker tests cover it.

## Task 1: Contracts and page provenance

- [ ] Write failing Zod and OCR tests for supported keys, unknown keys, repeated candidates, exact page spans, Unicode offsets, and no-evidence output.
- [ ] Add supplier extraction schemas/types and extend the existing extractor with bounded page text while preserving its flat search text.
- [ ] Run focused contracts and OCR tests; verify unchanged search and preview behavior.

## Task 2: Durable, scoped database workflow

- [ ] Write SQL tests for RLS/grants, tenant/product substitution, clean and accepted evidence, stale source, concurrency, idempotency, lease expiry, and audit atomicity.
- [ ] Add the smallest additive migration: M8 page-map column, inference-run ledger, and per-field suggestion/confirmation records with organization-scoped RPCs.
- [ ] Apply only pending migrations to the existing local database; generate types through the Supabase CLI and run the SQL suite without a reset.

## Task 3: Shared gateway and supplier API

- [ ] Write failing tests for disabled/local-only policy, budget, provider refusal/timeout/malformed JSON, unsupported keys, citation mismatch, and worker restart.
- [ ] Add the shared gateway and immutable prompt; wire a supplier extraction worker and org-first repository/use cases to the atomic RPCs.
- [ ] Add authenticated controller routes with Zod body/query/path and success response parsing. Run API tests and type checking.

## Task 4: Reviewer experience

- [ ] Write failing UI tests for empty/loading/offline/forbidden/conflict states, manual entry, exact passage highlight, correction, rejection, and retained input.
- [ ] Add the code-split supplier review panel using the existing HTTP/query clients and verified preview. Keep the existing submission review available when inference fails.
- [ ] Run focused UI tests and inspect desktop/mobile, keyboard, focus, contrast, and reduced-motion behavior in a bounded screenshot pass.

## Task 5: Release evidence

- [ ] Evaluate synthetic noisy, multilingual, conflicting, empty, and hostile documents; record field accuracy and citation grounding by prompt/model version.
- [ ] Keep selected-field bulk confirmation gated until the provisional 0.80 threshold is confirmed from evaluation.
- [ ] Run `pnpm verify`, applicable live SQL/auth/supplier tests, and Playwright with the seeded local owner. Capture screenshots and confirm database run/field/audit rows.
- [ ] Record contract links, reproducible commands/results, migration/backfill/rollback notes, and residual risks in the feature architecture document.
