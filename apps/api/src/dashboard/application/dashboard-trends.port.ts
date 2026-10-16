import type {
  DashboardCursorScope,
  DashboardTokens,
} from "./dashboard-read.port";
export interface DashboardTrendsReadPort {
  read(
    orgId: string,
    input: Readonly<{
      actorId: string;
      endpoint: "trends" | "sources";
      filters: Readonly<Record<string, unknown>>;
      snapshot?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
}
export interface DashboardDatasetTokens extends DashboardTokens {
  opaqueSourceId(
    scope: DashboardCursorScope,
    dataset: Readonly<Record<string, unknown>>,
    sourceId: string,
  ): string;
  seal(
    scope: DashboardCursorScope,
    position: Readonly<Record<string, unknown>>,
  ): string;
}
export class DashboardDatasetConflictError extends Error {}
