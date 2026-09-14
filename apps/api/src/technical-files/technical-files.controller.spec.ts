import { Logger, ServiceUnavailableException } from "@nestjs/common";

import { TechnicalFilesController } from "./technical-files.controller";
import { TechnicalFileReadinessConflictError } from "./application/technical-file-readiness.port";

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
    const controller = new TechnicalFilesController(
      { get } as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.get(
        { productId: "00000000-0000-4000-8000-000000000004" },
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("maps an unexpected read failure to a safe 503", async () => {
    const get = jest.fn().mockRejectedValue(new Error("provider failure"));
    const controller = new TechnicalFilesController(
      { get } as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.get(
        { productId: "00000000-0000-4000-8000-000000000004" },
        user,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("preserves a missing risk as a 404", async () => {
    const risk = jest.fn().mockResolvedValue(null);
    const controller = new TechnicalFilesController(
      {} as never,
      { risk } as never,
      {} as never,
    );

    await expect(
      controller.risk(
        {
          productId: "00000000-0000-4000-8000-000000000004",
          riskId: "00000000-0000-4000-8000-000000000005",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("maps a stale evidence link to a version conflict", async () => {
    const signalMaterialChange = jest
      .fn()
      .mockRejectedValue(new TechnicalFileReadinessConflictError(3));
    const controller = new TechnicalFilesController(
      {} as never,
      {} as never,
      { signalMaterialChange } as never,
    );

    await expect(
      controller.signalMaterialChange(
        {
          productId: "00000000-0000-4000-8000-000000000004",
          sectionKey: "standards_common_specifications",
          sourceId: "00000000-0000-4000-8000-000000000005",
        },
        {
          expectedVersion: 1,
          reason: "standard_edition_changed",
          currentObservedRevision: "2025",
          currentFingerprint: "edition-2025",
          idempotencyKey: "source-change-1",
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
