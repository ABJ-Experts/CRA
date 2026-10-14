import { createHash } from "node:crypto";
import { SupportDiagnosticsUseCases } from "./support-diagnostics.use-cases";
import {
  DiagnosticDeniedError,
  DiagnosticUnavailableError,
  DiagnosticInvalidError,
} from "./diagnostic-repository.port";
import type { RequestUser } from "../../auth/auth.types";
const id = "11111111-1111-4111-8111-111111111111";
const user = {
  id,
  organizationId: id,
  sessionId: id,
  role: "admin",
  isActive: true,
} as RequestUser;
const selection = {
  categories: ["logs" as const],
  from: "2026-10-01T00:00:00Z",
  to: "2026-10-01T01:00:00Z",
};
const mutation = { expectedVersion: 1, idempotencyKey: id };
const bytes = Buffer.alloc(70000, 1);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const log = {
  at: selection.to,
  source: "audit",
  code: "operation_completed",
  outcome: "completed",
};
function fixture() {
  const job = {
    id,
    organizationId: id,
    state: "ready",
    stage: "ready",
    version: 1,
    consentedAt: selection.to,
    createdAt: selection.to,
    completedAt: selection.to,
    expiresAt: "2099-01-01T00:00:00Z",
    selection,
    progress: { completed: 1, total: 1 },
    omissions: [],
    artifact: {
      sha256,
      byteSize: bytes.length,
      fileName: `support-diagnostics-${id}.zip`,
    },
    failureCode: null,
    cleanup: { state: "none", blockers: [] },
  };
  const manifest = {
    version: "m15_04_v1",
    jobId: id,
    generatedAt: selection.to,
    selection,
    entries: [{ name: "logs.json", sha256, byteSize: 1 }],
    omissions: [],
  };
  const access = {
    job,
    objectPath: `${id}/${id}/attempt-1/bundle.zip`,
    manifest,
  };
  const repository = {
    authority: jest.fn().mockResolvedValue({
      organizationId: id,
      actorUserId: id,
      sessionId: id,
      permissionVersion: "1",
    }),
    create: jest.fn().mockResolvedValue(job),
    list: jest.fn().mockResolvedValue({
      organizationId: id,
      items: [job],
      nextCursor: null,
    }),
    get: jest.fn().mockResolvedValue(job),
    cancel: jest.fn().mockResolvedValue(job),
    access: jest.fn().mockResolvedValue(access),
    revalidate: jest.fn().mockResolvedValue(access),
    grant: jest.fn().mockResolvedValue({ grantId: id }),
    redeem: jest.fn().mockResolvedValue(access),
    cleanupReview: jest.fn().mockResolvedValue({ eligible: true }),
    cleanup: jest.fn().mockResolvedValue(job),
  };
  const tokens = {
    deriveGrant: jest
      .fn()
      .mockReturnValue({ grantId: id, cookieValue: "a".repeat(64) }),
    mint: jest.fn().mockReturnValue({
      previewToken: "signed.token",
      expiresAt: "2026-10-01T00:10:00Z",
    }),
    verify: jest.fn().mockReturnValue(selection),
  };
  const artifacts = { read: jest.fn().mockResolvedValue(bytes) };
  const archive = {
    inspect: jest.fn().mockResolvedValue({
      manifest,
      logs: [log, log],
      configuration: {
        observedAt: selection.to,
        accessTokenSeconds: 3600,
        refreshTokenSeconds: 604800,
        smtpTlsMode: "mailpit",
        maxBundleBytes: 10485760,
        maxLogRows: 5000,
      },
      metrics: [],
      omissions: [],
    }),
  };
  const service = new SupportDiagnosticsUseCases(
    repository,
    tokens,
    artifacts,
    archive,
  );
  return {
    job,
    access,
    manifest,
    repository,
    tokens,
    artifacts,
    archive,
    service,
  };
}
describe("support diagnostic use cases", () => {
  it("rejects future disclosure windows before minting a preview", async () => {
    const f = fixture();
    const service = new SupportDiagnosticsUseCases(
      f.repository,
      f.tokens,
      f.artifacts,
      f.archive,
      () => Date.parse(selection.to) - 1,
    );
    await expect(service.preview(user, selection)).rejects.toThrow(
      DiagnosticInvalidError,
    );
    expect(f.tokens.mint).not.toHaveBeenCalled();
  });

  it("returns explicit null for unselected or unavailable configuration", async () => {
    const f = fixture();
    f.archive.inspect.mockResolvedValueOnce({
      ...(await f.archive.inspect()),
      configuration: null,
    });
    await expect(
      f.service.content(user, id, {
        section: "configuration",
        offset: 0,
        limit: 100,
      }),
    ).resolves.toMatchObject({
      section: "configuration",
      data: null,
      nextOffset: null,
    });
  });

  it("repeats the same grant mutation with the same unpredictable secret and ID", async () => {
    const f = fixture();
    const first = await f.service.grant(user, id, mutation);
    const second = await f.service.grant(user, id, mutation);
    expect(first.cookieValue).toBe(second.cookieValue);
    expect(f.repository.grant.mock.calls[0]).toEqual(
      f.repository.grant.mock.calls[1],
    );
  });

  it("fails closed on archive/storage outages and cross-job paths", async () => {
    const f = fixture();
    f.artifacts.read.mockRejectedValueOnce(new Error("storage_unavailable"));
    await expect(
      f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
    ).rejects.toThrow(DiagnosticUnavailableError);
    f.archive.inspect.mockRejectedValueOnce(new Error("artifact_integrity"));
    await expect(
      f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
    ).rejects.toThrow(DiagnosticUnavailableError);
    f.repository.access.mockResolvedValueOnce({
      ...f.access,
      objectPath: `${id}/another-job/attempt-1/bundle.zip`,
    });
    await expect(
      f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
    ).rejects.toThrow(DiagnosticDeniedError);
  });

  it("previews static disclosure without collection or writes", async () => {
    const f = fixture();
    expect(await f.service.preview(user, selection)).toMatchObject({
      estimate: { measured: false },
      previewToken: "signed.token",
    });
    expect(f.repository.create).not.toHaveBeenCalled();
    expect(f.repository.access).not.toHaveBeenCalled();
    expect(f.artifacts.read).not.toHaveBeenCalled();
    expect(f.tokens.mint).toHaveBeenCalledWith(
      expect.objectContaining({ authRevision: "1", sessionId: id, selection }),
    );
  });
  it.each([
    { role: "member" },
    { sessionId: undefined },
    { organizationId: null },
    { isActive: false },
  ])("denies invalid principal %#", async (change) => {
    const f = fixture();
    await expect(
      f.service.preview({ ...user, ...change } as RequestUser, selection),
    ).rejects.toThrow(DiagnosticDeniedError);
    expect(f.repository.authority).not.toHaveBeenCalled();
  });
  it("consents with a live-authority-bound token digest and idempotency", async () => {
    const f = fixture();
    await f.service.create(user, {
      previewToken: "signed.token",
      consent: true,
      idempotencyKey: id,
    });
    expect(f.repository.create).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ actorId: id }),
      selection,
      createHash("sha256").update("signed.token").digest("hex"),
      id,
    );
  });
  it("rejects changed preview and missing consent before creating", async () => {
    const f = fixture();
    f.tokens.verify.mockImplementationOnce(() => {
      throw new Error("access_changed");
    });
    await expect(
      f.service.create(user, {
        previewToken: "bad",
        consent: true,
        idempotencyKey: id,
      }),
    ).rejects.toThrow(DiagnosticDeniedError);
    await expect(
      f.service.create(user, {
        previewToken: "x",
        consent: false,
        idempotencyKey: id,
      } as never),
    ).rejects.toThrow(DiagnosticDeniedError);
    expect(f.repository.create).not.toHaveBeenCalled();
  });
  it("delegates scoped job operations without retries", async () => {
    const f = fixture();
    await f.service.list(user, { limit: 25 });
    await f.service.get(user, id);
    await f.service.cancel(user, id, mutation);
    await f.service.cleanupReview(user, id);
    await f.service.cleanup(user, id, {
      ...mutation,
      reviewFingerprint: sha256,
    });
    for (const name of [
      "list",
      "get",
      "cancel",
      "cleanupReview",
      "cleanup",
    ] as const) {
      const calls = f.repository[name].mock.calls as unknown[][];
      expect(calls[0]?.[0]).toBe(id);
      expect(calls[0]?.[1]).toEqual({
        organizationId: id,
        actorId: id,
        sessionId: id,
      });
    }
  });
  it("derives unpredictable idempotent secrets while sending only their digest to persistence", async () => {
    const f = fixture();
    const result = await f.service.grant(user, id, mutation);
    expect(result.cookieValue).toMatch(/^[a-f0-9]{64}$/);
    expect(f.repository.grant).toHaveBeenCalledWith(
      id,
      expect.anything(),
      id,
      mutation,
      expect.any(String),
      createHash("sha256").update(result.cookieValue).digest("hex"),
    );
  });
  it("pages structured content only after live authorization and integrity checks", async () => {
    const f = fixture();
    expect(
      await f.service.content(user, id, {
        section: "logs",
        offset: 0,
        limit: 1,
      }),
    ).toMatchObject({ data: [log], nextOffset: 1 });
    expect(
      await f.service.content(user, id, {
        section: "logs",
        offset: 1,
        limit: 1,
      }),
    ).toMatchObject({ nextOffset: null });
    expect(
      await f.service.content(user, id, {
        section: "configuration",
        offset: 0,
        limit: 1,
      }),
    ).toMatchObject({ section: "configuration", nextOffset: null });
    expect(f.artifacts.read).toHaveBeenCalledWith(
      id,
      f.access.objectPath,
      f.job.artifact,
    );
    expect(f.repository.revalidate).toHaveBeenCalledTimes(3);
  });
  it("denies manifest tampering and archive job mismatch", async () => {
    const f = fixture();
    f.archive.inspect.mockResolvedValueOnce({
      ...(await f.archive.inspect()),
      manifest: {
        ...f.manifest,
        jobId: "22222222-2222-4222-8222-222222222222",
      },
    });
    await expect(
      f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
    ).rejects.toThrow(DiagnosticUnavailableError);
  });
  it("streams only after redeem and revalidates before each chunk", async () => {
    const f = fixture();
    const artifact = await f.service.download(user, id, id, "a".repeat(64));
    const parts = [];
    for await (const chunk of artifact.body) parts.push(chunk);
    expect(Buffer.concat(parts)).toEqual(bytes);
    expect(f.repository.revalidate).toHaveBeenCalledTimes(3);
  });
  it("aborts a stream when authority is revoked after opening", async () => {
    const f = fixture();
    const artifact = await f.service.download(user, id, id, "a".repeat(64));
    f.repository.revalidate.mockRejectedValue(new DiagnosticDeniedError());
    await expect(
      (async () => {
        for await (const chunk of artifact.body) void chunk;
      })(),
    ).rejects.toThrow(DiagnosticDeniedError);
  });
  it.each([undefined, "bad", "a".repeat(65)])(
    "rejects malformed grant secret %#",
    async (value) => {
      const f = fixture();
      await expect(f.service.download(user, id, id, value)).rejects.toThrow(
        DiagnosticDeniedError,
      );
      expect(f.repository.redeem).not.toHaveBeenCalled();
    },
  );
  it.each([
    { state: "expired" },
    { expiresAt: "2020-01-01T00:00:00Z" },
    { expiresAt: null },
    { artifact: null },
    { id: "other" },
    { organizationId: "other" },
  ])("denies unavailable artifact %#", async (change) => {
    const f = fixture();
    f.repository.access.mockResolvedValue({
      ...f.access,
      job: { ...f.job, ...change },
    });
    await expect(
      f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
    ).rejects.toThrow(DiagnosticDeniedError);
    expect(f.artifacts.read).not.toHaveBeenCalled();
  });
  it.each([Buffer.from("changed"), Buffer.alloc(10485761)])(
    "rejects changed or oversized artifacts %#",
    async (value) => {
      const f = fixture();
      f.artifacts.read.mockResolvedValue(value);
      await expect(
        f.service.content(user, id, { section: "logs", offset: 0, limit: 1 }),
      ).rejects.toThrow(DiagnosticUnavailableError);
    },
  );
});
