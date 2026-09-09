import { describe, expect, it } from "vitest";

import {
  cancelReportingObligationInputSchema,
  correctReportingObligationAnchorInputSchema,
  createReportingObligationInputSchema,
  recordReportingObligationStageSubmissionInputSchema,
  reportingObligationDetailResponseSchema,
  reportingObligationListQuerySchema,
  reportingObligationListResponseSchema,
  reportingDeadlineSummaryResponseSchema,
} from "./reporting-obligations.schema";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";

describe("reporting obligation contracts", () => {
  it("accepts a manual actively exploited vulnerability obligation", () => {
    expect(
      createReportingObligationInputSchema.parse({
        type: "actively_exploited_vulnerability",
        source: { kind: "manual" },
        awarenessAt: "2026-04-14T09:20:00Z",
        awarenessBasis: "PSIRT confirmed exploitability.",
        idempotencyKey: key,
      }),
    ).toMatchObject({
      awarenessAt: "2026-04-14T09:20:00Z",
      source: { kind: "manual" },
    });
  });

  it("accepts finding-created obligations without assessment or evidence fields", () => {
    const parsed = createReportingObligationInputSchema.parse({
      type: "severe_incident",
      source: { kind: "finding", findingId: uuid },
      awarenessAt: "2026-04-14T09:20:00Z",
      awarenessBasis: "Incident responder asserted customer impact.",
      idempotencyKey: key,
    });

    expect(parsed.source.kind).toBe("finding");
  });

  it("rejects unknown keys and malformed identifiers", () => {
    expect(() =>
      createReportingObligationInputSchema.parse({
        type: "actively_exploited_vulnerability",
        source: { kind: "finding", findingId: "not-a-uuid" },
        awarenessAt: "2026-04-14T09:20:00Z",
        awarenessBasis: "Confirmed.",
        idempotencyKey: key,
        evidenceIds: [otherUuid],
      }),
    ).toThrow();
  });

  it("requires UTC timestamps at whole-second precision", () => {
    expect(() =>
      createReportingObligationInputSchema.parse({
        type: "actively_exploited_vulnerability",
        source: { kind: "manual" },
        awarenessAt: "2026-04-14T09:20:00.123Z",
        awarenessBasis: "PSIRT confirmed exploitability.",
        idempotencyKey: key,
      }),
    ).toThrow();
  });

  it("enforces reason and basis text limits", () => {
    expect(() =>
      createReportingObligationInputSchema.parse({
        type: "severe_incident",
        source: { kind: "manual" },
        awarenessAt: "2026-04-14T09:20:00Z",
        awarenessBasis: "",
        idempotencyKey: key,
      }),
    ).toThrow();
    expect(() =>
      cancelReportingObligationInputSchema.parse({
        reason: "x".repeat(4001),
        expectedVersion: 1,
        idempotencyKey: key,
      }),
    ).toThrow();
  });

  it("requires expected versions and idempotency keys for mutations", () => {
    expect(() =>
      correctReportingObligationAnchorInputSchema.parse({
        anchor: "awareness",
        anchorAt: "2026-04-14T09:20:00Z",
        reason: "Corrected from incident bridge timestamp.",
        idempotencyKey: key,
      }),
    ).toThrow();
    expect(() =>
      recordReportingObligationStageSubmissionInputSchema.parse({
        stage: "notification",
        submittedAt: "2026-04-17T08:00:00Z",
        submissionReference: "Manual package CRA-17",
        expectedVersion: 1,
        idempotencyKey: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("parses due dates for the BRD baseline examples", () => {
    const response = reportingObligationDetailResponseSchema.parse({
      obligation: obligationFixture({
        stages: [
          stage(
            "early_warning",
            "awareness",
            "PT24H",
            "running",
            "2026-04-15T09:20:00Z",
          ),
          stage(
            "notification",
            "awareness",
            "PT72H",
            "running",
            "2026-04-17T09:20:00Z",
          ),
          stage(
            "final_report",
            "remediation_available",
            "P14D",
            "pending_anchor",
            null,
          ),
        ],
      }),
    });

    expect(response.obligation.stages[0]?.dueAt).toBe("2026-04-15T09:20:00Z");
    expect(response.obligation.stages[1]?.dueAt).toBe("2026-04-17T09:20:00Z");
    expect(response.obligation.stages[2]?.state).toBe("pending_anchor");
  });

  it("keeps final report stages type-specific", () => {
    expect(() =>
      reportingObligationDetailResponseSchema.parse({
        obligation: obligationFixture({
          type: "severe_incident",
          stages: [
            stage(
              "early_warning",
              "awareness",
              "PT24H",
              "running",
              "2026-04-15T09:20:00Z",
            ),
            stage(
              "notification",
              "awareness",
              "PT72H",
              "submitted",
              "2026-04-17T09:20:00Z",
            ),
            stage(
              "final_report",
              "remediation_available",
              "P14D",
              "running",
              "2026-05-08T16:00:00Z",
            ),
          ],
        }),
      }),
    ).toThrow();
  });

  it("parses keyset pagination and list responses", () => {
    expect(
      reportingObligationListQuerySchema.parse({
        limit: "25",
        type: "severe_incident",
      }),
    ).toMatchObject({ limit: 25 });

    expect(
      reportingObligationListResponseSchema.parse({
        obligations: [summaryFixture({})],
        nextCursor: null,
      }),
    ).toHaveProperty("obligations.0.id", uuid);
  });

  it("accepts only a server-timed reporting deadline summary", () => {
    expect(
      reportingDeadlineSummaryResponseSchema.parse({
        summary: {
          serverNow: "2026-04-15T09:20:00Z",
          overdueCount: 1,
          nextDeadline: {
            obligationId: uuid,
            stage: "notification",
            dueAt: "2026-04-17T09:20:00Z",
            elapsedPercent: 75,
            reportingHref: `/reporting?obligationId=${uuid}`,
          },
        },
      }),
    ).toHaveProperty("summary.nextDeadline.elapsedPercent", 75);
    expect(() =>
      reportingDeadlineSummaryResponseSchema.parse({
        summary: {
          serverNow: "2026-04-15T09:20:00Z",
          overdueCount: 0,
          nextDeadline: null,
          browserNow: "untrusted",
        },
      }),
    ).toThrow();
  });
});

function summaryFixture(
  overrides: Partial<ReturnType<typeof obligationFixture>>,
) {
  const { anchors, ...summary } = obligationFixture({
    stages: [
      stage(
        "early_warning",
        "awareness",
        "PT24H",
        "running",
        "2026-04-15T09:20:00Z",
      ),
      stage(
        "notification",
        "awareness",
        "PT72H",
        "running",
        "2026-04-17T09:20:00Z",
      ),
      stage(
        "final_report",
        "remediation_available",
        "P14D",
        "pending_anchor",
        null,
      ),
    ],
    ...overrides,
  });
  expect(anchors).toHaveLength(1);
  return summary;
}

function obligationFixture(
  overrides: Partial<
    Parameters<
      typeof reportingObligationDetailResponseSchema.parse
    >[0]["obligation"]
  >,
) {
  return {
    id: uuid,
    organizationId: otherUuid,
    type: "actively_exploited_vulnerability",
    status: "active",
    source: { kind: "manual" },
    ruleSet: {
      id: "44444444-4444-4444-8444-444444444444",
      version: 1,
      jurisdiction: "EU-CRA",
      effectiveFrom: "2026-09-11T00:00:00Z",
      effectiveTo: null,
    },
    awarenessAt: "2026-04-14T09:20:00Z",
    awarenessBasis: "PSIRT confirmed exploitability.",
    createdBy: {
      userId: "55555555-5555-4555-8555-555555555555",
      displayName: "Owner CRA",
    },
    createdAt: "2026-04-14T09:25:00Z",
    updatedAt: "2026-04-14T09:25:00Z",
    version: 1,
    cancelledAt: null,
    cancellationReason: null,
    stages: [],
    anchors: [
      {
        kind: "awareness",
        anchoredAt: "2026-04-14T09:20:00Z",
        basis: "PSIRT confirmed exploitability.",
        reason: null,
        recordedBy: {
          userId: "55555555-5555-4555-8555-555555555555",
          displayName: "Owner CRA",
        },
        recordedAt: "2026-04-14T09:25:00Z",
      },
    ],
    ...overrides,
  };
}

function stage(
  kind: "early_warning" | "notification" | "final_report",
  anchor: "awareness" | "remediation_available" | "notification_submitted",
  duration: "PT24H" | "PT72H" | "P14D" | "P1M",
  state: "pending_anchor" | "running" | "submitted" | "overdue",
  dueAt: string | null,
) {
  return {
    id: crypto.randomUUID(),
    kind,
    anchor,
    duration,
    state,
    dueAt,
    submittedAt: state === "submitted" ? "2026-04-17T08:00:00Z" : null,
    overdueAt: state === "overdue" ? "2026-04-17T09:20:01Z" : null,
    deadlineRevision: 1,
    elapsedPercent: state === "pending_anchor" ? null : 50,
    breachedAt: state === "overdue" ? "2026-04-17T09:20:00Z" : null,
    version: 1,
  };
}
