import { SupabaseSupportDiagnosticsRepository } from "./supabase-support-diagnostics.repository";
import {
  DiagnosticDeniedError,
  DiagnosticConflictError,
  DiagnosticUnavailableError,
  DiagnosticInvalidError,
} from "../application/diagnostic-repository.port";
const id = "11111111-1111-4111-8111-111111111111";
const p = { organizationId: id, actorId: id, sessionId: id };
const input = { expectedVersion: 1, idempotencyKey: id };
const at = "2026-10-01T00:00:00Z";
const selection = {
  categories: ["logs" as const],
  from: "2026-09-30T00:00:00Z",
  to: at,
};
const job = {
  id,
  organizationId: id,
  state: "queued",
  stage: "queued",
  version: 1,
  consentedAt: at,
  createdAt: at,
  completedAt: null,
  expiresAt: null,
  selection,
  progress: { completed: 0, total: 1 },
  omissions: [],
  artifact: null,
  failureCode: null,
  cleanup: { state: "none", blockers: [] },
};
const authority = {
  organizationId: id,
  actorUserId: id,
  sessionId: id,
  permissionVersion: "1",
};
const manifest = {
  version: "m15_04_v1",
  jobId: id,
  generatedAt: at,
  selection,
  entries: [],
  omissions: [],
};
function fixture(result: unknown = authority) {
  const rpc = jest
    .fn()
    .mockResolvedValue({ data: { outcome: "ok", result }, error: null });
  return {
    rpc,
    repository: new SupabaseSupportDiagnosticsRepository({
      admin: () => ({ rpc }),
    } as never),
  };
}
describe("diagnostic scoped RPC adapter", () => {
  it("accepts the actual cleanup authority blocker projection", async () => {
    const review = {
      organizationId: id,
      jobId: id,
      eligible: false,
      blockers: [
        "availability_active",
        "retention_policy_unavailable",
        "authority_unavailable_product",
        "authority_unavailable_evidence_class",
        "authority_unavailable_obligation",
        "authority_unavailable_legal_hold",
      ],
      reviewFingerprint: "a".repeat(64),
    };
    const f = fixture(review);
    await expect(f.repository.cleanupReview(id, p, id)).resolves.toEqual(
      review,
    );
  });

  it("accepts the actual SQL internal projection without leaking worker or identity metadata", async () => {
    const expected = {
      job,
      objectPath: `${id}/${id}/attempt-1/bundle.zip`,
      manifest,
    };
    const f = fixture({
      ...expected,
      creatorUserId: id,
      sessionId: id,
      permissionVersion: "1",
      objectPaths: [expected.objectPath],
    });
    await expect(f.repository.access(id, p, id, id)).resolves.toEqual(expected);
  });

  it("maps rejected selection validation without retry", async () => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: { outcome: "invalid" }, error: null });
    await expect(f.repository.authority(id, p)).rejects.toThrow(
      DiagnosticInvalidError,
    );
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it("parses live authority and sends verified org/actor/session", async () => {
    const f = fixture();
    expect(await f.repository.authority(id, p)).toEqual(authority);
    expect(f.rpc).toHaveBeenCalledWith("m15_04_authority", {
      p_organization_id: id,
      p_actor_user_id: id,
      p_session_id: id,
    });
  });
  it("rejects mismatched scopes without RPC", async () => {
    const f = fixture();
    await expect(f.repository.authority("other", p)).rejects.toThrow(
      DiagnosticDeniedError,
    );
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("maps all job operations and preserves version, idempotency, selection and digest", async () => {
    const f = fixture(job);
    await f.repository.create(id, p, selection, "digest", id);
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_create",
      expect.objectContaining({
        p_preview_digest: "digest",
        p_selection: selection,
        p_idempotency_key: id,
      }),
    );
    await f.repository.get(id, p, id);
    await f.repository.cancel(id, p, id, input);
    await f.repository.cleanup(id, p, id, {
      ...input,
      reviewFingerprint: "a".repeat(64),
    });
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_request_cleanup",
      expect.objectContaining({
        p_expected_version: 1,
        p_review_fingerprint: "a".repeat(64),
      }),
    );
  });
  it("maps list cursor and configured page bound", async () => {
    const f = fixture({ organizationId: id, items: [job], nextCursor: null });
    await f.repository.list(id, p, { limit: 25 });
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_list",
      expect.objectContaining({ p_limit: 25 }),
    );
    await f.repository.list(id, p, { limit: 100, cursor: id });
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_list",
      expect.objectContaining({ p_after_id: id, p_limit: 100 }),
    );
  });
  it("parses access and binds durable request for access/revalidation/redemption", async () => {
    const f = fixture({
      creatorUserId: id,
      sessionId: id,
      permissionVersion: "1",
      objectPaths: [`${id}/${id}/attempt-1/bundle.zip`],
      job,
      objectPath: `${id}/${id}/attempt-1/bundle.zip`,
      manifest,
    });
    await f.repository.access(id, p, id, id);
    await f.repository.revalidate(id, p, id, id);
    await f.repository.redeem(id, p, id, id, "digest", id);
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_redeem_grant",
      expect.objectContaining({
        p_grant_digest: "digest",
        p_request_id: id,
        p_grant_id: id,
      }),
    );
  });
  it("parses grants and review without returning DB internals", async () => {
    const f = fixture({
      organizationId: id,
      jobId: id,
      grantId: id,
      downloadPath: `/api/v1/system/diagnostics/bundles/${id}/download/${id}`,
      expiresAt: at,
    });
    await f.repository.grant(id, p, id, input, id, "digest");
    expect(f.rpc).toHaveBeenLastCalledWith(
      "m15_04_issue_grant",
      expect.objectContaining({
        p_expected_version: 1,
        p_grant_digest: "digest",
        p_grant_id: id,
      }),
    );
    f.rpc.mockResolvedValue({
      data: {
        outcome: "ok",
        result: {
          organizationId: id,
          jobId: id,
          eligible: true,
          blockers: [],
          reviewFingerprint: "a".repeat(64),
        },
      },
      error: null,
    });
    await f.repository.cleanupReview(id, p, id);
  });
  it.each([
    "denied",
    "not_found",
    "forbidden",
    "expired",
    "access_changed",
    "invalid_grant",
  ])("fails closed for %s", async (outcome) => {
    const f = fixture();
    f.rpc.mockResolvedValue({ data: { outcome }, error: null });
    await expect(f.repository.authority(id, p)).rejects.toThrow(
      DiagnosticDeniedError,
    );
  });
  it.each(["conflict", "stale", "blocked", "idempotency_conflict", "busy"])(
    "maps concurrency %s",
    async (outcome) => {
      const f = fixture();
      f.rpc.mockResolvedValue({ data: { outcome }, error: null });
      await expect(f.repository.authority(id, p)).rejects.toThrow(
        DiagnosticConflictError,
      );
    },
  );
  it.each(["42501", "40001", "23505", "XX000"])(
    "maps safe SQL failure %s",
    async (code) => {
      const f = fixture();
      f.rpc.mockResolvedValue({ data: null, error: { code } });
      await expect(f.repository.authority(id, p)).rejects.toThrow(
        code === "42501"
          ? DiagnosticDeniedError
          : code === "XX000"
            ? DiagnosticUnavailableError
            : DiagnosticConflictError,
      );
    },
  );
  it.each([null, { outcome: "unexpected" }, { outcome: "ok", result: {} }])(
    "rejects malformed backend result %#",
    async (data) => {
      const f = fixture();
      f.rpc.mockResolvedValue({ data, error: null });
      await expect(f.repository.authority(id, p)).rejects.toThrow(
        DiagnosticUnavailableError,
      );
    },
  );
  it("fails closed on transport exceptions", async () => {
    const f = fixture();
    f.rpc.mockRejectedValue(new Error("private provider detail"));
    await expect(f.repository.authority(id, p)).rejects.toThrow(
      DiagnosticUnavailableError,
    );
  });
});
