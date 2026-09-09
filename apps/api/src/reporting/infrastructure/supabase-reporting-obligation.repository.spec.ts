import { SupabaseReportingObligationRepository } from "./supabase-reporting-obligation.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";

describe("SupabaseReportingObligationRepository", () => {
  it("parses a tenant-scoped deadline summary into the shared response contract", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "found",
          summary: {
            serverNow: "2026-09-09T10:00:00+00:00",
            overdueCount: 1,
            nextDeadline: {
              obligationId,
              stage: "early_warning",
              dueAt: "2026-09-10T10:00:00+00:00",
              elapsedPercent: 50,
              reportingHref: `/reporting?obligationId=${obligationId}`,
            },
          },
        },
      ],
      error: null,
    });
    const repository = subject(rpc);

    await expect(
      repository.deadlineSummary(organizationId, { actorId }),
    ).resolves.toEqual({
      summary: {
        serverNow: "2026-09-09T10:00:00Z",
        overdueCount: 1,
        nextDeadline: {
          obligationId,
          stage: "early_warning",
          dueAt: "2026-09-10T10:00:00Z",
          elapsedPercent: 50,
          reportingHref: `/reporting?obligationId=${obligationId}`,
        },
      },
    });
    expect(rpc).toHaveBeenCalledWith("get_reporting_deadline_summary", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
    });
  });

  it("rejects malformed summary fields rather than exposing provider data", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "found",
            summary: {
              serverNow: "not-a-date",
              overdueCount: -1,
              nextDeadline: null,
            },
          },
        ],
        error: null,
      }),
    );

    await expect(
      repository.deadlineSummary(organizationId, { actorId }),
    ).rejects.toThrow();
  });
});

function subject(rpc: jest.Mock) {
  return new SupabaseReportingObligationRepository({
    admin: () => ({ rpc }),
  } as never);
}
