import { UpgradeControlError } from "./application/upgrade-supervisor.port";
import { NotFoundException } from "@nestjs/common";
import { OperatorUpgradesController } from "./operator-upgrades.controller";
import {
  UpgradeScopeError,
  UpgradeUseCases,
} from "./application/upgrade-use-cases";
import type { OperatorRequest } from "../operator/operator-request";
const instanceId = "00000000-0000-4000-8000-000000000001";
const request = {
  operatorIdentity: { principalId: instanceId },
} as OperatorRequest;
describe("upgrade controller", () => {
  const execute = jest.fn().mockResolvedValue({});
  const controller = new OperatorUpgradesController({
    execute,
  } as unknown as UpgradeUseCases);
  beforeEach(() => execute.mockReset().mockResolvedValue({}));
  it.each(["capabilities", "media", "history", "detail", "result"] as const)(
    "routes %s through private identity",
    async (method) => {
      await controller[method](request, { instanceId, runId: instanceId }, {
        limit: 25,
      } as never);
      expect(execute).toHaveBeenCalledWith(
        request.operatorIdentity,
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    },
  );
  it.each(["stage", "preflight", "apply", "rollback", "reconcile"] as const)(
    "routes %s mutation",
    async (method) => {
      await controller[method](request, { instanceId, runId: instanceId }, {
        expectedVersion: 0,
        idempotencyKey: instanceId,
      } as never);
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
  it("hides denied scope", async () => {
    execute.mockRejectedValue(new UpgradeScopeError());
    await expect(
      controller.capabilities(request, { instanceId }, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([401, 403, 409, 503] as const)(
    "preserves safe private control status %s",
    async (status) => {
      execute.mockRejectedValue(new UpgradeControlError(status));
      await expect(
        controller.capabilities(request, { instanceId }, {}),
      ).rejects.toMatchObject({
        status,
        message: "Upgrade control unavailable",
      });
    },
  );
  it("preserves operational failures", async () => {
    execute.mockRejectedValue(new Error("unavailable"));
    await expect(
      controller.capabilities(request, { instanceId }, {}),
    ).rejects.toThrow("unavailable");
  });
});
