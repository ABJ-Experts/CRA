import { createExportJobSchema } from "@repo/contracts/exports";
import { PortalExportsUseCases } from "./portal-exports.use-cases";
import {
  ExportAccessDeniedError,
  ExportUnavailableError,
} from "../domain/export.errors";
const id = "99514f0e-2ce0-456c-92d7-f0229dfd6e47";
const p = { kind: "supplier_session" as const, sessionDigest: "a".repeat(64) };
describe("portal export isolation", () => {
  const port = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    manifest: jest.fn(),
    mutate: jest.fn(),
    grant: jest.fn(),
    download: jest.fn(),
  };
  const useCases = new PortalExportsUseCases(port);
  beforeEach(() => jest.clearAllMocks());
  it("disables portal queue creation while allowing existing status", async () => {
    const disabled = new PortalExportsUseCases(port, () => false);
    const input = createExportJobSchema.parse({
      source: "supplier_evidence.portal_items",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: id,
    });
    await expect(disabled.create(p, input)).rejects.toThrow(
      ExportUnavailableError,
    );
    await disabled.get(p, id);
    expect(port.create).not.toHaveBeenCalled();
    expect(port.get).toHaveBeenCalled();
  });
  it("denies portal use of member sources", async () => {
    const input = createExportJobSchema.parse({
      source: "products.registry",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: id,
    });
    await expect(useCases.create(p, input)).rejects.toThrow(
      ExportAccessDeniedError,
    );
    expect(port.create).not.toHaveBeenCalled();
  });
  it("uses only the session's allowed source family", async () => {
    const input = createExportJobSchema.parse({
      source: "supplier_evidence.portal_items",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: id,
    });
    await useCases.create(p, input);
    expect(port.create).toHaveBeenCalledWith(p, input);
    await expect(
      useCases.create(
        { kind: "auditor_session", sessionDigest: p.sessionDigest },
        input,
      ),
    ).rejects.toThrow(ExportAccessDeniedError);
  });
  it("rejects cross-family list filters", async () => {
    await expect(
      useCases.list(p, { source: "products.registry", limit: 25 }),
    ).rejects.toThrow(ExportAccessDeniedError);
    await useCases.list(p, {
      source: "supplier_evidence.portal_items",
      limit: 25,
    });
  });
  it("passes portal session to durable manifest delivery", async () => {
    await useCases.manifest(p, id);
    expect(port.manifest).toHaveBeenCalledWith(p, id);
  });
  it("passes principal to self-owned queries and optimistic mutations", async () => {
    await useCases.list(p, { limit: 25 });
    await useCases.get(p, id);
    await useCases.mutate(p, id, 2, id, "cancel");
    expect(port.list).toHaveBeenCalledWith(p, { limit: 25 });
    expect(port.get).toHaveBeenCalledWith(p, id);
    expect(port.mutate).toHaveBeenCalledWith(p, id, 2, id, "cancel");
  });
  it("persists grant credentials only as digests", async () => {
    port.grant.mockResolvedValue({ grantId: id });
    const result = await useCases.grant(p, id, id);
    expect(result.cookieValue).toHaveLength(64);
    expect((port.grant.mock.calls as unknown[][])[0]?.[3]).not.toBe(
      result.cookieValue,
    );
  });
  it("requires an opaque cookie before redemption", async () => {
    await expect(useCases.download(p, id, id, undefined)).rejects.toThrow(
      ExportAccessDeniedError,
    );
    await expect(useCases.download(p, id, id, "malformed")).rejects.toThrow(
      ExportAccessDeniedError,
    );
    await useCases.download(p, id, id, "a".repeat(64));
    expect((port.download.mock.calls as unknown[][])[0]?.[3]).not.toBe(
      "a".repeat(64),
    );
  });
});
