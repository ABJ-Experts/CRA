import {
  vulnerabilityReachabilityAnalyzerSchema,
  type VulnerabilityReachabilityAnalyzer,
} from "@repo/contracts/vulnerabilities";
import { z } from "zod";

const registrationsSchema = z
  .array(vulnerabilityReachabilityAnalyzerSchema)
  .max(100)
  .superRefine((registrations, context) => {
    const seen = new Set<string>();
    for (const [index, registration] of registrations.entries()) {
      const identity = [
        registration.adapterId,
        registration.version,
        registration.ecosystem,
        registration.buildFormat,
      ].join("\u0000");
      if (seen.has(identity)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Adapter registrations must be unique by exact capability",
        });
      }
      seen.add(identity);
    }
  });

/**
 * Deployment-owned reachability authority. A blank value intentionally yields
 * no registrations, making ingestion fail closed until an operator explicitly
 * enables a versioned adapter capability.
 */
export function parseRegisteredReachabilityAnalyzers(
  value: string | undefined,
): readonly VulnerabilityReachabilityAnalyzer[] {
  if (!value || value.trim() === "") return [];
  try {
    return registrationsSchema.parse(JSON.parse(value) as unknown);
  } catch (error) {
    if (error instanceof z.ZodError) throw error;
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Reachability adapter registrations must be valid JSON",
      },
    ]);
  }
}
