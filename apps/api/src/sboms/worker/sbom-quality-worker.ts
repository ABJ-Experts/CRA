import { Logger } from "@nestjs/common";
import { z } from "zod";

import {
  BSI_TR_03183_2_RULESET_VERSION,
  calculateSbomQualityFromInputs,
  compareSbomQuality,
  evaluateBsiTr03183_2,
  type SbomQualityComponentFact,
  type SbomQualityDimensionId,
  type SbomQualityInputs,
  type SbomQualityResult,
  isRecognizedCryptographicHash,
} from "../quality/sbom-quality-policy";

const uuidSchema = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type SbomQualityClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      reportId: string;
      sourceId: string;
      releaseId: string;
      documentId: string;
      profileEnabled: boolean;
      rulesetVersion: string;
      configurationVersion: number;
      baseline:
        | Readonly<{ status: "first_document" | "no_baseline" }>
        | Readonly<{
            status: "available";
            reportId: string;
            sourceId: string;
            totalScore: number;
            completedAt: string;
            quality: SbomQualityResult;
          }>;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export type SbomQualityFactPage = Readonly<{
  components: readonly SbomQualityComponentFact[];
  primaryComponent: Readonly<{
    id: string;
    directDependencyCount: number;
  }> | null;
  maximumDepth: number;
  nextCursor: string | null;
}>;

export type SbomQualityFindingDraft = Readonly<{
  kind: "coverage_gap" | "bsi_rule" | "regression";
  code: string;
  ruleId: string | null;
  severity: "info" | "warning" | "error";
  dimension: SbomQualityDimensionId | null;
  componentId: string | null;
  sourcePath: string | null;
  expected: string | null;
  actual: string | null;
  remediation: string;
}>;

export type SbomQualityReportDraft = Readonly<{
  assessmentStatus:
    | "valid"
    | "warning"
    | "invalid"
    | "first_document"
    | "no_baseline"
    | "regression";
  quality: SbomQualityResult;
  bsiProfile: Readonly<{
    enabled: boolean;
    status: "disabled" | "valid" | "warning" | "invalid" | "unavailable";
    rulesetVersion: string;
    findingCount: number;
  }>;
  baseline: Extract<SbomQualityClaim, { outcome: "claimed" }>["baseline"];
  regression: Readonly<{
    status: "none" | "regression";
    totalScoreDelta: number;
    changedDimensions: readonly SbomQualityDimensionId[];
  }>;
}>;

export interface SbomQualityQueue {
  dueQualityOrganizationIds(): Promise<readonly string[]>;
  claimQualityReport(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SbomQualityClaim>;
  readQualityFactPage(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      documentId: string;
      limit: number;
      cursor?: string;
    }>,
  ): Promise<SbomQualityFactPage>;
  persistQualityReport(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      workerId: string;
      report: SbomQualityReportDraft;
      findings: readonly SbomQualityFindingDraft[];
    }>,
  ): Promise<void>;
  failQualityReport(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      workerId: string;
      errorCode:
        | "quality_source_missing"
        | "quality_statement_timeout"
        | "quality_calculation_failed"
        | "provider_unavailable";
      message: string;
    }>,
  ): Promise<void>;
}

export class SbomQualityWorker {
  private readonly logger = new Logger(SbomQualityWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SbomQualityQueue;
      pageSize?: number;
      maximumComponents?: number;
    }>,
  ) {
    if (!uuidSchema.safeParse(dependencies.workerId).success)
      throw new Error("invalid sbom quality worker id");
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid sbom quality worker lease");
    }
    if (
      !Number.isSafeInteger(dependencies.pageSize ?? 1_000) ||
      (dependencies.pageSize ?? 1_000) < 1 ||
      (dependencies.pageSize ?? 1_000) > 5_000 ||
      !Number.isSafeInteger(dependencies.maximumComponents ?? 50_000) ||
      (dependencies.maximumComponents ?? 50_000) < 1
    ) {
      throw new Error("invalid sbom quality worker bounds");
    }
  }

  async runOnce(): Promise<void> {
    let due = unique(await this.dependencies.queue.dueQualityOrganizationIds());
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        if (await this.processOne(organizationId)) {
          nextRound.push(organizationId);
          remaining -= 1;
        }
      }
      due = nextRound;
    }
  }

  private async processOne(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.queue.claimQualityReport(
      organizationId,
      {
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
      },
    );
    if (claim.outcome !== "claimed") return false;
    try {
      const inputs = await this.readInputs(organizationId, claim);
      const quality = calculateSbomQualityFromInputs(inputs);
      const bsiFindings =
        claim.profileEnabled &&
        claim.rulesetVersion === BSI_TR_03183_2_RULESET_VERSION
          ? evaluateBsiTr03183_2(quality)
          : [];
      const regression =
        claim.baseline.status === "available"
          ? compareSbomQuality(quality, claim.baseline.quality)
          : {
              status: "none" as const,
              totalScoreDelta: 0,
              changedDimensions: [],
              materialDimensionIds: [],
            };
      const findings = findingsFor(quality, bsiFindings, regression);
      await this.dependencies.queue.persistQualityReport(organizationId, {
        reportId: claim.reportId,
        workerId: this.dependencies.workerId,
        report: {
          assessmentStatus: assessmentStatus(
            quality,
            bsiFindings,
            claim.baseline.status,
            regression.status,
          ),
          quality,
          bsiProfile: {
            enabled: claim.profileEnabled,
            status: claim.profileEnabled
              ? bsiFindings.some((finding) => finding.severity === "error")
                ? "invalid"
                : bsiFindings.length > 0
                  ? "warning"
                  : "valid"
              : "disabled",
            rulesetVersion: claim.rulesetVersion,
            findingCount: bsiFindings.length,
          },
          baseline: claim.baseline,
          regression,
        },
        findings,
      });
    } catch (error) {
      await this.dependencies.queue.failQualityReport(organizationId, {
        reportId: claim.reportId,
        workerId: this.dependencies.workerId,
        errorCode:
          error instanceof QualityWorkerError
            ? error.code
            : "provider_unavailable",
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "SBOM quality worker failed.",
      });
      this.logger.warn({
        message: "sbom quality cycle failed",
        error: errorSummary(error),
      });
    }
    return true;
  }

  private async readInputs(
    organizationId: string,
    claim: Extract<SbomQualityClaim, { outcome: "claimed" }>,
  ): Promise<SbomQualityInputs> {
    let inputs: SbomQualityInputs = {
      componentCount: 0,
      componentsWithCanonicalPurl: 0,
      componentsWithValidHash: 0,
      componentsWithSupplier: 0,
      componentsWithLicense: 0,
      primaryComponentIdentified: false,
      primaryComponentDirectDependencyCount: 0,
      maximumDepth: 0,
    };
    let cursor: string | undefined;
    do {
      const page = await this.dependencies.queue.readQualityFactPage(
        organizationId,
        {
          reportId: claim.reportId,
          documentId: claim.documentId,
          limit: this.dependencies.pageSize ?? 1_000,
          cursor,
        },
      );
      inputs = addPage(inputs, page);
      if (
        inputs.componentCount > (this.dependencies.maximumComponents ?? 50_000)
      ) {
        throw new QualityWorkerError(
          "quality_calculation_failed",
          "The SBOM quality input exceeds the configured component ceiling.",
        );
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return Object.freeze(inputs);
  }
}

function addPage(
  current: SbomQualityInputs,
  page: SbomQualityFactPage,
): SbomQualityInputs {
  return Object.freeze({
    componentCount: current.componentCount + page.components.length,
    componentsWithCanonicalPurl:
      current.componentsWithCanonicalPurl +
      page.components.filter((component) =>
        hasMeaningfulValue(component.canonicalPurl),
      ).length,
    componentsWithValidHash:
      current.componentsWithValidHash +
      page.components.filter((component) =>
        component.hashes.some((hash) =>
          isRecognizedCryptographicHash(hash.algorithm, hash.value),
        ),
      ).length,
    componentsWithSupplier:
      current.componentsWithSupplier +
      page.components.filter((component) =>
        hasMeaningfulValue(
          ...(component.supplierValues ?? [component.supplier ?? ""]),
        ),
      ).length,
    componentsWithLicense:
      current.componentsWithLicense +
      page.components.filter((component) =>
        hasMeaningfulValue(
          ...(component.licenseValues ?? [component.licenseExpression ?? ""]),
        ),
      ).length,
    primaryComponentIdentified:
      current.primaryComponentIdentified || page.primaryComponent !== null,
    primaryComponentDirectDependencyCount: current.primaryComponentIdentified
      ? current.primaryComponentDirectDependencyCount
      : (page.primaryComponent?.directDependencyCount ?? 0),
    maximumDepth: Math.max(current.maximumDepth, page.maximumDepth),
  });
}

const placeholderValues = new Set(["NOASSERTION", "NONE", "UNKNOWN"]);

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

function assessmentStatus(
  quality: SbomQualityResult,
  bsiFindings: readonly Readonly<{ severity: "warning" | "error" }>[],
  baselineStatus: "available" | "first_document" | "no_baseline",
  regressionStatus: "none" | "regression",
): SbomQualityReportDraft["assessmentStatus"] {
  if (regressionStatus === "regression") return "regression";
  if (bsiFindings.some((finding) => finding.severity === "error"))
    return "invalid";
  if (bsiFindings.length > 0 || quality.totalScore < 100) return "warning";
  if (baselineStatus === "first_document") return "first_document";
  if (baselineStatus === "no_baseline") return "no_baseline";
  return "valid";
}

function findingsFor(
  quality: SbomQualityResult,
  bsiFindings: ReturnType<typeof evaluateBsiTr03183_2>,
  regression: ReturnType<typeof compareSbomQuality>,
): readonly SbomQualityFindingDraft[] {
  return Object.freeze([
    ...quality.dimensions
      .filter((dimension) => dimension.status !== "complete")
      .map((dimension) => ({
        kind: "coverage_gap" as const,
        code: `CRA-SBOM-QUALITY-${dimension.id.toUpperCase()}`,
        ruleId: null,
        severity:
          dimension.status === "missing"
            ? ("error" as const)
            : ("warning" as const),
        dimension: dimension.id,
        componentId: null,
        sourcePath: null,
        expected: "Complete quality evidence for the dimension.",
        actual: `${dimension.satisfiedCount} of ${dimension.eligibleCount} eligible values`,
        remediation: remediationFor(dimension.id),
      })),
    ...bsiFindings.map((finding) => ({
      kind: "bsi_rule" as const,
      code: finding.code,
      ruleId: finding.code,
      severity: finding.severity,
      dimension: null,
      componentId: null,
      sourcePath: finding.sourcePath,
      expected: finding.expected,
      actual: finding.actual,
      remediation: finding.remediation,
    })),
    ...(regression.status === "regression"
      ? [
          {
            kind: "regression" as const,
            code: "CRA-SBOM-QUALITY-REGRESSION",
            ruleId: null,
            severity: "warning" as const,
            dimension: null,
            componentId: null,
            sourcePath: null,
            expected: "New SBOM quality should not materially regress.",
            actual: `Total score changed by ${regression.totalScoreDelta} points.`,
            remediation:
              "Review changed dimensions and add missing source evidence before release review.",
          },
        ]
      : []),
  ]);
}

function remediationFor(dimension: SbomQualityDimensionId): string {
  switch (dimension) {
    case "purl":
      return "Add valid Package URLs to components where available.";
    case "hash":
      return "Add recognized cryptographic hashes such as SHA-256 for components.";
    case "supplier":
      return "Add supplier metadata and avoid placeholder values.";
    case "license":
      return "Add declared license expressions or license identifiers.";
    case "top_level_dependency":
      return "Declare the primary component and its direct dependency relationship.";
    case "transitive_depth":
      return "Include transitive dependency relationships to improve graph depth evidence.";
  }
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(values)].filter((value) => uuidSchema.safeParse(value).success),
  );
}

function errorSummary(
  error: unknown,
): Readonly<{ name: string; code: string | null }> {
  if (error instanceof QualityWorkerError)
    return Object.freeze({ name: error.name, code: error.code });
  return Object.freeze({
    name: error instanceof Error ? error.name : typeof error,
    code: null,
  });
}

class QualityWorkerError extends Error {
  constructor(
    readonly code: "quality_source_missing" | "quality_calculation_failed",
    message: string,
  ) {
    super(message);
  }
}
