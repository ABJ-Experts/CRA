import { z } from "zod";
import {
  mapHealth,
  publicFailureCode,
} from "../../vulnerabilities/domain/vulnerability-feed-projection";
import { evaluateVulnerabilityPriority } from "../../vulnerabilities/prioritization/vulnerability-priority-policy";
import type { FrozenRow } from "./export-renderer";
const priorityInputs = z
  .object({
    kind: z.literal("m14_priority_inputs_v1"),
    inputs: z
      .object({
        cvssBaseScore: z.number().finite().nullable(),
        epss: z.number().finite().nullable(),
        kevStatus: z.enum([
          "listed",
          "not_listed",
          "removed",
          "disputed",
          "unavailable",
        ]),
        confidenceScore: z.number().finite(),
        humanVerdict: z.enum(["affected", "not_affected"]).nullable(),
      })
      .strict(),
  })
  .strict();
export function projectFrozenSourceRow(
  source: string,
  row: FrozenRow,
): FrozenRow {
  if (source === "vulnerabilities.feed_health") {
    const privateHealth = row.values.status ?? Object.values(row.values)[0];
    if (typeof privateHealth !== "string")
      throw new Error("invalid_frozen_cell");
    const frozen = z
      .object({
        kind: z.literal("m14_feed_health_v1"),
        value: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(JSON.parse(privateHealth));
    const projected = mapHealth(frozen.value);
    return {
      ...row,
      values: Object.fromEntries(
        Object.keys(row.values).map((key) => [key, projected[key]]),
      ),
    };
  }
  if (source === "vulnerabilities.sync_runs")
    return {
      ...row,
      values: {
        ...row.values,
        status: row.values.status === "failed" ? "retrying" : row.values.status,
        failureCode: publicFailureCode(row.values.failureCode),
      },
    };
  if (
    source !== "vulnerabilities.enriched_findings" ||
    row.values.priority === undefined
  )
    return row;
  if (typeof row.values.priority !== "string")
    throw new Error("invalid_frozen_cell");
  const frozen = priorityInputs.parse(JSON.parse(row.values.priority));
  return {
    ...row,
    values: {
      ...row.values,
      priority: JSON.stringify(evaluateVulnerabilityPriority(frozen.inputs)),
    },
  };
}
