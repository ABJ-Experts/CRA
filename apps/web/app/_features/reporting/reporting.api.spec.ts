import { afterEach, describe, expect, it, vi } from "vitest";

import { reportingApi } from "./reporting.api";

const obligationId = "11111111-1111-4111-8111-111111111111";
const findingId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const ruleSetId = "44444444-4444-4444-8444-444444444444";
const key = "55555555-5555-4555-8555-555555555555";
const stageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("reportingApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes list filters and parses reporting obligation responses", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ obligations: [obligation()], nextCursor: null }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      reportingApi.list({
        type: "actively_exploited_vulnerability",
        status: "active",
        findingId,
        limit: 25,
      }),
    ).resolves.toMatchObject({ obligations: [{ id: obligationId }] });

    const path = String(fetcher.mock.calls[0]?.[0]);
    expect(path).toContain("/api/v1/reporting/obligations?");
    expect(path).toContain("type=actively_exploited_vulnerability");
    expect(path).toContain(`findingId=${findingId}`);
  });

  it("validates mutation payloads before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      reportingApi.create({
        type: "actively_exploited_vulnerability",
        source: { kind: "finding", findingId: "not-a-uuid" },
        awarenessAt: "2026-04-14T09:20:00Z",
        awarenessBasis: "Human asserted awareness.",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps stage-draft mutations local, validated, and behind the stage route", async () => {
    const fetcher = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      reportingApi.createStageDraft(obligationId, stageId, {
        releaseId: "not-a-uuid",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("serializes family-template filters through the shared query contract", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ templates: [] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      reportingApi.familyTemplates({
        obligationType: "severe_incident",
        stage: "notification",
      }),
    ).resolves.toEqual({ templates: [] });

    const path = String(fetcher.mock.calls[0]?.[0]);
    expect(path).toContain("/api/v1/reporting/templates?");
    expect(path).toContain("obligationType=severe_incident");
    expect(path).toContain("stage=notification");
  });

  it("does not accept malformed successful response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ obligation: { id: obligationId } })),
    );

    await expect(
      reportingApi.create({
        type: "severe_incident",
        source: { kind: "manual" },
        awarenessAt: "2026-04-14T09:20:00Z",
        awarenessBasis: "Security incident commander asserted awareness.",
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("parses only a strict server-timed deadline summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          summary: {
            serverNow: "2026-04-15T09:20:00Z",
            overdueCount: 0,
            nextDeadline: {
              obligationId,
              stage: "early_warning",
              dueAt: "2026-04-15T09:20:00Z",
              elapsedPercent: 50,
              reportingHref: `/reporting?obligationId=${obligationId}`,
            },
          },
        }),
      ),
    );

    await expect(reportingApi.deadlineSummary()).resolves.toMatchObject({
      summary: { overdueCount: 0 },
    });
  });
});

function obligation() {
  return {
    id: obligationId,
    organizationId: "66666666-6666-4666-8666-666666666666",
    type: "actively_exploited_vulnerability",
    status: "active",
    source: { kind: "finding", findingId },
    ruleSet: {
      id: ruleSetId,
      version: 1,
      jurisdiction: "EU-CRA",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
    },
    awarenessAt: "2026-04-14T09:20:00Z",
    awarenessBasis: "Human asserted awareness.",
    createdBy: { userId, displayName: "Owner Account" },
    createdAt: "2026-09-09T09:20:00Z",
    updatedAt: "2026-09-09T09:20:00Z",
    version: 1,
    cancelledAt: null,
    cancellationReason: null,
    stages: [
      stage("early_warning", "awareness", "PT24H", "2026-04-15T09:20:00Z"),
      stage("notification", "awareness", "PT72H", "2026-04-17T09:20:00Z"),
      stage("final_report", "remediation_available", "P14D", null),
    ],
  };
}

function stage(
  kind: "early_warning" | "notification" | "final_report",
  anchor: "awareness" | "remediation_available",
  duration: "PT24H" | "PT72H" | "P14D",
  dueAt: string | null,
) {
  return {
    id: `${kind === "early_warning" ? "77777777" : kind === "notification" ? "88888888" : "99999999"}-7777-4777-8777-777777777777`,
    kind,
    anchor,
    duration,
    state: dueAt === null ? "pending_anchor" : "running",
    dueAt,
    submittedAt: null,
    overdueAt: null,
    deadlineRevision: 1,
    elapsedPercent: dueAt === null ? null : 50,
    breachedAt: null,
    version: 1,
  };
}
