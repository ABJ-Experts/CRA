import { AuditRangeUseCases } from "./audit-range.use-cases";
import {
  AuditRangeUnavailableError,
  AuditRangeForbiddenError,
} from "../audit-range.errors";
const user = {
  id: "actor",
  organizationId: "org",
  role: "owner",
  isActive: true,
};
const input = { requestId: "request", fromSequence: "1" };
describe("AuditRangeUseCases", () => {
  const repository = {
    create: jest.fn(),
    status: jest.fn(),
    cancel: jest.fn(),
    resume: jest.fn(),
  };
  const permissions = { effectivePermissions: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    permissions.effectivePermissions.mockResolvedValue({
      permissions: { can_view_audit: true },
    });
  });
  it("derives tenant and actor solely from verified identity", async () => {
    repository.create.mockResolvedValue({ id: "job" });
    await new AuditRangeUseCases(repository as never, permissions).create(
      user as never,
      input,
    );
    expect(repository.create).toHaveBeenCalledWith("org", "actor", input);
  });
  it.each([
    { ...user, organizationId: null },
    { ...user, role: null },
    { ...user, isActive: false },
  ])(
    "denies incomplete or inactive principals before provider work",
    async (principal) => {
      await expect(
        new AuditRangeUseCases(repository as never, permissions).create(
          principal as never,
          input,
        ),
      ).rejects.toBeInstanceOf(AuditRangeForbiddenError);
      expect(repository.create).not.toHaveBeenCalled();
      expect(permissions.effectivePermissions).not.toHaveBeenCalled();
    },
  );
  it("requires audit permission anew for every operation", async () => {
    const service = new AuditRangeUseCases(repository as never, permissions);
    await service.status(user as never, "job", "read");
    await service.cancel(user as never, "job", {
      requestId: "cancel",
      expectedVersion: 1,
    });
    await service.resume(user as never, "job", {
      requestId: "resume",
      expectedVersion: 2,
    });
    expect(permissions.effectivePermissions).toHaveBeenCalledTimes(3);
    permissions.effectivePermissions.mockResolvedValue({
      permissions: { can_view_audit: false, can_export_audit: true },
    });
    await expect(
      service.status(user as never, "job", "denied"),
    ).rejects.toBeInstanceOf(AuditRangeForbiddenError);
    expect(repository.status).toHaveBeenCalledTimes(1);
  });
  it("fails unavailable when current permissions cannot be resolved", async () => {
    permissions.effectivePermissions.mockRejectedValueOnce(
      new Error("private provider message"),
    );
    await expect(
      new AuditRangeUseCases(repository as never, permissions).create(
        user as never,
        input,
      ),
    ).rejects.toBeInstanceOf(AuditRangeUnavailableError);
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("propagates durable provider failure without returning evidence", async () => {
    const failure = new Error("unavailable");
    repository.create.mockRejectedValue(failure);
    await expect(
      new AuditRangeUseCases(repository as never, permissions).create(
        user as never,
        input,
      ),
    ).rejects.toBe(failure);
  });
});
