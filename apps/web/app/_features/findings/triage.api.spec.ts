import { afterEach, describe, expect, it, vi } from "vitest";
import {
  vulnerabilityTriageQueueQuerySchema,
  type SubmitVulnerabilityFindingAssessmentInput,
} from "@repo/contracts/vulnerabilities";

import { vulnerabilityTriageApi } from "./triage.api";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("vulnerabilityTriageApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes repeatable tenant filters and keyset cursor parameters", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ rows: [], nextCursor: null, filterIssues: [] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.list({
        productIds: ["11111111-1111-4111-8111-111111111111"],
        severities: ["critical", "high"],
        vexStatuses: ["not_affected"],
        approvalStates: ["awaiting_approval"],
        cursor: vulnerabilityTriageQueueQuerySchema.parse({
          cursor: "bmV4dC1jdXJzb3I",
        }).cursor,
        limit: 50,
        sort: "lastEvaluatedAt",
        order: "desc",
      }),
    ).resolves.toMatchObject({ rows: [], nextCursor: null });

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/findings?"),
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    const path = String(fetcher.mock.calls[0]?.[0]);
    expect(path).toContain("productIds=11111111-1111-4111-8111-111111111111");
    expect(path).toContain("severities=critical");
    expect(path).toContain("severities=high");
    expect(path).toContain("vexStatuses=not_affected");
    expect(path).toContain("approvalStates=awaiting_approval");
    expect(path).toContain("cursor=bmV4dC1jdXJzb3I");
  });

  it("rejects invalid filter ranges and finding identifiers before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      vulnerabilityTriageApi.list({ epssMin: 0.9, epssMax: 0.1 }),
    ).toThrow("The request contains invalid data.");
    expect(() => vulnerabilityTriageApi.detail("not-a-uuid")).toThrow(
      "The finding identifier is invalid.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("validates assessment writes at the browser boundary without retrying them", async () => {
    const findingId = "11111111-1111-4111-8111-111111111111";
    const assessmentId = "22222222-2222-4222-8222-222222222222";
    const idempotencyKey = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      json({
        assessment: {
          id: assessmentId,
          findingId,
          supersedesId: null,
          revision: 1,
          isCurrent: true,
          status: "affected",
          justification: null,
          detail: "The affected code path is present in this release.",
          changeReason: "Initial review.",
          evidenceLinks: [],
          approvalState: "awaiting_approval",
          approvalRequired: true,
          policySeverity: "high",
          policyVersion: 0,
          submittedAt: "2026-09-07T10:00:00.000Z",
          submittedByUserId: findingId,
          decidedAt: null,
          decidedByUserId: null,
          decisionReason: null,
          version: 1,
        },
        idempotent: false,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const input: SubmitVulnerabilityFindingAssessmentInput = {
      status: "affected",
      detail: "The affected code path is present in this release.",
      changeReason: "Initial review.",
      evidenceLinks: [],
      expectedVersion: 0,
      idempotencyKey,
    };

    await expect(
      vulnerabilityTriageApi.submitAssessment(findingId, input),
    ).resolves.toMatchObject({ idempotent: false });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/findings/${findingId}/assessment`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
});
