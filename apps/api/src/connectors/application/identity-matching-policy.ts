/**
 * Pure identity-matching decisions for a first-seen (or re-seen) external
 * record. No DB access: every candidate list is pre-fetched and pre-filtered
 * by the caller (the worker), this module only decides the outcome.
 */

export type IdentityMatchMethod =
  | "exact_normalized_code"
  | "exact_normalized_release_version"
  | "manual_link"
  | "manual_merge"
  | "adapter_asserted_id";

export type IdentityMatchResult =
  | Readonly<{
      outcome: "matched";
      mappingId: string;
      matchConfidence: "certain";
    }>
  | Readonly<{ outcome: "ambiguous"; candidateMappingIds: readonly string[] }>
  | Readonly<{ outcome: "no_match" }>;

/**
 * The exact CRA generated-column algorithm
 * (`lower(regexp_replace(normalize(value, nfkc), '\s+', '', 'g'))`), copied
 * rather than imported so this bounded context stays free of a dependency on
 * the product CSV-import module. Do not approximate this -- it must stay
 * byte-for-byte identical to `normalizeIdentity` in
 * `products/imports/product-release-import-format.ts` and to the database's
 * `internal_code_normalized` / `release_version_normalized` columns.
 */
export function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

export type ProductIdentityCandidate = Readonly<{
  productId: string;
  hasOtherActiveMapping: boolean;
}>;

/**
 * `existingActiveMapping` is the fast path: an external record already
 * linked to a CRA product on a prior sync. Only when that is absent do we
 * fall back to matching by normalized internal code, and only when exactly
 * one unclaimed candidate exists -- a candidate already carrying another
 * active mapping for this connector cannot be silently reused, and more than
 * one candidate is a genuine data ambiguity. Either case is reported as
 * `ambiguous` so a human resolves it rather than the sync engine guessing.
 */
export function matchExternalProductRecord(
  input: Readonly<{
    externalId: string;
    existingActiveMapping: Readonly<{ id: string }> | null;
    internalCode: string | null;
    candidateProductsByNormalizedCode: readonly ProductIdentityCandidate[];
  }>,
): IdentityMatchResult {
  if (input.existingActiveMapping !== null) {
    return Object.freeze({
      outcome: "matched",
      mappingId: input.existingActiveMapping.id,
      matchConfidence: "certain",
    });
  }
  if (input.internalCode === null)
    return Object.freeze({ outcome: "no_match" });
  return resolveCandidates(
    input.candidateProductsByNormalizedCode.map((candidate) => ({
      id: candidate.productId,
      hasOtherActiveMapping: candidate.hasOtherActiveMapping,
    })),
  );
}

export type ReleaseIdentityCandidate = Readonly<{
  releaseId: string;
  hasOtherActiveMapping: boolean;
}>;

/**
 * Release matching is parent-scoped: the release's parent externalId must
 * first resolve to exactly one active product mapping. Zero or more than one
 * is ambiguous by construction -- the caller pre-resolves that count (a DB
 * lookup, out of scope here) and passes it in as
 * `parentActiveProductMappingIds`.
 */
export function matchExternalReleaseRecord(
  input: Readonly<{
    externalId: string;
    existingActiveMapping: Readonly<{ id: string }> | null;
    releaseVersion: string | null;
    parentActiveProductMappingIds: readonly string[];
    candidateReleasesByNormalizedVersion: readonly ReleaseIdentityCandidate[];
  }>,
): IdentityMatchResult {
  if (input.existingActiveMapping !== null) {
    return Object.freeze({
      outcome: "matched",
      mappingId: input.existingActiveMapping.id,
      matchConfidence: "certain",
    });
  }
  if (input.parentActiveProductMappingIds.length !== 1) {
    return Object.freeze({
      outcome: "ambiguous",
      candidateMappingIds: Object.freeze([
        ...input.parentActiveProductMappingIds,
      ]),
    });
  }
  if (input.releaseVersion === null)
    return Object.freeze({ outcome: "no_match" });
  return resolveCandidates(
    input.candidateReleasesByNormalizedVersion.map((candidate) => ({
      id: candidate.releaseId,
      hasOtherActiveMapping: candidate.hasOtherActiveMapping,
    })),
  );
}

function resolveCandidates(
  candidates: readonly Readonly<{
    id: string;
    hasOtherActiveMapping: boolean;
  }>[],
): IdentityMatchResult {
  if (candidates.length === 0) return Object.freeze({ outcome: "no_match" });
  if (candidates.length === 1 && !candidates[0]!.hasOtherActiveMapping) {
    return Object.freeze({
      outcome: "matched",
      mappingId: candidates[0]!.id,
      matchConfidence: "certain",
    });
  }
  return Object.freeze({
    outcome: "ambiguous",
    candidateMappingIds: Object.freeze(
      candidates.map((candidate) => candidate.id),
    ),
  });
}
