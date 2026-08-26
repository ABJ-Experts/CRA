import { PackageURL } from "packageurl-js";

import {
  compareVersion,
  type VersionComparatorId,
} from "./comparators/version-comparator";

export const COMPARATOR_REGISTRY_VERSION = "m4-02.1";
export const CONFIDENCE_TABLE_VERSION = "m4-02.1";

/**
 * Versioned deterministic confidence table. Event-range matches have complete
 * boundary provenance; explicit-version-only OSV records remain applicable but
 * are deliberately review-visible below the default display threshold.
 */
export const PURL_OSV_CONFIDENCE_TABLE = Object.freeze({
  eventRange: Object.freeze({
    score: 0.98,
    explanation:
      "Direct canonical PURL, ecosystem-correct comparator, and OSV event-range comparison.",
  }),
  explicitVersion: Object.freeze({
    score: 0.85,
    explanation:
      "Direct canonical PURL and OSV explicit affected-version comparison without an event range.",
  }),
});

export type MatchableComponent = Readonly<{
  componentId: string;
  canonicalPurl: string | null;
  normalizedVersion: string | null;
  ecosystem: string | null;
}>;

export type OsvCandidate = Readonly<{
  affectedRangeId: string;
  sourceRecordId: string;
  sourceRecordVersionId: string;
  vulnerabilityId: string;
  canonicalAdvisoryId: string;
  sourceFeedKey: "osv";
  ecosystem: string | null;
  purlType: string | null;
  purlNamespace: string | null;
  purlName: string | null;
  rangeType: string | null;
  rangeValue: Readonly<Record<string, unknown>>;
  eventSequence: readonly OsvRangeEvent[];
  versions?: readonly string[];
}>;

export type OsvRangeEvent = Readonly<{
  introduced?: string;
  fixed?: string;
  lastAffected?: string;
  limit?: string;
}>;

export type MatchEvaluationDraft = Readonly<{
  componentId: string;
  outcome: "affected" | "not_affected" | "reviewable";
  reviewCode?:
    | "unsupported_ecosystem"
    | "purl_ecosystem_mismatch"
    | "invalid_purl"
    | "unparseable_version"
    | "unsupported_range";
  affectedRangeId?: string;
  sourceRecordId?: string;
  sourceRecordVersionId?: string;
  vulnerabilityId?: string;
  canonicalAdvisoryId?: string;
  matchMethod: "purl_osv";
  comparatorName?: VersionComparatorId;
  comparatorVersion?: string;
  evaluatedComponentValue: string;
  affectedRange?: Readonly<Record<string, unknown>>;
  eventSequence?: readonly OsvRangeEvent[];
  evaluatedAt: string;
  confidence?: number;
  confidenceTableVersion?: string;
  confidenceExplanation?: string;
}>;

const purlEcosystems: Readonly<Record<string, string>> = Object.freeze({
  npm: "npm",
  maven: "maven",
  pypi: "pypi",
  golang: "golang",
  deb: "deb",
  rpm: "rpm",
});

const comparatorByEcosystem: Readonly<Record<string, VersionComparatorId>> =
  Object.freeze({
    npm: "semver",
    maven: "maven",
    pypi: "pep440",
    deb: "debian",
    debian: "debian",
    rpm: "rpm",
    golang: "go",
    go: "go",
  });

/**
 * Deterministically evaluates only the PURL/OSV path. A component is never
 * passed to CPE or description matching after this function returns.
 */
export function evaluatePurlOsvComponent(
  component: MatchableComponent,
  candidates: readonly OsvCandidate[],
  now = new Date().toISOString(),
): readonly MatchEvaluationDraft[] {
  const invalid = (code: MatchEvaluationDraft["reviewCode"]) =>
    review(component, code!, now);
  if (!component.canonicalPurl) return [];
  if (!component.normalizedVersion) return invalid("unparseable_version");

  const parsed = purlMatchingIdentity(component.canonicalPurl);
  if (!parsed) return invalid("invalid_purl");
  const resolvedEcosystem = purlEcosystems[parsed.type];
  if (!resolvedEcosystem) return invalid("unsupported_ecosystem");
  if (
    component.ecosystem !== null &&
    normalizeEcosystem(component.ecosystem) !== resolvedEcosystem
  ) {
    return invalid("purl_ecosystem_mismatch");
  }
  const comparator = comparatorByEcosystem[resolvedEcosystem];
  if (!comparator) return invalid("unsupported_ecosystem");

  return candidates.map((candidate) =>
    evaluateCandidate(
      component,
      candidate,
      parsed,
      resolvedEcosystem,
      comparator,
      now,
    ),
  );
}

function evaluateCandidate(
  component: MatchableComponent,
  candidate: OsvCandidate,
  parsed: Readonly<{ type: string; namespace: string | null; name: string }>,
  ecosystem: string,
  comparator: VersionComparatorId,
  now: string,
): MatchEvaluationDraft {
  const base = candidateEvidence(component, candidate, comparator, now);
  if (
    candidate.sourceFeedKey !== "osv" ||
    normalizeEcosystem(candidate.ecosystem) !== ecosystem ||
    candidate.purlType !== parsed.type ||
    (candidate.purlNamespace ?? null) !== parsed.namespace ||
    candidate.purlName !== parsed.name
  ) {
    return {
      ...base,
      outcome: "reviewable",
      reviewCode: "purl_ecosystem_mismatch",
    };
  }
  const rangeType = candidate.rangeType?.toUpperCase() ?? "ECOSYSTEM";
  if (
    rangeType === "GIT" ||
    (rangeType === "SEMVER" && comparator !== "semver")
  ) {
    return { ...base, outcome: "reviewable", reviewCode: "unsupported_range" };
  }
  const version = component.normalizedVersion!;
  const explicit =
    candidate.versions ?? versionsFromRange(candidate.rangeValue);
  const interval = evaluateEvents(comparator, version, candidate.eventSequence);
  if (interval.kind === "unsupported") {
    return { ...base, outcome: "reviewable", reviewCode: interval.reason };
  }
  if (interval.kind === "affected") return affected(base, candidate);
  if (explicit.length > 0) {
    for (const affectedVersion of explicit) {
      const comparison = compareVersion(comparator, version, affectedVersion);
      if (comparison.kind === "unsupported") {
        return {
          ...base,
          outcome: "reviewable",
          reviewCode: "unparseable_version",
        };
      }
      if (comparison.ordering === 0) return affected(base, candidate);
    }
    return { ...base, outcome: "not_affected" };
  }
  if (candidate.eventSequence.length === 0) {
    return { ...base, outcome: "reviewable", reviewCode: "unsupported_range" };
  }
  return { ...base, outcome: "not_affected" };
}

function evaluateEvents(
  comparator: VersionComparatorId,
  version: string,
  events: readonly OsvRangeEvent[],
):
  | Readonly<{ kind: "affected" | "not_affected" }>
  | Readonly<{
      kind: "unsupported";
      reason: "unparseable_version" | "unsupported_range";
    }> {
  let intervalOpen = false;
  for (const event of events) {
    const entries = Object.entries(event).filter(
      ([, value]) => value !== undefined,
    );
    if (entries.length !== 1)
      return { kind: "unsupported", reason: "unsupported_range" };
    const [boundary, boundaryVersion] = entries[0]!;
    if (typeof boundaryVersion !== "string")
      return { kind: "unsupported", reason: "unsupported_range" };
    if (boundary === "limit")
      return { kind: "unsupported", reason: "unsupported_range" };
    const comparison = compareVersion(comparator, version, boundaryVersion);
    if (comparison.kind === "unsupported") {
      return { kind: "unsupported", reason: "unparseable_version" };
    }
    if (boundary === "introduced") {
      intervalOpen = boundaryVersion === "0" || comparison.ordering >= 0;
      continue;
    }
    if (boundary === "fixed") {
      if (intervalOpen && comparison.ordering < 0) return { kind: "affected" };
      intervalOpen = false;
      continue;
    }
    if (boundary === "lastAffected") {
      if (intervalOpen && comparison.ordering <= 0) return { kind: "affected" };
      intervalOpen = false;
      continue;
    }
    return { kind: "unsupported", reason: "unsupported_range" };
  }
  return intervalOpen ? { kind: "affected" } : { kind: "not_affected" };
}

function affected(
  base: Omit<MatchEvaluationDraft, "outcome" | "reviewCode">,
  candidate: OsvCandidate,
): MatchEvaluationDraft {
  const confidence =
    candidate.eventSequence.length > 0
      ? PURL_OSV_CONFIDENCE_TABLE.eventRange
      : PURL_OSV_CONFIDENCE_TABLE.explicitVersion;
  return {
    ...base,
    outcome: "affected",
    confidence: confidence.score,
    confidenceTableVersion: CONFIDENCE_TABLE_VERSION,
    confidenceExplanation: confidence.explanation,
  };
}

function candidateEvidence(
  component: MatchableComponent,
  candidate: OsvCandidate,
  comparator: VersionComparatorId,
  now: string,
): Omit<MatchEvaluationDraft, "outcome" | "reviewCode"> {
  return {
    componentId: component.componentId,
    affectedRangeId: candidate.affectedRangeId,
    sourceRecordId: candidate.sourceRecordId,
    sourceRecordVersionId: candidate.sourceRecordVersionId,
    vulnerabilityId: candidate.vulnerabilityId,
    canonicalAdvisoryId: candidate.canonicalAdvisoryId,
    matchMethod: "purl_osv",
    comparatorName: comparator,
    comparatorVersion: COMPARATOR_REGISTRY_VERSION,
    evaluatedComponentValue: component.normalizedVersion ?? "",
    affectedRange: candidate.rangeValue,
    eventSequence: candidate.eventSequence,
    evaluatedAt: now,
  };
}

function review(
  component: MatchableComponent,
  reviewCode: NonNullable<MatchEvaluationDraft["reviewCode"]>,
  now: string,
): readonly MatchEvaluationDraft[] {
  return [
    {
      componentId: component.componentId,
      outcome: "reviewable",
      reviewCode,
      matchMethod: "purl_osv",
      evaluatedComponentValue: component.normalizedVersion ?? "",
      evaluatedAt: now,
    },
  ];
}

export function purlMatchingIdentity(
  value: string,
): Readonly<{ type: string; namespace: string | null; name: string }> | null {
  try {
    const parsed = PackageURL.fromString(value);
    if (!parsed.type || !parsed.name) return null;
    return {
      type: parsed.type.toLowerCase(),
      namespace: parsed.namespace?.toLowerCase() ?? null,
      name: parsed.name.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function normalizeEcosystem(value: string | null): string | null {
  return value?.trim().toLowerCase() ?? null;
}

function versionsFromRange(
  value: Readonly<Record<string, unknown>>,
): readonly string[] {
  return Array.isArray(value.versions)
    ? value.versions.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
}
