import { createExportJobSchema } from "@repo/contracts/exports";
import { ExportsUseCases } from "./exports.use-cases";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { ExportsPort } from "./exports.port";
import type { RequestUser } from "../../auth/auth.types";
const user: RequestUser = {
  id: "e5a9a4ae-922a-4b45-b976-ea1c0a68a45d",
  authUserId: "f73088f8-1236-467e-bd16-f240146642ee",
  organizationId: "5bb39a5a-7505-4c98-9e62-387824c4c069",
  sessionId: "6a2430e2-7fe6-4944-862b-dd1ed328633f",
  email: "test@test.test",
  isActive: true,
  role: "owner",
  accessToken: "test",
  aal: "aal2",
};
const jobId = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
describe("ExportsUseCases", () => {
  let repo: { [Key in keyof ExportsPort]: jest.Mock };
  let permissions: { can: jest.Mock };
  let useCases: ExportsUseCases;
  beforeEach(() => {
    repo = {
      create: jest.fn(),
      createReadiness: jest.fn(),
      list: jest.fn(),
      get: jest.fn(),
      manifest: jest.fn(),
      mutate: jest.fn(),
      grant: jest.fn(),
      download: jest.fn(),
    };
    permissions = { can: jest.fn().mockResolvedValue(true) };
    useCases = new ExportsUseCases(repo, permissions);
  });
  it("disables new creation while keeping existing status available", async () => {
    const disabled = new ExportsUseCases(repo, permissions, () => false);
    const input = createExportJobSchema.parse({
      source: "products.registry",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: jobId,
    });
    await expect(disabled.create(user, input)).rejects.toThrow(
      ExportUnavailableError,
    );
    await expect(
      disabled.createReadiness(user, {
        productId: jobId,
        idempotencyKey: jobId,
      }),
    ).rejects.toThrow(ExportUnavailableError);
    await disabled.get(user, jobId);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.get).toHaveBeenCalled();
  });
  it("requires source-owned validation and passes trusted context only after permission checks", async () => {
    const input = createExportJobSchema.parse({
      source: "dashboard.trends",
      context: {},
      filters: {
        datasetToken: "source-owned-signed-dataset-token",
        from: "2026-10-01",
        to: "2026-10-08",
        bucket: "day",
        timezone: "UTC",
      },
      format: "csv",
      idempotencyKey: jobId,
    });
    await expect(useCases.create(user, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
    const contexts = {
      prepare: jest
        .fn()
        .mockResolvedValue({ _datasetSnapshot: { epoch: jobId } }),
    };
    const signed = new ExportsUseCases(repo, permissions, () => true, contexts);
    await signed.create(user, input);
    expect(contexts.prepare).toHaveBeenCalledWith(user, input);
    expect(repo.create).toHaveBeenLastCalledWith(
      user.organizationId,
      expect.anything(),
      input,
      { _datasetSnapshot: { epoch: jobId } },
    );
    contexts.prepare.mockRejectedValue(new ExportAccessDeniedError());
    repo.create.mockClear();
    await expect(signed.create(user, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });
  it("checks the existing source permissions before queueing", async () => {
    const input = createExportJobSchema.parse({
      source: "products.registry",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: jobId,
    });
    await useCases.create(user, input);
    expect(permissions.can).toHaveBeenCalledWith(
      user.organizationId,
      user.id,
      "owner",
      ["can_view_products", "can_export_products"],
    );
    expect(repo.create).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      input,
    );
    permissions.can.mockResolvedValue(false);
    await expect(useCases.create(user, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
  });
  it("preserves source admin-only restrictions independently of export grants", async () => {
    const input = createExportJobSchema.parse({
      source: "vulnerabilities.feed_health",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: jobId,
    });
    await expect(
      useCases.create({ ...user, role: "member" }, input),
    ).rejects.toThrow(ExportAccessDeniedError);
    await useCases.create({ ...user, role: "admin" }, input);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });
  it("rejects portal sources through authenticated generic creation", async () => {
    const input = createExportJobSchema.parse({
      source: "supplier_evidence.portal_items",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: jobId,
    });
    await expect(useCases.create(user, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
  });
  it("requires technical-file export capability for readiness without creating a snapshot", async () => {
    const input = { productId: jobId, idempotencyKey: jobId };
    await useCases.createReadiness(user, input);
    expect(repo.createReadiness).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      input,
    );
    permissions.can.mockResolvedValue(false);
    await expect(useCases.createReadiness(user, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
  });
  it("passes list filters without broadening source context", async () => {
    await useCases.list(user, { source: "products.registry", limit: 25 });
    expect(repo.list).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      { source: "products.registry", limit: 25 },
    );
  });
  it("creates opaque grants while persisting only a digest", async () => {
    repo.grant.mockResolvedValue({
      grantId: jobId,
      expiresAt: "2026-10-09T00:05:00Z",
      downloadPath: `/api/v1/exports/${jobId}/download/${jobId}`,
    });
    const result = await useCases.grant(user, jobId, jobId);
    expect(result.cookieValue).toMatch(/^[a-f0-9]{64}$/);
    expect((repo.grant.mock.calls as unknown[][])[0]?.[4]).not.toBe(
      result.cookieValue,
    );
  });
  it("denies inactive user before any provider access", async () => {
    await expect(
      useCases.get({ ...user, isActive: false }, jobId),
    ).rejects.toThrow(ExportAccessDeniedError);
    expect(repo.get).not.toHaveBeenCalled();
  });
  it("passes verified principal to durable manifest delivery", async () => {
    await useCases.manifest(user, jobId);
    expect(repo.manifest).toHaveBeenCalledWith(
      user.organizationId,
      expect.objectContaining({ actorId: user.id, sessionId: user.sessionId }),
      jobId,
    );
  });
  it("passes verified tenant and actor to status", async () => {
    await useCases.get(user, jobId);
    expect(repo.get).toHaveBeenCalledWith(
      user.organizationId,
      expect.objectContaining({ actorId: user.id, sessionId: user.sessionId }),
      jobId,
    );
  });
  it.each(["cancel", "retry"] as const)(
    "passes optimistic version to %s",
    async (operation) => {
      await useCases.mutate(user, jobId, 3, jobId, operation);
      expect(repo.mutate).toHaveBeenCalledWith(
        user.organizationId,
        expect.anything(),
        jobId,
        3,
        jobId,
        operation,
      );
    },
  );
  it("rejects absent delivery cookie", async () => {
    await expect(
      useCases.download(user, jobId, jobId, undefined),
    ).rejects.toThrow(ExportAccessDeniedError);
    expect(repo.download).not.toHaveBeenCalled();
  });
  it("rejects malformed delivery cookie", async () => {
    await expect(
      useCases.download(user, jobId, jobId, "not-a-token"),
    ).rejects.toThrow(ExportAccessDeniedError);
  });
  it("hashes delivery credentials before repository call", async () => {
    await useCases.download(user, jobId, jobId, "a".repeat(64));
    expect(repo.download).toHaveBeenCalledWith(
      user.organizationId,
      expect.anything(),
      jobId,
      jobId,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect((repo.download.mock.calls as unknown[][])[0]?.[4]).not.toBe(
      "a".repeat(64),
    );
  });
});
