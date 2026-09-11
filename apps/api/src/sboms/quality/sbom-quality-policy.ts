/**
 * The quality formula is deliberately small and fully deterministic. It is a
 * technical completeness signal, not a legal conclusion or release gate.
 */
export const SBOM_QUALITY_FORMULA_VERSION = "sbom-quality.v1" as const;
export const BSI_TR_03183_2_RULESET_VERSION = "bsi-tr-03183-2.v2.0.0" as const;
export const QUALITY_TOTAL_REGRESSION_THRESHOLD = 5;
export const QUALITY_DIMENSION_REGRESSION_THRESHOLD = 10;
export const QUALITY_TRANSITIVE_DEPTH_TARGET = 3;

export type SbomQualityDimensionId =
  | "purl"
  | "hash"
  | "supplier"
  | "license"
  | "top_level_dependency"
  | "transitive_depth";
export type SbomQualityDimensionStatus =
  "complete" | "partial" | "missing" | "not_assessable";

export type SbomQualityComponentFact = Readonly<{
  canonicalPurl: string | null;
  hashes: readonly Readonly<{ algorithm: string; value: string }>[];
  supplier?: string | null;
  supplierValues?: readonly string[];
  licenseExpression?: string | null;
  licenseValues?: readonly string[];
  depth: number;
}>;

export type SbomQualityFacts = Readonly<{
  components: readonly SbomQualityComponentFact[];
  primaryComponent: Readonly<{
    id: string;
    directDependencyCount: number;
  }> | null;
  maximumDepth?: number;
}>;

/**
 * Bounded worker state.  Workers merge one cursor page at a time and retain
 * counts only; source component facts never need to accumulate in memory.
 */
export type SbomQualityAccumulator = Readonly<{
  componentCount: number;
  componentsWithCanonicalPurl: number;
  componentsWithValidHash: number;
  componentsWithSupplier: number;
  componentsWithLicense: number;
  maximumDepth: number;
  primaryComponent: Readonly<{
    id: string;
    directDependencyCount: number;
  }> | null;
}>;

export type SbomQualityInputs = Readonly<{
  componentCount: number;
  componentsWithCanonicalPurl: number;
  componentsWithValidHash: number;
  componentsWithSupplier: number;
  componentsWithLicense: number;
  primaryComponentIdentified: boolean;
  primaryComponentDirectDependencyCount: number;
  maximumDepth: number;
}>;

export type SbomQualityDimension = Readonly<{
  id: SbomQualityDimensionId;
  eligibleCount: number;
  satisfiedCount: number;
  coveragePercent: number;
  score: number;
  weight: number;
  weightedScore: number;
  status: SbomQualityDimensionStatus;
}>;

export type SbomQualityResult = Readonly<{
  formulaVersion: typeof SBOM_QUALITY_FORMULA_VERSION;
  inputs: SbomQualityInputs;
  dimensions: readonly SbomQualityDimension[];
  totalScore: number;
}>;

export type SbomQualityComparison = Readonly<{
  status: "none" | "regression";
  totalScoreDelta: number;
  changedDimensions: readonly SbomQualityDimensionId[];
  materialDimensionIds: readonly SbomQualityDimensionId[];
}>;

export type BsiTr03183_2Finding = Readonly<{
  code: string;
  severity: "warning" | "error";
  sourcePath: string;
  expected: string;
  actual: string;
  remediation: string;
}>;

const formulaDimensions: readonly Readonly<{
  id: SbomQualityDimensionId;
  weight: number;
}>[] = Object.freeze([
  Object.freeze({ id: "purl", weight: 20 }),
  Object.freeze({ id: "hash", weight: 20 }),
  Object.freeze({ id: "supplier", weight: 15 }),
  Object.freeze({ id: "license", weight: 15 }),
  Object.freeze({ id: "top_level_dependency", weight: 20 }),
  Object.freeze({ id: "transitive_depth", weight: 10 }),
]);

const hashLengths = Object.freeze(
  new Map<string, number>([
    ["SHA256", 64],
    ["SHA384", 96],
    ["SHA512", 128],
    ["SHA3256", 64],
    ["SHA3384", 96],
    ["SHA3512", 128],
    ["BLAKE2B256", 64],
    ["BLAKE2B384", 96],
    ["BLAKE2B512", 128],
  ]),
);

const placeholderValues = new Set(["NOASSERTION", "NONE", "UNKNOWN"]);

/**
 * Accept only currently supported strong, correctly encoded digest values.
 * The raw source hash remains stored even when it does not earn quality
 * coverage, so this function never erases evidence or rewrites it.
 */
export function isRecognizedCryptographicHash(
  algorithm: string,
  value: string,
): boolean {
  const expectedLength = hashLengths.get(normalizeHashAlgorithm(algorithm));
  return (
    expectedLength !== undefined &&
    value.length === expectedLength &&
    /^[a-fA-F0-9]+$/.test(value)
  );
}

/** Computes every score from durable, bounded normalized graph facts. */
export function calculateSbomQuality(
  facts: SbomQualityFacts,
): SbomQualityResult {
  validateFacts(facts);
  return calculateSbomQualityFromAccumulator(
    accumulateSbomQualityFacts(
      emptySbomQualityAccumulator(facts.primaryComponent),
      facts.components,
      facts.maximumDepth,
    ),
  );
}

export function emptySbomQualityAccumulator(
  primaryComponent: SbomQualityFacts["primaryComponent"] = null,
): SbomQualityAccumulator {
  if (
    primaryComponent !== null &&
    (!Number.isSafeInteger(primaryComponent.directDependencyCount) ||
      primaryComponent.directDependencyCount < 0)
  ) {
    throw new Error(
      "primaryComponent directDependencyCount must be non-negative",
    );
  }
  return Object.freeze({
    componentCount: 0,
    componentsWithCanonicalPurl: 0,
    componentsWithValidHash: 0,
    componentsWithSupplier: 0,
    componentsWithLicense: 0,
    maximumDepth: 0,
    primaryComponent,
  });
}

/** Returns a new aggregate, preserving immutability between durable pages. */
export function accumulateSbomQualityFacts(
  accumulator: SbomQualityAccumulator,
  components: readonly SbomQualityComponentFact[],
  reportedMaximumDepth?: number,
): SbomQualityAccumulator {
  if (
    reportedMaximumDepth !== undefined &&
    (!Number.isSafeInteger(reportedMaximumDepth) || reportedMaximumDepth < 0)
  ) {
    throw new Error("maximumDepth must be a non-negative safe integer");
  }
  const page = components.reduce(
    (counts, component) => {
      if (!Number.isSafeInteger(component.depth) || component.depth < 0)
        throw new Error("component depth must be a non-negative safe integer");
      return {
        componentCount: counts.componentCount + 1,
        componentsWithCanonicalPurl:
          counts.componentsWithCanonicalPurl +
          Number(hasMeaningfulValue(component.canonicalPurl)),
        componentsWithValidHash:
          counts.componentsWithValidHash +
          Number(
            component.hashes.some((hash) =>
              isRecognizedCryptographicHash(hash.algorithm, hash.value),
            ),
          ),
        componentsWithSupplier:
          counts.componentsWithSupplier +
          Number(hasMeaningfulValue(...componentValues(component, "supplier"))),
        componentsWithLicense:
          counts.componentsWithLicense +
          Number(hasMeaningfulValue(...componentValues(component, "license"))),
        maximumDepth: Math.max(counts.maximumDepth, component.depth),
      };
    },
    {
      componentCount: accumulator.componentCount,
      componentsWithCanonicalPurl: accumulator.componentsWithCanonicalPurl,
      componentsWithValidHash: accumulator.componentsWithValidHash,
      componentsWithSupplier: accumulator.componentsWithSupplier,
      componentsWithLicense: accumulator.componentsWithLicense,
      maximumDepth: accumulator.maximumDepth,
    },
  );
  return Object.freeze({
    ...page,
    maximumDepth: Math.max(page.maximumDepth, reportedMaximumDepth ?? 0),
    primaryComponent: accumulator.primaryComponent,
  });
}

export function calculateSbomQualityFromAccumulator(
  accumulator: SbomQualityAccumulator,
): SbomQualityResult {
  const inputs = freezeInputs({
    componentCount: accumulator.componentCount,
    componentsWithCanonicalPurl: accumulator.componentsWithCanonicalPurl,
    componentsWithValidHash: accumulator.componentsWithValidHash,
    componentsWithSupplier: accumulator.componentsWithSupplier,
    componentsWithLicense: accumulator.componentsWithLicense,
    primaryComponentIdentified: accumulator.primaryComponent !== null,
    primaryComponentDirectDependencyCount:
      accumulator.primaryComponent?.directDependencyCount ?? 0,
    maximumDepth: accumulator.maximumDepth,
  });

  return calculateSbomQualityFromInputs(inputs);
}

/** Computes deterministic quality scores from pre-aggregated bounded facts. */
export function calculateSbomQualityFromInputs(
  inputs: SbomQualityInputs,
): SbomQualityResult {
  const frozenInputs = freezeInputs(inputs);
  const dimensions = Object.freeze(
    formulaDimensions.map((definition) =>
      freezeDimension(definition, dimensionCounts(definition.id, frozenInputs)),
    ),
  );
  return Object.freeze({
    formulaVersion: SBOM_QUALITY_FORMULA_VERSION,
    inputs: frozenInputs,
    dimensions,
    totalScore: round(
      dimensions.reduce(
        (total, dimension) => total + dimension.weightedScore,
        0,
      ),
    ),
  });
}

/**
 * Regression comparisons intentionally use strict inequality: exactly -5
 * total points or -10 points for a material dimension is not a regression.
 */
export function compareSbomQuality(
  current: SbomQualityResult,
  baseline: SbomQualityResult,
): SbomQualityComparison {
  const currentById = new Map(
    current.dimensions.map((dimension) => [dimension.id, dimension]),
  );
  const changedDimensions = formulaDimensions
    .map(({ id }) => {
      const currentDimension = currentById.get(id);
      const baselineDimension = baseline.dimensions.find(
        (dimension) => dimension.id === id,
      );
      return currentDimension !== undefined &&
        baselineDimension !== undefined &&
        currentDimension.score !== baselineDimension.score
        ? id
        : null;
    })
    .filter((id): id is SbomQualityDimensionId => id !== null);
  const materialDimensionIds = changedDimensions.filter((id) => {
    const currentDimension = currentById.get(id)!;
    const baselineDimension = baseline.dimensions.find(
      (dimension) => dimension.id === id,
    )!;
    return (
      currentDimension.score - baselineDimension.score <
      -QUALITY_DIMENSION_REGRESSION_THRESHOLD
    );
  });
  const totalScoreDelta = round(current.totalScore - baseline.totalScore);
  return Object.freeze({
    status:
      totalScoreDelta < -QUALITY_TOTAL_REGRESSION_THRESHOLD ||
      materialDimensionIds.length > 0
        ? "regression"
        : "none",
    totalScoreDelta,
    changedDimensions: Object.freeze(changedDimensions),
    materialDimensionIds: Object.freeze(materialDimensionIds),
  });
}

/**
 * This is a transparent, version-pinned technical profile mapping. Each
 * finding names the profile rule, source field family, observed input, and a
 * remediation path; consumers must not present it as legal advice.
 */
export function evaluateBsiTr03183_2(
  quality: SbomQualityResult,
): readonly BsiTr03183_2Finding[] {
  const findings: BsiTr03183_2Finding[] = [];
  for (const dimension of quality.dimensions) {
    if (
      dimension.id === "transitive_depth" ||
      dimension.status === "complete"
    ) {
      continue;
    }
    findings.push(
      freezeBsiFinding({
        code: bsiRuleCode(dimension.id),
        severity:
          dimension.status === "missing" || dimension.coveragePercent === 0
            ? "error"
            : "warning",
        sourcePath: bsiSourcePath(dimension.id),
        expected: bsiExpected(dimension.id),
        actual: `${dimension.satisfiedCount} of ${dimension.eligibleCount} eligible values`,
        remediation: bsiRemediation(dimension.id),
      }),
    );
  }
  return Object.freeze(findings);
}

function dimensionCounts(
  id: SbomQualityDimensionId,
  inputs: SbomQualityInputs,
): Readonly<{ eligibleCount: number; satisfiedCount: number }> {
  switch (id) {
    case "purl":
      return counts(inputs.componentCount, inputs.componentsWithCanonicalPurl);
    case "hash":
      return counts(inputs.componentCount, inputs.componentsWithValidHash);
    case "supplier":
      return counts(inputs.componentCount, inputs.componentsWithSupplier);
    case "license":
      return counts(inputs.componentCount, inputs.componentsWithLicense);
    case "top_level_dependency":
      return inputs.primaryComponentIdentified
        ? counts(1, inputs.primaryComponentDirectDependencyCount > 0 ? 1 : 0)
        : counts(0, 0);
    case "transitive_depth":
      return inputs.componentCount === 0
        ? counts(0, 0)
        : counts(
            QUALITY_TRANSITIVE_DEPTH_TARGET,
            Math.min(inputs.maximumDepth, QUALITY_TRANSITIVE_DEPTH_TARGET),
          );
  }
}

function freezeDimension(
  definition: Readonly<{ id: SbomQualityDimensionId; weight: number }>,
  values: Readonly<{ eligibleCount: number; satisfiedCount: number }>,
): SbomQualityDimension {
  const coveragePercent =
    values.eligibleCount === 0
      ? 0
      : round((values.satisfiedCount / values.eligibleCount) * 100);
  return Object.freeze({
    id: definition.id,
    ...values,
    coveragePercent,
    score: coveragePercent,
    weight: definition.weight,
    weightedScore: round((coveragePercent * definition.weight) / 100),
    status:
      values.eligibleCount === 0
        ? "not_assessable"
        : values.satisfiedCount === values.eligibleCount
          ? "complete"
          : values.satisfiedCount === 0
            ? "missing"
            : "partial",
  });
}

function componentValues(
  component: SbomQualityComponentFact,
  field: "supplier" | "license",
): readonly string[] {
  if (field === "supplier") {
    return component.supplierValues ?? [component.supplier ?? ""];
  }
  return component.licenseValues ?? [component.licenseExpression ?? ""];
}

function hasMeaningfulValue(
  ...values: readonly (string | null | undefined)[]
): boolean {
  return values.some((value) => {
    const normalized = value?.trim();
    return (
      normalized !== undefined &&
      normalized.length > 0 &&
      !placeholderValues.has(normalized.toUpperCase())
    );
  });
}

function counts(eligibleCount: number, satisfiedCount: number) {
  return Object.freeze({ eligibleCount, satisfiedCount });
}

function freezeInputs(inputs: SbomQualityInputs): SbomQualityInputs {
  return Object.freeze({ ...inputs });
}

function normalizeHashAlgorithm(algorithm: string): string {
  return algorithm
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, "");
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateFacts(facts: SbomQualityFacts): void {
  if (
    !Number.isSafeInteger(facts.maximumDepth ?? 0) ||
    (facts.maximumDepth ?? 0) < 0
  ) {
    throw new Error("maximumDepth must be a non-negative safe integer");
  }
  if (
    facts.primaryComponent !== null &&
    (!Number.isSafeInteger(facts.primaryComponent.directDependencyCount) ||
      facts.primaryComponent.directDependencyCount < 0)
  ) {
    throw new Error(
      "primaryComponent directDependencyCount must be non-negative",
    );
  }
  for (const component of facts.components) {
    if (!Number.isSafeInteger(component.depth) || component.depth < 0) {
      throw new Error("component depth must be a non-negative safe integer");
    }
  }
}

function freezeBsiFinding(finding: BsiTr03183_2Finding): BsiTr03183_2Finding {
  return Object.freeze({ ...finding });
}

function bsiRuleCode(dimension: SbomQualityDimensionId): string {
  const suffix: Readonly<
    Record<Exclude<SbomQualityDimensionId, "transitive_depth">, string>
  > = {
    purl: "PURL",
    hash: "HASH",
    supplier: "SUPPLIER",
    license: "LICENSE",
    top_level_dependency: "DEPENDENCY",
  };
  return `CRA-BSI-03183-2-${suffix[dimension as Exclude<SbomQualityDimensionId, "transitive_depth">]}`;
}

function bsiSourcePath(dimension: SbomQualityDimensionId): string {
  const paths: Readonly<
    Record<Exclude<SbomQualityDimensionId, "transitive_depth">, string>
  > = {
    purl: "components[].purl",
    hash: "components[].hashes[]",
    supplier: "components[].supplier",
    license: "components[].license",
    top_level_dependency: "metadata.component/dependencies",
  };
  return paths[
    dimension as Exclude<SbomQualityDimensionId, "transitive_depth">
  ];
}

function bsiExpected(dimension: SbomQualityDimensionId): string {
  const expected: Readonly<
    Record<Exclude<SbomQualityDimensionId, "transitive_depth">, string>
  > = {
    purl: "A canonical package URL for every component",
    hash: "A recognized, correctly encoded cryptographic hash for every component",
    supplier: "A supplier value for every component",
    license: "A license value for every component",
    top_level_dependency:
      "An identifiable primary component with direct dependencies",
  };
  return expected[
    dimension as Exclude<SbomQualityDimensionId, "transitive_depth">
  ];
}

function bsiRemediation(dimension: SbomQualityDimensionId): string {
  const remediations: Readonly<
    Record<Exclude<SbomQualityDimensionId, "transitive_depth">, string>
  > = {
    purl: "Add a valid PURL for each affected component.",
    hash: "Add a supported SHA-2, SHA-3, or BLAKE2b digest with its complete value.",
    supplier: "Add the component supplier or manufacturer in the source SBOM.",
    license:
      "Add an SPDX license expression or declared license in the source SBOM.",
    top_level_dependency:
      "Declare the primary component and its direct dependencies in the source SBOM.",
  };
  return remediations[
    dimension as Exclude<SbomQualityDimensionId, "transitive_depth">
  ];
}
