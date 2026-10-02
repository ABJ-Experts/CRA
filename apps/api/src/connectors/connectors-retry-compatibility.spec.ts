import { ConflictException } from "@nestjs/common";
import type { RequestUser } from "../auth/auth.types";
import { ConnectorsController } from "./connectors.controller";

describe("legacy connector retry safety", () => {
  it("requires an explicit reviewed replay instead of reactivating a parent", async () => {
    const retrySyncRun = jest.fn().mockResolvedValue({ id: "run" });
    const service = {
      repository: { retrySyncRun },
      run: <T>(pending: Promise<T>) => pending,
    };
    const controller = new ConnectorsController(service as never);
    const action = controller.retry(
      { connectorId: "connector", syncRunId: "run" },
      {},
      { id: "actor", organizationId: "org" } as RequestUser,
    );
    await expect(action).rejects.toBeInstanceOf(ConflictException);
    await expect(action).rejects.toMatchObject({
      response: {
        code: "preview_required",
        message: "Preview this batch and request a reviewed replay.",
      },
    });
    expect(retrySyncRun).not.toHaveBeenCalled();
  });
});
