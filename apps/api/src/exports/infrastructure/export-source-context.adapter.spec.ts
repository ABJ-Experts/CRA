import { ExportSourceContextAdapter } from "./export-source-context.adapter";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportUnavailableError,
  ExportInvalidRequestError,
} from "../domain/export.errors";
import { DashboardDatasetConflictError } from "../../dashboard/application/dashboard-trends.port";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
} from "../../dashboard/application/dashboard-read.port";
import {
  AuditExplorerForbiddenError,
  AuditExplorerStaleError,
} from "../../audit/audit-explorer.errors";
import type { DashboardTrendsUseCases } from "../../dashboard/application/dashboard-trends-use-cases";
import type { AuditExplorerUseCases } from "../../audit/application/audit-explorer.use-cases";
import type { RequestUser } from "../../auth/auth.types";
import type { ExportInput } from "../application/exports.port";
const user = {} as RequestUser;
const trendInput = {
  source: "dashboard.trends",
  filters: { datasetToken: "signed" },
  context: {},
} as unknown as ExportInput;
const auditInput = {
  source: "audit.events",
  filters: { resourceType: "product" },
  context: { snapshotToken: "signed" },
} as unknown as ExportInput;
describe("source-owned signed export scope", () => {
  const dashboard = { exportCaptureContext: jest.fn() };
  const audit = { exportCaptureContext: jest.fn() };
  const adapter = new ExportSourceContextAdapter(
    dashboard as unknown as DashboardTrendsUseCases,
    audit as unknown as AuditExplorerUseCases,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    dashboard.exportCaptureContext.mockResolvedValue({
      _datasetSnapshot: "pin",
    });
    audit.exportCaptureContext.mockResolvedValue({ _auditSnapshot: "receipt" });
  });
  it("uses dashboard source authorization without decoding client payloads independently", async () => {
    expect(await adapter.prepare(user, trendInput)).toEqual({
      _datasetSnapshot: "pin",
    });
    expect(dashboard.exportCaptureContext).toHaveBeenCalledWith(
      user,
      trendInput.filters,
    );
  });
  it("verifies audit tokens and rejects absence of a signed displayed snapshot", async () => {
    expect(await adapter.prepare(user, auditInput)).toEqual({
      _auditSnapshot: "receipt",
    });
    expect(audit.exportCaptureContext).toHaveBeenCalledWith(
      user,
      "signed",
      auditInput.filters,
    );
    await expect(
      adapter.prepare(user, { ...auditInput, context: {} } as ExportInput),
    ).rejects.toThrow(ExportAccessDeniedError);
  });
  it.each([undefined, ""])(
    "requires a stable signed trend pin before preparing (%#)",
    async (datasetToken) => {
      await expect(
        adapter.prepare(user, {
          ...trendInput,
          filters: { datasetToken },
        } as unknown as ExportInput),
      ).rejects.toThrow(ExportInvalidRequestError);
      expect(dashboard.exportCaptureContext).not.toHaveBeenCalled();
    },
  );
  it("does not invent snapshot context for other source families", async () => {
    expect(
      await adapter.prepare(user, {
        ...trendInput,
        source: "products.registry",
      } as ExportInput),
    ).toEqual({});
    expect(dashboard.exportCaptureContext).not.toHaveBeenCalled();
  });
  it.each([
    [new DashboardDatasetConflictError(), ExportConflictError],
    [new AuditExplorerStaleError(), ExportConflictError],
    [new AuditExplorerForbiddenError(), ExportAccessDeniedError],
    [new DashboardForbiddenError(), ExportAccessDeniedError],
    [new DashboardUnavailableError(), ExportUnavailableError],
    [new Error("private provider detail"), ExportUnavailableError],
  ])("maps source rejection safely (%#)", async (error, expected) => {
    dashboard.exportCaptureContext.mockRejectedValue(error);
    await expect(adapter.prepare(user, trendInput)).rejects.toThrow(expected);
  });
});
