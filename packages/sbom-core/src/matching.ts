// The matching engine algorithm (BRD §10.2). Deterministic, no AI (ADR-010).
// Chain of Responsibility: PURL exact/range first (short-circuit — never also run
// CPE for the same component, "that is where duplicates come from"), CPE fallback
// only when there is no PURL. Confidence is a documented table, never a magic
// number in a service class (FR-MATCH-001).
import type { Ecosystem, NormalizedComponent } from "./model";
import { comparatorFor } from "./comparators";
import { namespaceMatches } from "./package-identity";
import { parsePurl } from "./purl";

export type MatchMethod = "purl_range" | "cpe_match" | "manual";

export const CONFIDENCE = {
  PURL_RANGE: 0.95,
  CPE_VERSION_SPECIFIC: 0.7,
  CPE_LOOSE: 0.45,
} as const;

/**
 * FR-MATCH-003: findings below this are shown but collapsed by default, "so the
 * queue reflects what is worth acting on without hiding anything".
 *
 * The default sits exactly at CPE_VERSION_SPECIFIC, which is the natural seam:
 * a PURL range match (0.95) and a version-pinned CPE (0.70) are worth an
 * analyst's attention, a wildcard CPE (0.45) is a lead rather than a finding.
 * Deployments override it with MATCH_CONFIDENCE_THRESHOLD.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD: number =
  CONFIDENCE.CPE_VERSION_SPECIFIC;

/**
 * Structured false-positive reasons (FR-MATCH-004). A fixed set, for the same
 * reason §8.3 constrains vex_justification: free text cannot be aggregated, and
 * this feeds a metric that is compared against the golden dataset's own rate.
 */
export const FALSE_POSITIVE_REASONS = [
  /** The advisory's affected range does not really cover this version. */
  "wrong_version_range",
  /** Right name, wrong package — a namespace, ecosystem or fork collision. */
  "wrong_package",
  /** The CPE was too broad and named a product family, not this component. */
  "cpe_too_broad",
  /** The advisory itself is withdrawn, disputed or rejected upstream. */
  "advisory_withdrawn",
  /** The SBOM misdescribes the component, so the match was never possible. */
  "bad_sbom_data",
  "other",
] as const;
export type FalsePositiveReason = (typeof FALSE_POSITIVE_REASONS)[number];

// OSV-style affected range. A version is affected iff introduced <= v < fixed
// (fixed is EXCLUSIVE), optionally bounded above by lastAffected (inclusive).
export interface AffectedRange {
  introduced?: string;
  fixed?: string;
  lastAffected?: string;
}

export interface AffectedPackage {
  ecosystem: Ecosystem;
  name: string;
  namespace?: string | null;
  ranges: AffectedRange[];
}

export interface CpeCriterion {
  cpe: string;
  versionStartIncluding?: string;
  versionEndExcluding?: string;
  /** true when the CPE pins a specific version (higher confidence). */
  versionSpecific: boolean;
}

export interface Advisory {
  advisoryId: string;
  source: string; // 'osv' | 'nvd' | 'ghsa' | 'vendor' | 'manual'
  affected: AffectedPackage[];
  cpeCriteria?: CpeCriterion[];
}

export interface MatchCandidate {
  advisoryId: string;
  method: MatchMethod;
  confidence: number;
}

// Port for advisory data — the DB-backed feed mirror implements this (Adapter),
// keeping the engine pure and testable.
export interface AdvisoryLookup {
  byPurl(
    purlType: string,
    namespace: string | null,
    name: string,
    ecosystem: Ecosystem,
  ): Advisory[];
  byCpe(cpe: string): Advisory[];
}

export function isVersionAffected(
  version: string,
  range: AffectedRange,
  ecosystem: Ecosystem,
): boolean {
  const cmp = comparatorFor(ecosystem);
  if (
    range.introduced &&
    range.introduced !== "0" &&
    cmp(version, range.introduced) < 0
  ) {
    return false;
  }
  if (range.fixed && cmp(version, range.fixed) >= 0) return false; // fixed is exclusive
  if (range.lastAffected && cmp(version, range.lastAffected) > 0) return false;
  return true;
}

function dedupeHighestConfidence(
  candidates: MatchCandidate[],
): MatchCandidate[] {
  const best = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    const prev = best.get(c.advisoryId);
    if (!prev || c.confidence > prev.confidence) best.set(c.advisoryId, c);
  }
  return [...best.values()];
}

function cpeAffected(crit: CpeCriterion, version: string): boolean {
  // CPE versions have no declared ecosystem; use semver-style ordering as the
  // pragmatic default for range endpoints.
  const cmp = comparatorFor("semver");
  if (
    crit.versionStartIncluding &&
    cmp(version, crit.versionStartIncluding) < 0
  ) {
    return false;
  }
  if (crit.versionEndExcluding && cmp(version, crit.versionEndExcluding) >= 0) {
    return false;
  }
  return true;
}

/**
 * Match one normalised component against the advisory mirror. Returns the finding
 * candidates with method + confidence + provenance (FR-VULN-004/005/007).
 */
export function matchComponent(
  component: NormalizedComponent,
  lookup: AdvisoryLookup,
): MatchCandidate[] {
  // Layer 1 — PURL exact + range (primary path, highest confidence).
  if (component.purl && component.ecosystem && component.version) {
    const parsed = parsePurl(component.purl);
    const candidates: MatchCandidate[] = [];
    if (parsed) {
      const version = component.version;
      const ecosystem = component.ecosystem;
      const advisories = lookup.byPurl(
        parsed.type,
        parsed.namespace,
        parsed.name,
        ecosystem,
      );
      for (const adv of advisories) {
        const affected = adv.affected.some(
          (pkg) =>
            pkg.ecosystem === ecosystem &&
            pkg.name === parsed.name &&
            // Package IDENTITY is re-checked here rather than trusted from the
            // lookup. byPurl is an index: an adapter is free to return a coarse
            // superset (a SQL prefilter cannot express the unscoped-namespace
            // rule), so the precise check has to live somewhere it cannot be
            // forgotten. An adapter that silently ignored the namespace argument
            // is exactly how two Maven artifacts sharing an artifactId under
            // different groupIds became one finding.
            namespaceMatches(pkg.namespace, parsed.namespace) &&
            pkg.ranges.some((r) => isVersionAffected(version, r, ecosystem)),
        );
        if (affected) {
          candidates.push({
            advisoryId: adv.advisoryId,
            method: "purl_range",
            confidence: CONFIDENCE.PURL_RANGE,
          });
        }
      }
    }
    // Short-circuit: do NOT also run CPE for the same component (FR-MATCH-002).
    return dedupeHighestConfidence(candidates);
  }

  // Layer 2 — CPE fallback (lower confidence, only when no PURL).
  if (component.cpe && component.version) {
    const version = component.version;
    const candidates: MatchCandidate[] = [];
    for (const adv of lookup.byCpe(component.cpe)) {
      for (const crit of adv.cpeCriteria ?? []) {
        if (cpeAffected(crit, version)) {
          candidates.push({
            advisoryId: adv.advisoryId,
            method: "cpe_match",
            confidence: crit.versionSpecific
              ? CONFIDENCE.CPE_VERSION_SPECIFIC
              : CONFIDENCE.CPE_LOOSE,
          });
        }
      }
    }
    return dedupeHighestConfidence(candidates);
  }

  // Layer 3 (heuristic) is V2 — no auto-opened finding without purl or cpe.
  return [];
}
