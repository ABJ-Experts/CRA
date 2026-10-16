import {
  sbomQualityDimensionIdSchema,
  sbomQualityReportResponseSchema,
} from "@repo/contracts/sboms";
import { z } from "zod";
import type { SbomQualityReportDraft } from "../worker/sbom-quality-worker";

/** Comparison policy retains improvements; the frozen wire shape lists regressions only. */
export function publicQualityRegression(
  regression: SbomQualityReportDraft["regression"],
) {
  return {
    status: regression.status,
    totalScoreDelta: regression.totalScoreDelta,
    changedDimensions:
      regression.status === "none" ? [] : regression.changedDimensions,
  };
}

const responseEnvelope = z
  .object({ report: z.object({}).passthrough() })
  .passthrough();
const internalBaseline = z
  .object({ status: z.literal("available"), quality: z.unknown().optional() })
  .passthrough();
const internalImprovement = z
  .object({
    status: z.literal("none"),
    totalScoreDelta: z.number().min(-100).max(100),
    changedDimensions: z
      .array(sbomQualityDimensionIdSchema)
      .max(6)
      .refine((dimensions) => new Set(dimensions).size === dimensions.length),
  })
  .strict();

/** Project documented internal fields without rewriting immutable stored reports. */
export function publicQualityResponse(value: unknown) {
  const envelope = responseEnvelope.safeParse(value);
  if (!envelope.success) return sbomQualityReportResponseSchema.parse(value);
  const report = envelope.data.report;
  const baseline = internalBaseline.safeParse(report.baseline);
  const improvement = internalImprovement.safeParse(report.regression);
  return sbomQualityReportResponseSchema.parse({
    ...envelope.data,
    report: {
      ...report,
      ...(baseline.success
        ? {
            baseline: Object.fromEntries(
              Object.entries(baseline.data).filter(
                ([key]) => key !== "quality",
              ),
            ),
          }
        : {}),
      ...(improvement.success
        ? { regression: publicQualityRegression(improvement.data) }
        : {}),
    },
  });
}
