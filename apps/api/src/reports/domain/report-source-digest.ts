import { createHash } from "node:crypto";
import { reportSourceSchemaDescriptor } from "@repo/contracts/reports/schemas";

export function sourceSchemaDigest(
  report:
    | { kind: "readiness"; [key: string]: unknown }
    | { kind: "list"; source: string; [key: string]: unknown },
): string {
  const descriptor = reportSourceSchemaDescriptor(
    report.kind === "readiness"
      ? "technical_files.readiness_report"
      : report.source,
  );
  return createHash("sha256").update(JSON.stringify(descriptor)).digest("hex");
}
