import { Logger, ServiceUnavailableException } from "@nestjs/common";

import { TechnicalFilesController } from "./technical-files.controller";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  authUserId: "00000000-0000-4000-8000-000000000002",
  email: "owner@cra.test",
  isActive: true,
  organizationId: "00000000-0000-4000-8000-000000000003",
  role: "owner" as const,
  accessToken: "test-access-token",
  aal: "aal1",
};

describe("TechnicalFilesController", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves the intentional no-active-file 404", async () => {
    const get = jest.fn().mockResolvedValue(null);
    const controller = new TechnicalFilesController({ get } as never);

    await expect(
      controller.get(
        { productId: "00000000-0000-4000-8000-000000000004" },
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("maps an unexpected read failure to a safe 503", async () => {
    const get = jest.fn().mockRejectedValue(new Error("provider failure"));
    const controller = new TechnicalFilesController({ get } as never);

    await expect(
      controller.get(
        { productId: "00000000-0000-4000-8000-000000000004" },
        user,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
