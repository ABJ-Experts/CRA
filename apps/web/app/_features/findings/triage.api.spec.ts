import { afterEach, describe, expect, it, vi } from "vitest";
import {
  vulnerabilityTriageQueueQuerySchema,
  type SubmitVulnerabilityFindingAssessmentInput,
  type RecordVulnerabilityRemediationAnchorInput,
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

  it("rejects malformed bulk targets before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.createAssessmentBulkPreview({
        selection: { mode: "selected_rows", findingIds: ["not-a-uuid"] },
        assessment: {
          status: "affected",
          detail: "The affected code path is present in this release.",
          changeReason: "Apply the same reviewed conclusion.",
          evidenceLinks: [],
        },
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow("The request contains invalid data.");
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

  it("serializes operational filters and versioned suppression without replaying writes", async () => {
    const findingId = "11111111-1111-4111-8111-111111111111";
    const idempotencyKey = "33333333-3333-4333-8333-333333333333";
    const operational = {
      version: 1,
      assignee: null,
      suppression: {
        state: "suppressed",
        reason: "Awaiting the vendor maintenance window.",
        expiresAt: "2030-01-01T00:00:00.000Z",
        revision: 1,
      },
      internalSla: {
        state: "paused",
        severity: "high",
        targetMinutes: 60,
        startedAt: "2026-09-08T10:00:00.000Z",
        pausedAt: "2026-09-08T10:05:00.000Z",
        dueAt: "2026-09-08T11:00:00.000Z",
      },
      notification: {
        state: "retrying",
        lastAttemptAt: "2026-09-08T10:05:00.000Z",
        deliveredAt: null,
        failureMessage: "Provider unavailable.",
      },
      remediation: {
        state: "not_recorded",
        anchor: null,
        reintroduction: {
          state: "not_reintroduced",
          fromFindingId: null,
          detectedAt: null,
        },
      },
    } as const;
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) =>
      String(input).includes("/suppression")
        ? json({ operational })
        : json({ rows: [], nextCursor: null, filterIssues: [] }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.list({
        suppressionStates: ["suppressed"],
        internalSlaStates: ["breached"],
        notificationDeliveryStates: ["dead_letter"],
      }),
    ).resolves.toMatchObject({ rows: [] });

    await expect(
      vulnerabilityTriageApi.suppress(findingId, {
        reason: "Awaiting the vendor maintenance window.",
        expiresAt: "2030-01-01T00:00:00.000Z",
        expectedVersion: 0,
        idempotencyKey,
      }),
    ).resolves.toEqual({ operational });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "suppressionStates=suppressed",
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "internalSlaStates=breached",
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/v1/findings/${findingId}/suppression`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("serializes remediation queue filters and validates versioned writes", async () => {
    const findingId = "11111111-1111-4111-8111-111111111111";
    const idempotencyKey = "33333333-3333-4333-8333-333333333333";
    const remediation = {
      state: "available",
      anchor: {
        id: "22222222-2222-4222-8222-222222222222",
        findingId,
        revision: 1,
        remediationKind: "corrective",
        fixVersion: "2.4.1",
        mitigationDescription: "The vendor-provided package is available.",
        availabilityAt: "2020-09-08T10:00:00.000Z",
        availabilityProvenance: "human_asserted",
        availabilityBasis: "Vendor confirmation reviewed by the owner.",
        correctionReason: null,
        recordedByUserId: findingId,
        recordedAt: "2020-09-08T10:05:00.000Z",
      },
      reintroduction: {
        state: "not_reintroduced",
        fromFindingId: null,
        detectedAt: null,
      },
    } as const;
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) =>
      String(input).includes("/remediation")
        ? json({ remediation })
        : json({ rows: [], nextCursor: null, filterIssues: [] }),
    );
    vi.stubGlobal("fetch", fetcher);
    const input: RecordVulnerabilityRemediationAnchorInput = {
      remediationKind: "corrective",
      fixVersion: "2.4.1",
      mitigationDescription: "The vendor-provided package is available.",
      availabilityAt: "2020-09-08T10:00:00.000Z",
      availabilityProvenance: "human_asserted",
      availabilityBasis: "Vendor confirmation reviewed by the owner.",
      expectedVersion: 0,
      idempotencyKey,
    };

    await expect(
      vulnerabilityTriageApi.list({
        remediationStates: ["available"],
        reintroductionStates: ["reintroduced"],
      }),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      vulnerabilityTriageApi.recordRemediation(findingId, input),
    ).resolves.toEqual({ remediation });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "remediationStates=available",
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "reintroductionStates=reintroduced",
    );
    expect(fetcher).toHaveBeenLastCalledWith(
      `/api/v1/findings/${findingId}/remediation`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("validates VEX export scope, registry target paths, and safe download handoffs", async () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    const releaseId = "22222222-2222-4222-8222-222222222222";
    const exportId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const path = String(input);
      if (path.endsWith("/download")) {
        return json({
          downloadUrl: "http://127.0.0.1:54321/storage/v1/object/sign/vex/a",
          expiresAt: "2026-09-08T12:05:00.000Z",
          contentSha256: "a".repeat(64),
          byteSize: 123,
        });
      }
      if (path.includes(`/publications/${releaseId}/`)) {
        return json({
          publication: {
            id: releaseId,
            organizationId: productId,
            exportId,
            targetId: productId,
            state: "pending",
            attempts: 0,
            version: 1,
            lastErrorCode: null,
            lastErrorMessage: null,
            publishedAt: null,
            replacedByExportId: null,
            withdrawnAt: null,
            withdrawnReason: null,
            createdAt: "2026-09-08T12:00:00.000Z",
            updatedAt: "2026-09-08T12:00:00.000Z",
          },
          idempotent: false,
        });
      }
      if (path.includes("/preview?")) {
        return json({
          organizationId: productId,
          productId,
          releaseId,
          scopeVersion: 2,
          scopeDigest: "b".repeat(64),
          eligibleAssessmentRevisions: [],
          formatAvailability: [
            {
              format: "openvex",
              specificationVersion: "0.2.0",
              supported: true,
              mappingIssues: [],
            },
            {
              format: "cyclonedx-vex",
              specificationVersion: "1.6",
              supported: true,
              mappingIssues: [],
            },
          ],
        });
      }
      return json({
        export: {
          id: exportId,
          organizationId: productId,
          productId,
          releaseId,
          format: "openvex",
          specificationVersion: "0.2.0",
          scopeVersion: 2,
          scopeDigest: "b".repeat(64),
          contentSha256: "a".repeat(64),
          byteSize: 123,
          assessmentRevisionReferences: [
            {
              findingId: productId,
              assessmentId: releaseId,
              assessmentRevision: 1,
              status: "not_affected",
              justification: "component_not_present",
              approvalState: "approved",
            },
          ],
          createdAt: "2026-09-08T12:00:00.000Z",
          createdByUserId: productId,
        },
        idempotent: false,
      });
    });
    vi.stubGlobal("fetch", fetcher);

    await vulnerabilityTriageApi.vexExportPreview({ productId, releaseId });
    await vulnerabilityTriageApi.createVexExport({
      productId,
      releaseId,
      format: "openvex",
      expectedScopeVersion: 2,
      expectedScopeDigest: "b".repeat(64),
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    await expect(
      vulnerabilityTriageApi.vexExportDownload(exportId),
    ).resolves.toMatchObject({
      contentSha256: "a".repeat(64),
    });
    await vulnerabilityTriageApi.retryVexPublication(releaseId, {
      expectedVersion: 1,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
    await vulnerabilityTriageApi.withdrawVexPublication(releaseId, {
      expectedVersion: 1,
      withdrawalReason: "Retire the configured endpoint.",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      `/api/v1/findings/vex-exports/preview?productId=${productId}&releaseId=${releaseId}`,
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/findings/vex-exports");
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `/api/v1/findings/vex-exports/${exportId}/download`,
    );
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: "GET" });
    expect(fetcher.mock.calls[3]?.[0]).toBe(
      `/api/v1/findings/vex-exports/publications/${releaseId}/retry`,
    );
    expect(fetcher.mock.calls[4]?.[0]).toBe(
      `/api/v1/findings/vex-exports/publications/${releaseId}/withdraw`,
    );
    expect(() =>
      vulnerabilityTriageApi.updateVexPublicationTarget({
        targetKey: "HTTPS://untrusted.example",
        enabled: true,
        expectedVersion: 0,
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow("The request contains invalid data.");
  });
});
