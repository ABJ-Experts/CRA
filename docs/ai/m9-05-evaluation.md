# M9-05 supplier document extraction evaluation

Status: **release gate closed**. The `0.80` bulk-confirmation confidence threshold is
provisional, not an empirically approved threshold. Per-field explicit review remains
the only supported action. The deterministic fixture-oracle test is a check of the
scorer, **not** evidence of any model's accuracy. No Ollama model result is claimed
by this document.

## Synthetic corpus and traceability

The versioned corpus is in
`apps/api/src/ai/evaluation/supplier-document-evaluation.fixtures.ts`. It contains
only invented supplier content; no production document, credential, or tenant data.

| Case | Failure mode exercised | Expected behavior |
| --- | --- | --- |
| `noisy-scan` | OCR substitutions, spaced heading, scan artifacts | Cite certificate and expiry without interpreting noise |
| `conflicting-certificates-and-dates` | Two certificates and two expiry dates | Preserve both alternatives and their group association |
| `multilingual-layout` | Chinese, Spanish, accented names, contact and component version | Quote the exact Unicode text with code-point offsets |
| `no-evidence` | Unsupported packing list | Return no candidates |
| `hostile-instructions` | Embedded exfiltration and compliance instructions | Extract only cited facts; do not obey document instructions |

These cases trace to M9-05 acceptance criterion 6; exact source-offset checks also
exercise criterion 1, alternative grouping criterion 2, and the hostile case
criterion 4. Gateway unit tests cover local-only routing, refusal, malformed output,
timeout, unavailable provider and budget failures separately.

## Reproduce

Run the deterministic scorer and runner tests from the repository root:

```sh
pnpm --filter @repo/contracts build
pnpm --filter api run test -- supplier-document-evaluation --runInBand
```

With a local Ollama instance and an explicitly selected model, run the synthetic
corpus through the same `AiGateway` used by the worker:

```sh
AI_OLLAMA_URL=http://127.0.0.1:11434 \
AI_OLLAMA_MODEL='your-installed-local-model' \
pnpm --filter api exec ts-node src/ai/evaluation/run-supplier-document-evaluation.ts
```

The runner prints JSON identifying the model and prompt version. The exit code is
nonzero and status `incomplete` if any case has a provider failure; it does not
report partial accuracy as if it were a complete evaluation. The gateway permits
only loopback HTTP and does not fall back to a cloud provider. Save the output
alongside a build revision and model digest when an actual release candidate is
tested. Do not enter real tenant documents into this runner.

## Metric definitions and decision rule

- A correct field matches the expected field key, normalized value, page, exact
  Unicode code-point offsets, and quoted passage. A wrong span gets no accuracy
  credit even when the value looks right. Duplicate suggestions receive credit
  only once.
- Field precision is correct suggestions / proposed suggestions; field recall is
  correct suggestions / expected suggestions. Empty proposal precision is 1 by
  convention; the nonempty corpus still makes recall 0 when nothing is found.
- Source grounding is the fraction of proposed spans that exactly match the
  supplied page text. Unsupported fields remain false positives.
- Candidate-group consistency checks whether different expected certificates
  stay in distinct proposed groups and fields for the same certificate remain
  together. Accuracy alone cannot certify ambiguity preservation.

Before release, the product/security owners must agree on a confidence threshold
using representative, independently labeled documents including real-world OCR
quality and locale variation. This small synthetic corpus is a regression probe,
not a statistically adequate threshold-calibration set. Record per-field
precision/recall, source grounding, ambiguity, sample sizes, model digest, prompt
version, and review sign-off. Keep bulk confirmation disabled until that agreement
is implemented and independently verified. Even then, low-confidence candidates
must remain ineligible and each selected field must be explicitly confirmed.

## Current evidence

Deterministic tests exercise both a perfect fixture oracle and injected false
positives/wrong citations; those results validate scoring logic only. On
2026-09-23, the CLI was run in this workspace without `AI_OLLAMA_MODEL` or a
local endpoint configured. It exited 1 with `status: incomplete` and
`code: unavailable` for all five cases. Thus no local Ollama accuracy run has
been recorded here. The targeted evaluation module tests passed (10 tests;
97.56% statements, 92.15% branches, 100% functions, 97.36% lines).
The gate intentionally remains closed regardless of fixture-oracle scores.
