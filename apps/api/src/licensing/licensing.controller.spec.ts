import { LicensingController } from "./licensing.controller";
import type { LicensingService } from "./application/licensing.service";
import type { RequestUser } from "../auth/auth.types";
const user = { id: "actor", organizationId: "org" } as RequestUser;
describe("LicensingController", () => {
  it("uses only current verified organization scope", async () => {
    const service = {
      getPolicy: jest.fn(),
      getCurrent: jest.fn(),
      getHistory: jest.fn(),
      activate: jest.fn(),
    };
    const controller = new LicensingController(
      service as unknown as LicensingService,
    );
    await controller.policy(user);
    await controller.current(user);
    await controller.history(user, { limit: 20 });
    await controller.activate(user, {
      artifact: "a.b.c",
      expectedVersion: 1,
      idempotencyKey: "id",
    });
    expect(service.getPolicy).toHaveBeenCalledWith("org", "actor");
    expect(service.getCurrent).toHaveBeenCalledWith("org", "actor");
    expect(service.getHistory).toHaveBeenCalledWith("org", "actor", {
      limit: 20,
    });
    expect(service.activate).toHaveBeenCalledWith(
      "org",
      "actor",
      expect.objectContaining({ expectedVersion: 1 }),
    );
  });
  it("rejects missing organization before calling application", async () => {
    const service = { getCurrent: jest.fn() };
    const controller = new LicensingController(
      service as unknown as LicensingService,
    );
    await expect(
      controller.current({ ...user, organizationId: null }),
    ).rejects.toThrow("A current organization is required");
    expect(service.getCurrent).not.toHaveBeenCalled();
  });
});
