import type { BackupAssurance } from "@repo/contracts/backups/types";
import { customerSystemHealthV2ResponseSchema } from "@repo/contracts/system/schemas";
import type { CustomerSystemHealthResponse } from "@repo/contracts/system/types";
export function withBackupAssurance(
  snapshot: CustomerSystemHealthResponse,
  backup: BackupAssurance,
) {
  const status =
    backup.status === "verified"
      ? "healthy"
      : backup.status === "unavailable"
        ? "unknown"
        : "degraded";
  const components = snapshot.components.map((component) =>
    component.id === "backups"
      ? {
          ...component,
          status,
          sourceAt: backup.sourceAt,
          observedAt: backup.observedAt,
          reasons: backup.reasons,
        }
      : component,
  );
  return customerSystemHealthV2ResponseSchema.parse({
    ...snapshot,
    schemaVersion: 2,
    backup,
    components,
    overallStatus: components.every(
      (component) => component.status === "healthy",
    )
      ? "healthy"
      : "degraded",
  });
}
