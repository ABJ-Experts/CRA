import { SupabaseReportsRepository } from "./supabase-reports.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { ReportPrincipal } from "../application/reports.port";
import { ExportDeliveryAdapter } from "../../exports/infrastructure/export-delivery.adapter";
import { ExportAccessDeniedError } from "../../exports/domain/export.errors";
import {
  ReportAccessDeniedError,
  ReportConflictError,
  ReportInvalidRequestError,
  ReportUnavailableError,
} from "../domain/report.errors";

const principal: ReportPrincipal = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
};
const id = "44444444-4444-4444-8444-444444444444";
const input = { expectedVersion: 1, idempotencyKey: id };

function subject(
  response: { data: unknown; error: { code?: string } | null } | null,
) {
  const rpc = jest
    .fn()
    .mockResolvedValue(response ?? { data: null, error: null });
  const repository = new SupabaseReportsRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  return { repository, rpc };
}

describe("SupabaseReportsRepository", () => {
  it("uses the contracted RPC names for every scoped operation", async () => {
    const { repository, rpc } = subject(null);
    const config = {
      title: "Products",
      report: {
        kind: "list",
        source: "products.registry",
        format: "csv",
        context: {},
        filters: {},
      },
      schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" },
      dateWindow: { kind: "fixed" },
      recipientUserIds: [principal.actorId],
      emailEnabled: false,
    } as never;
    const listQuery = { limit: 25 };
    const work = [
      repository.create(principal.organizationId, principal, {
        config,
        idempotencyKey: id,
      }),
      repository.update(principal.organizationId, principal, id, {
        config,
        expectedVersion: 1,
        idempotencyKey: id,
      }),
      repository.mutate(
        principal.organizationId,
        principal,
        id,
        "pause",
        input,
      ),
      repository.preview(principal.organizationId, principal, id, input),
      repository.getRun(principal.organizationId, principal, id),
      repository.listRuns(principal.organizationId, principal, listQuery),
      repository.replay(principal.organizationId, principal, id, input),
      repository.recipients(principal.organizationId, principal, listQuery),
      repository.manifest(principal.organizationId, principal, id, id),
      repository.getEmailPreference(principal.organizationId, principal),
      repository.listAdministration(
        principal.organizationId,
        principal,
        listQuery,
      ),
      repository.adminPause(principal.organizationId, principal, id, input),
    ];
    expect(
      (await Promise.allSettled(work)).every(
        (outcome) => outcome.status === "rejected",
      ),
    ).toBe(true);
    expect((rpc.mock.calls as [string][]).map(([name]) => name)).toEqual([
      "m14_04_create_definition",
      "m14_04_update_definition",
      "m14_04_mutate_definition",
      "m14_04_preview",
      "m14_04_get_run",
      "m14_04_list_runs",
      "m14_04_replay",
      "m14_04_recipients",
      "m14_04_manifest",
      "m14_04_get_email_preference",
      "m14_04_list_administration",
      "m14_04_admin_pause",
    ]);
    const args = (rpc.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(args).toMatchObject({
      p_organization_id: principal.organizationId,
      p_actor_user_id: principal.actorId,
    });
    expect(args.p_schema_digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it("never issues a service-role RPC when the tenant argument differs", () => {
    const { repository, rpc } = subject({ data: null, error: null });
    expect(() => repository.get(id, principal, id)).toThrow(
      ReportAccessDeniedError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["42501", ReportAccessDeniedError],
    ["40001", ReportConflictError],
    ["P0001", ReportConflictError],
    ["22023", ReportInvalidRequestError],
    ["57014", ReportUnavailableError],
  ])("maps SQLSTATE %s to a stable provider error", async (code, errorType) => {
    const { repository } = subject({ data: null, error: { code } });
    await expect(
      repository.get(principal.organizationId, principal, id),
    ).rejects.toBeInstanceOf(errorType);
  });
  it("does not treat malformed provider output as an empty list", async () => {
    const { repository } = subject({
      data: { items: [{}], nextCursor: null },
      error: null,
    });
    await expect(
      repository.list(principal.organizationId, principal, { limit: 25 }),
    ).rejects.toBeInstanceOf(ReportUnavailableError);
  });
  it("passes actor, session and token digest only to grant RPC", async () => {
    const { repository, rpc } = subject({
      data: [{ outcome: "forbidden", result: null }],
      error: null,
    });
    await expect(
      repository.grant(
        principal.organizationId,
        principal,
        id,
        id,
        id,
        "a".repeat(64),
      ),
    ).rejects.toBeInstanceOf(ReportAccessDeniedError);
    expect(rpc).toHaveBeenCalledWith(
      "m14_04_grant",
      expect.objectContaining({
        p_organization_id: principal.organizationId,
        p_actor_user_id: principal.actorId,
        p_session_id: principal.sessionId,
        p_token_digest: "a".repeat(64),
      }),
    );
  });
  it("unwraps preference outcomes and preserves conflicts", async () => {
    const { repository, rpc } = subject({
      data: [{ outcome: "updated", result: { mode: "off", version: 2 } }],
      error: null,
    });
    await expect(
      repository.setEmailPreference(principal.organizationId, principal, {
        ...input,
        mode: "off",
      }),
    ).resolves.toEqual({ mode: "off", version: 2 });
    rpc.mockResolvedValue({
      data: [{ outcome: "conflict", result: null }],
      error: null,
    });
    await expect(
      repository.setEmailPreference(principal.organizationId, principal, {
        ...input,
        mode: "off",
      }),
    ).rejects.toBeInstanceOf(ReportConflictError);
  });
  it("rechecks the exact session after storage acquisition", async () => {
    const jobId = "55555555-5555-4555-8555-555555555555";
    const artifact = {
      id,
      name: "report.csv",
      mediaType: "text/csv",
      byteLength: 6,
      sha256: "a".repeat(64),
      objectPath: `${principal.organizationId}/${jobId}/report.csv`,
    };
    const { repository, rpc } = subject(null);
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "m14_04_redeem"
          ? {
              data: [
                { outcome: "found", result: { artifact, exportJobId: jobId } },
              ],
              error: null,
            }
          : { data: false, error: null },
      ),
    );
    const open = jest
      .spyOn(ExportDeliveryAdapter.prototype, "open")
      .mockImplementation(async (_orgId, _jobId, _artifact, authorize) => {
        await authorize();
        throw new Error("unreachable");
      });
    try {
      await expect(
        repository.download(
          principal.organizationId,
          principal,
          id,
          id,
          id,
          "a".repeat(64),
        ),
      ).rejects.toBeInstanceOf(ExportAccessDeniedError);
      expect(rpc).toHaveBeenCalledWith(
        "m14_04_authorize_download",
        expect.objectContaining({
          p_organization_id: principal.organizationId,
          p_actor_user_id: principal.actorId,
          p_session_id: principal.sessionId,
          p_run_id: id,
          p_recipient_id: id,
        }),
      );
    } finally {
      open.mockRestore();
    }
  });
  it("does not accept an unrecognized delivery outcome or provider failure", async () => {
    const { repository, rpc } = subject({
      data: [{ outcome: "unknown", result: { mode: "off", version: 1 } }],
      error: null,
    });
    await expect(
      repository.getEmailPreference(principal.organizationId, principal),
    ).rejects.toBeInstanceOf(ReportUnavailableError);
    rpc.mockRejectedValue(new Error("network secret"));
    await expect(
      repository.get(principal.organizationId, principal, id),
    ).rejects.toBeInstanceOf(ReportUnavailableError);
  });
  it("distinguishes invalid delivery input from malformed provider output", async () => {
    const { repository, rpc } = subject({
      data: [{ outcome: "invalid_request", result: null }],
      error: null,
    });
    await expect(
      repository.getEmailPreference(principal.organizationId, principal),
    ).rejects.toBeInstanceOf(ReportInvalidRequestError);
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { mode: "invalid", version: 1 } }],
      error: null,
    });
    await expect(
      repository.getEmailPreference(principal.organizationId, principal),
    ).rejects.toBeInstanceOf(ReportUnavailableError);
  });
});
