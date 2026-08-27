import {
  CPE_NVD_CONFIDENCE_TABLE,
  CPE_NVD_CONFIDENCE_TABLE_VERSION,
  type MatchEvaluationDraft,
  type MatchableComponent,
  purlMatchingIdentity,
} from "./matching-policy";
import {
  compareVersion,
  type VersionComparatorId,
} from "./comparators/version-comparator";

/** Only standard CPE 2.3 formatted strings and legacy URI bindings are accepted. */
export type CpeIdentity = Readonly<{
  binding: "2.3" | "uri";
  part: "a" | "h" | "o";
  vendor: string;
  product: string;
  version: string | null;
  update: string | null;
  targetSoftware: string | null;
  targetHardware: string | null;
}>;

export type NvdCpeMatch = Readonly<{
  criteria: string;
  vulnerable: boolean;
  versionStartIncluding?: string | null;
  versionStartExcluding?: string | null;
  versionEndIncluding?: string | null;
  versionEndExcluding?: string | null;
}>;

/** A normalized NVD configuration node; original tree order is significant. */
export type NvdConfigurationNode = Readonly<{
  operator: "AND" | "OR";
  negate?: boolean;
  cpeMatch: readonly NvdCpeMatch[];
  nodes: readonly NvdConfigurationNode[];
}>;

export type NvdCpeCandidate = Readonly<{
  affectedRangeId: string;
  sourceRecordId: string;
  sourceRecordVersionId: string;
  vulnerabilityId: string;
  canonicalAdvisoryId: string;
  sourceFeedKey: "nvd";
  configuration: NvdConfigurationNode;
  configurationPath?: string;
}>;

type Truth = "true" | "false" | "unknown";
type NodeEvaluation = Readonly<{
  truth: Truth;
  hasVulnerableMatch: boolean;
  hasVersionSpecificVulnerableMatch: boolean;
  mayHaveVulnerableMatch: boolean;
  invalidCpe: boolean;
  platformUnresolved: boolean;
}>;

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
 * Evaluates NVD CPE configurations only when PURL matching is unavailable.
 * A syntactically valid PURL is never passed through this fallback, even when
 * that PURL later produces a reviewable PURL result.
 */
export function evaluateCpeNvdComponent(
  component: MatchableComponent,
  candidates: readonly NvdCpeCandidate[],
  now = new Date().toISOString(),
): readonly MatchEvaluationDraft[] {
  if (
    component.canonicalPurl &&
    purlMatchingIdentity(component.canonicalPurl)
  ) {
    return [];
  }

  // No CPE is not a malformed CPE. It simply leaves this component without a
  // deterministic fallback identity and must not create review noise.
  if (!component.canonicalCpe) return [];
  const parsedComponent = parseCpeIdentity(component.canonicalCpe);
  if (!parsedComponent) {
    return [cpeReview(component, "invalid_cpe", now)];
  }

  const version = component.normalizedVersion ?? parsedComponent.version;
  if (!version) return [cpeReview(component, "unparseable_version", now)];

  const comparator = comparatorForComponent(component.ecosystem);
  return candidates.map((candidate) => {
    const evaluated = evaluateNode(
      candidate.configuration,
      parsedComponent,
      version,
      comparator,
    );
    const base = candidateEvidence(component, candidate, version, now);

    if (evaluated.truth === "unknown") {
      return {
        ...base,
        outcome: "reviewable",
        reviewCode: evaluated.invalidCpe
          ? "invalid_cpe"
          : evaluated.platformUnresolved
            ? "platform_constraint_unresolved"
            : "unparseable_version",
      };
    }
    if (evaluated.truth === "false" || !evaluated.hasVulnerableMatch) {
      return { ...base, outcome: "not_affected" };
    }

    const specificity = evaluated.hasVersionSpecificVulnerableMatch
      ? "version_specific"
      : "broad_family";
    const confidence =
      specificity === "version_specific"
        ? CPE_NVD_CONFIDENCE_TABLE.versionSpecific
        : CPE_NVD_CONFIDENCE_TABLE.broadFamily;
    return {
      ...base,
      outcome: "affected",
      cpeSpecificity: specificity,
      confidence: confidence.score,
      confidenceTableVersion: CPE_NVD_CONFIDENCE_TABLE_VERSION,
      confidenceExplanation: confidence.explanation,
    };
  });
}

/** Parses a complete CPE identity without inferring wildcard vendor/product values. */
export function parseCpeIdentity(value: string): CpeIdentity | null {
  const trimmed = value.trim();
  if (trimmed.toLowerCase().startsWith("cpe:2.3:")) {
    return parseCpe23(trimmed);
  }
  if (trimmed.toLowerCase().startsWith("cpe:/")) return parseCpeUri(trimmed);
  return null;
}

function parseCpe23(value: string): CpeIdentity | null {
  const parts = splitEscaped(value, ":");
  if (!parts || parts.length !== 13 || parts[0]?.toLowerCase() !== "cpe") {
    return null;
  }
  if (parts[1] !== "2.3") return null;
  return identityFromParts("2.3", parts.slice(2));
}

function parseCpeUri(value: string): CpeIdentity | null {
  const body = value.slice(5);
  const parts = splitEscaped(body, ":");
  if (!parts || parts.length < 3 || parts.length > 7) return null;
  return identityFromParts("uri", [
    ...parts,
    ...Array.from({ length: 11 - parts.length }, () => "*"),
  ]);
}

function identityFromParts(
  binding: CpeIdentity["binding"],
  parts: readonly string[],
): CpeIdentity | null {
  const [
    partValue,
    vendorValue,
    productValue,
    versionValue,
    updateValue,
    ,
    ,
    ,
    targetSoftwareValue,
    targetHardwareValue,
  ] = parts;
  if (
    (partValue !== "a" && partValue !== "h" && partValue !== "o") ||
    !vendorValue ||
    !productValue
  ) {
    return null;
  }
  const vendor = normalizeCpeValue(vendorValue);
  const product = normalizeCpeValue(productValue);
  const version = normalizeOptionalCpeValue(versionValue);
  const update = normalizeOptionalCpeValue(updateValue);
  const targetSoftware = normalizeOptionalCpeValue(targetSoftwareValue);
  const targetHardware = normalizeOptionalCpeValue(targetHardwareValue);
  if (
    !vendor ||
    !product ||
    vendor === "*" ||
    product === "*" ||
    vendor === "-" ||
    product === "-"
  ) {
    return null;
  }
  return {
    binding,
    part: partValue,
    vendor,
    product,
    version,
    update,
    targetSoftware,
    targetHardware,
  };
}

function splitEscaped(value: string, delimiter: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === delimiter) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) return null;
  parts.push(current);
  return parts;
}

function normalizeCpeValue(value: string): string | null {
  if (
    !value ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    return null;
  }
  return value.toLowerCase();
}

function normalizeOptionalCpeValue(value: string | undefined): string | null {
  if (value === undefined || value === "*" || value === "-") return null;
  return normalizeCpeValue(value);
}

function comparatorForComponent(ecosystem: string | null): VersionComparatorId {
  const normalized = ecosystem?.trim().toLowerCase();
  return normalized
    ? (comparatorByEcosystem[normalized] ?? "semver")
    : "semver";
}

function evaluateNode(
  node: NvdConfigurationNode,
  component: CpeIdentity,
  version: string,
  comparator: VersionComparatorId,
): NodeEvaluation {
  const children = [
    ...node.cpeMatch.map((match) =>
      evaluateCpeMatch(match, component, version, comparator),
    ),
    ...node.nodes.map((child) =>
      evaluateNode(child, component, version, comparator),
    ),
  ];
  if (children.length === 0) return unknown({ invalidCpe: true });
  const aggregate =
    node.operator === "AND" ? evaluateAnd(children) : evaluateOr(children);
  if (!node.negate) return aggregate;
  return {
    ...aggregate,
    truth: invert(aggregate.truth),
    // A negated vulnerable predicate is a condition, not positive proof.
    hasVulnerableMatch: false,
    hasVersionSpecificVulnerableMatch: false,
  };
}

function evaluateCpeMatch(
  match: NvdCpeMatch,
  component: CpeIdentity,
  version: string,
  comparator: VersionComparatorId,
): NodeEvaluation {
  const criteria = parseCpeIdentity(match.criteria);
  if (!criteria)
    return unknown({
      invalidCpe: true,
      mayHaveVulnerableMatch: match.vulnerable,
    });

  const identity = compareIdentity(component, criteria);
  if (identity === "platform_unresolved") {
    return unknown({
      platformUnresolved: true,
      mayHaveVulnerableMatch: match.vulnerable,
    });
  }
  if (!identity) return knownFalse(match.vulnerable);

  const bounded = versionMatches(match, criteria, version, comparator);
  if (bounded === "unknown") {
    return unknown({ mayHaveVulnerableMatch: match.vulnerable });
  }
  if (!bounded) return knownFalse(match.vulnerable);
  return {
    truth: "true",
    hasVulnerableMatch: match.vulnerable,
    hasVersionSpecificVulnerableMatch:
      match.vulnerable && matchHasVersionSpecificity(match, criteria),
    mayHaveVulnerableMatch: match.vulnerable,
    invalidCpe: false,
    platformUnresolved: false,
  };
}

function compareIdentity(
  component: CpeIdentity,
  criteria: CpeIdentity,
): boolean | "platform_unresolved" {
  if (
    component.part !== criteria.part ||
    component.vendor !== criteria.vendor ||
    component.product !== criteria.product
  ) {
    // A non-application predicate in an AND tree may describe a platform that
    // an SBOM component alone cannot prove absent.
    return criteria.part === "o" || criteria.part === "h"
      ? "platform_unresolved"
      : false;
  }
  if (
    (criteria.targetSoftware &&
      criteria.targetSoftware !== component.targetSoftware) ||
    (criteria.targetHardware &&
      criteria.targetHardware !== component.targetHardware)
  ) {
    return "platform_unresolved";
  }
  return true;
}

function versionMatches(
  match: NvdCpeMatch,
  criteria: CpeIdentity,
  version: string,
  comparator: VersionComparatorId,
): boolean | "unknown" {
  if (criteria.version) {
    const exact = compareVersion(comparator, version, criteria.version);
    if (exact.kind === "unsupported") return "unknown";
    if (exact.ordering !== 0) return false;
  }
  return withinBoundary(
    match.versionStartIncluding,
    version,
    comparator,
    ">=",
  ) &&
    withinBoundary(match.versionStartExcluding, version, comparator, ">") &&
    withinBoundary(match.versionEndIncluding, version, comparator, "<=") &&
    withinBoundary(match.versionEndExcluding, version, comparator, "<")
    ? true
    : boundaryWasUnsupported(match, version, comparator)
      ? "unknown"
      : false;
}

function withinBoundary(
  boundary: string | null | undefined,
  version: string,
  comparator: VersionComparatorId,
  expected: ">=" | ">" | "<=" | "<",
): boolean {
  if (!boundary) return true;
  const result = compareVersion(comparator, version, boundary);
  if (result.kind === "unsupported") return false;
  return expected === ">="
    ? result.ordering >= 0
    : expected === ">"
      ? result.ordering > 0
      : expected === "<="
        ? result.ordering <= 0
        : result.ordering < 0;
}

function boundaryWasUnsupported(
  match: NvdCpeMatch,
  version: string,
  comparator: VersionComparatorId,
): boolean {
  return [
    match.versionStartIncluding,
    match.versionStartExcluding,
    match.versionEndIncluding,
    match.versionEndExcluding,
  ].some((boundary) =>
    boundary
      ? compareVersion(comparator, version, boundary).kind === "unsupported"
      : false,
  );
}

function evaluateAnd(children: readonly NodeEvaluation[]): NodeEvaluation {
  if (children.some((child) => child.truth === "false"))
    return combine("false", children);
  if (children.some((child) => child.truth === "unknown"))
    return combine("unknown", children);
  return combine("true", children);
}

function evaluateOr(children: readonly NodeEvaluation[]): NodeEvaluation {
  const trueChildren = children.filter((child) => child.truth === "true");
  if (trueChildren.some((child) => child.hasVulnerableMatch))
    return combine("true", trueChildren);
  if (
    children.some(
      (child) => child.truth === "unknown" && child.mayHaveVulnerableMatch,
    )
  ) {
    return combine("unknown", children);
  }
  if (trueChildren.length > 0) return combine("true", trueChildren);
  // A non-vulnerable platform predicate cannot itself establish applicability.
  // In an OR branch it must not turn an otherwise non-matching application
  // predicate into a review item. AND still preserves the unresolved platform
  // condition through evaluateAnd.
  const relevant = children.filter(
    (child) => child.truth !== "unknown" || child.mayHaveVulnerableMatch,
  );
  if (relevant.some((child) => child.truth === "unknown"))
    return combine("unknown", relevant);
  return combine("false", relevant);
}

function combine(
  truth: Truth,
  children: readonly NodeEvaluation[],
): NodeEvaluation {
  return {
    truth,
    hasVulnerableMatch: children.some((child) => child.hasVulnerableMatch),
    hasVersionSpecificVulnerableMatch: children.some(
      (child) => child.hasVersionSpecificVulnerableMatch,
    ),
    mayHaveVulnerableMatch: children.some(
      (child) => child.mayHaveVulnerableMatch,
    ),
    invalidCpe: children.some((child) => child.invalidCpe),
    platformUnresolved: children.some((child) => child.platformUnresolved),
  };
}

function knownFalse(mayHaveVulnerableMatch: boolean): NodeEvaluation {
  return {
    truth: "false",
    hasVulnerableMatch: false,
    hasVersionSpecificVulnerableMatch: false,
    mayHaveVulnerableMatch,
    invalidCpe: false,
    platformUnresolved: false,
  };
}

function unknown(
  partial: Partial<
    Omit<
      NodeEvaluation,
      "truth" | "hasVulnerableMatch" | "hasVersionSpecificVulnerableMatch"
    >
  >,
): NodeEvaluation {
  return {
    truth: "unknown",
    hasVulnerableMatch: false,
    hasVersionSpecificVulnerableMatch: false,
    mayHaveVulnerableMatch: partial.mayHaveVulnerableMatch ?? false,
    invalidCpe: partial.invalidCpe ?? false,
    platformUnresolved: partial.platformUnresolved ?? false,
  };
}

function invert(truth: Truth): Truth {
  return truth === "true" ? "false" : truth === "false" ? "true" : "unknown";
}

function matchHasVersionSpecificity(
  match: NvdCpeMatch,
  criteria: CpeIdentity,
): boolean {
  return Boolean(
    criteria.version ||
    match.versionStartIncluding ||
    match.versionStartExcluding ||
    match.versionEndIncluding ||
    match.versionEndExcluding,
  );
}

function candidateEvidence(
  component: MatchableComponent,
  candidate: NvdCpeCandidate,
  version: string,
  now: string,
): Omit<MatchEvaluationDraft, "outcome" | "reviewCode"> {
  return {
    componentId: component.componentId,
    affectedRangeId: candidate.affectedRangeId,
    sourceRecordId: candidate.sourceRecordId,
    sourceRecordVersionId: candidate.sourceRecordVersionId,
    vulnerabilityId: candidate.vulnerabilityId,
    canonicalAdvisoryId: candidate.canonicalAdvisoryId,
    matchMethod: "cpe_nvd",
    sourceFeedKey: "nvd",
    comparatorName: comparatorForComponent(component.ecosystem),
    comparatorVersion: CPE_NVD_CONFIDENCE_TABLE_VERSION,
    evaluatedComponentValue: version,
    cpeConfigurationEvidence: Object.freeze({
      configuration: candidate.configuration,
      operator: candidate.configuration.operator,
      ...(candidate.configurationPath
        ? { configurationPath: candidate.configurationPath }
        : {}),
    }),
    evaluatedAt: now,
  };
}

function cpeReview(
  component: MatchableComponent,
  reviewCode: "invalid_cpe" | "unparseable_version",
  now: string,
): MatchEvaluationDraft {
  return {
    componentId: component.componentId,
    outcome: "reviewable",
    reviewCode,
    matchMethod: "cpe_nvd",
    sourceFeedKey: "nvd",
    evaluatedComponentValue: component.normalizedVersion ?? "",
    evaluatedAt: now,
  };
}
