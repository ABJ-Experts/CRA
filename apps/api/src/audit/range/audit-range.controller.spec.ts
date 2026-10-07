import { PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRE_PERMISSIONS_KEY } from "../../auth/auth.types";
import { AuditRangeController } from "./audit-range.controller";
import {
  AuditRangeInputError,
  AuditRangeConflictError,
  AuditRangeForbiddenError,
  AuditRangeNotFoundError,
  AuditRangeUnavailableError,
} from "./audit-range.errors";
describe("AuditRangeController", () => {
  const cases = ["create", "status", "cancel", "resume"] as const;
  it("declares four independently permission-gated routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, AuditRangeController)).toBe(
      "audit/chain-verifications",
    );
    for (const name of cases)
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSIONS_KEY,
          Object.getOwnPropertyDescriptor(AuditRangeController.prototype, name)
            ?.value as unknown as object,
        ),
      ).toEqual(["can_view_audit"]);
  });
  it("delegates every route through application", async () => {
    const service = Object.fromEntries(
      cases.map((name) => [name, jest.fn().mockResolvedValue({ id: "job" })]),
    );
    const controller = new AuditRangeController(service as never);
    const user = {} as never;
    await controller.create(user, { requestId: "r", fromSequence: "1" });
    await controller.status(user, { jobId: "job" }, { requestId: "r" });
    await controller.cancel(
      user,
      { jobId: "job" },
      { requestId: "r", expectedVersion: 0 },
    );
    await controller.resume(
      user,
      { jobId: "job" },
      { requestId: "r", expectedVersion: 1 },
    );
    for (const name of cases) expect(service[name]).toHaveBeenCalledTimes(1);
  });
  it.each([
    [new AuditRangeInputError(), 400],
    [new AuditRangeForbiddenError(), 404],
    [new AuditRangeNotFoundError(), 404],
    [new AuditRangeConflictError(), 409],
    [new AuditRangeUnavailableError(), 503],
  ])("sanitizes known application failures", async (error, status) => {
    const controller = new AuditRangeController({
      create: jest.fn().mockRejectedValue(error),
    } as never);
    await expect(
      controller.create({} as never, { requestId: "r", fromSequence: "1" }),
    ).rejects.toMatchObject({ status });
  });
  it("preserves unknown failures for standard exception sanitization", async () => {
    const failure = new Error("failure");
    const controller = new AuditRangeController({
      create: jest.fn().mockRejectedValue(failure),
    } as never);
    await expect(
      controller.create({} as never, { requestId: "r", fromSequence: "1" }),
    ).rejects.toBe(failure);
  });
});
