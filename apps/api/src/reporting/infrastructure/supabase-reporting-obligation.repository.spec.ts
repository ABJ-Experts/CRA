import { SupabaseReportingObligationRepository } from "./supabase-reporting-obligation.repository";
import {
  ReportingStageDraftConflictError,
  ReportingStageDraftLockedError,
} from "../application/reporting-obligation.port";

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

  it("preserves a server draft for explicit stale-revision recovery", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "found", result: { draft: draftFixture() } }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "conflict", result: { draft: draftFixture() } }],
        error: null,
      });
    const repository = subject(rpc);

    await expect(
      repository.saveStageDraft(organizationId, {
        actorId,
        obligationId,
        stageId: stageId,
        expectedRevision: 1,
        lockToken: key,
        fields: [fieldFixture()],
        memberStates: [memberStateFixture()],
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ReportingStageDraftConflictError);
    expect(rpc.mock.calls[1]).toEqual([
      "save_reporting_stage_draft_atomic",
      expect.objectContaining({
        p_draft_id: draftId,
        p_content: { summary: "A concise report." },
      }),
    ]);
  });

  it("surfaces active locks without overwriting another editor", async () => {
    const lockedDraft = {
      ...draftFixture(),
      status: "locked" as const,
      lock: { heldBy: actorFixture(), expiresAt: timestamp },
    };
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "found", result: { draft: draftFixture() } }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "locked", result: { draft: lockedDraft } }],
        error: null,
      });

    await expect(
      subject(rpc).acquireStageDraftLock(organizationId, {
        actorId,
        obligationId,
        stageId,
        expectedRevision: 1,
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(ReportingStageDraftLockedError);
  });

  it("sends typed family-template filters and description to the RPC layer", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "found", result: { templates: [] } }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "created", result: { template: templateFixture() } }],
        error: null,
      });
    const repository = subject(rpc);

    await expect(
      repository.listFamilyTemplates(organizationId, {
        actorId,
        obligationType: "severe_incident",
        stage: "notification",
      }),
    ).resolves.toEqual({ templates: [] });
    await expect(
      repository.createFamilyTemplate(organizationId, {
        actorId,
        obligationType: "severe_incident",
        stage: "notification",
        name: "Incident baseline",
        description: "Reusable operator wording.",
        fields: [fieldFixture()],
        idempotencyKey: key,
      }),
    ).resolves.toMatchObject({
      template: { description: "Reusable operator wording." },
    });

    expect(rpc.mock.calls[0]).toEqual([
      "list_reporting_family_templates",
      expect.objectContaining({
        p_obligation_type: "severe_incident",
        p_stage_kind: "notification",
      }),
    ]);
    expect(rpc.mock.calls[1]).toEqual([
      "create_reporting_family_template_atomic",
      expect.objectContaining({
        p_description: "Reusable operator wording.",
      }),
    ]);
  });
});

function subject(rpc: jest.Mock) {
  return new SupabaseReportingObligationRepository({
    admin: () => ({ rpc }),
  } as never);
}

const stageId = "66666666-6666-4666-8666-666666666666";
const draftId = "77777777-7777-4777-8777-777777777777";
const key = "88888888-8888-4888-888888888888";
const timestamp = "2026-09-10T10:00:00Z";

function actorFixture() {
  return { userId: actorId, displayName: "Owner" };
}

function provenanceFixture() {
  return {
    origin: "human" as const,
    actor: actorFixture(),
    recordedAt: timestamp,
  };
}

function fieldFixture() {
  return {
    value: {
      key: "summary",
      type: "long_text" as const,
      value: "A concise report.",
    },
    provenance: provenanceFixture(),
    updatedAt: timestamp,
  };
}

function memberStateFixture() {
  return { countryCode: "DE" as const, provenance: provenanceFixture() };
}

function draftFixture() {
  return {
    id: draftId,
    organizationId,
    obligationId,
    stageId,
    releaseId: "99999999-9999-4999-8999-999999999999",
    stage: "notification",
    revision: 1,
    status: "editable",
    completeness: "incomplete",
    fieldDefinitions: [
      {
        key: "summary",
        label: "Summary",
        description: null,
        type: "long_text",
        required: true,
        requiredWhen: null,
        templateEligible: true,
      },
    ],
    fields: [fieldFixture()],
    memberStates: [memberStateFixture()],
    prepopulatedFromSubmissionId: null,
    requiresTemplateReview: false,
    lock: null,
    createdBy: actorFixture(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function templateFixture() {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    organizationId,
    obligationType: "severe_incident",
    stage: "notification",
    name: "Incident baseline",
    description: "Reusable operator wording.",
    currentVersion: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version: 1,
      fields: [fieldFixture()],
      createdBy: actorFixture(),
      createdAt: timestamp,
    },
    createdBy: actorFixture(),
    createdAt: timestamp,
    archivedAt: null,
  };
}
