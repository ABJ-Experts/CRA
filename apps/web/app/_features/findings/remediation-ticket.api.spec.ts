import { afterEach, describe, expect, it, vi } from "vitest";

import { vulnerabilityTriageApi } from "./triage.api";

const findingId = "11111111-1111-4111-8111-111111111111";
const bindingId = "22222222-2222-4222-8222-222222222222";
const ticketId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const bindingInput = {
  connectorId: "55555555-5555-4555-8555-555555555555",
  productId: "66666666-6666-4666-8666-666666666666",
  cloudId: "77777777-7777-4777-8777-777777777777",
  projectId: "10000",
  projectKey: "SEC",
  issueTypeId: "10001",
  statusTransitions: [
    { fromStatusId: "1", toStatusId: "2", transitionId: "11" },
  ],
  statusMappings: [{ statusId: "1", workState: "open" as const }],
  customFieldMappings: [],
};

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

const preview = {
  summary: "Review affected component",
  description: "Approved minimal remediation context",
  projectKey: "SEC",
  issueTypeId: "10001",
  contextDigest: "a".repeat(64),
};

const pendingTicket = {
  id: ticketId,
  findingId,
  bindingId,
  provider: "jira",
  externalIssueId: null,
  externalIssueKey: null,
  externalUrl: null,
  externalStatus: null,
  status: "sync_pending",
  syncRevision: 0,
  lastSyncDirection: null,
  lastSyncAt: null,
  lastInboundEventId: null,
  conflictReason: null,
  correlationId: "55555555-5555-4555-8555-555555555555",
  version: 1,
};

describe("remediation ticket browser API boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses owner binding dry-run and upsert responses at the wire boundary", async () => {
    const binding = {
      ...bindingInput,
      id: bindingId,
      provider: "jira",
      externalBaseUrl: "https://example.atlassian.net",
      status: "active",
      version: 1,
      createdAt: "2026-09-30T00:00:00.000Z",
      updatedAt: "2026-09-30T00:00:00.000Z",
    };
    const fetcher = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json({ valid: true, errors: [] }))
      .mockResolvedValueOnce(json({ binding }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.dryRunRemediationTicketBinding(bindingInput),
    ).resolves.toEqual({ valid: true, errors: [] });
    await expect(
      vulnerabilityTriageApi.upsertRemediationTicketBinding({
        ...bindingInput,
        idempotencyKey,
      }),
    ).resolves.toEqual({ binding });
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/findings/remediation-ticket-bindings/dry-run",
      "/api/v1/findings/remediation-ticket-bindings",
    ]);
    expect(
      JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).idempotencyKey,
    ).toBe(idempotencyKey);
  });

  it("parses the approved preview and sends only the binding reference", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ preview }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.previewRemediationTicket(findingId, { bindingId }),
    ).resolves.toEqual({ preview });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/findings/${findingId}/remediation-tickets/preview`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      bindingId,
    });
  });

  it("rejects a malformed preview response and invalid replay ticket ID", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ preview: { ...preview, contextDigest: "wrong" } }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.previewRemediationTicket(findingId, { bindingId }),
    ).rejects.toThrow();
    expect(() =>
      vulnerabilityTriageApi.replayRemediationTicket(findingId, "not-a-uuid", {
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).toThrow("The linked ticket identifier is invalid.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed preview and create inputs before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.previewRemediationTicket(findingId, {
        bindingId: "not-a-uuid",
      }),
    ).rejects.toThrow("The request contains invalid data.");
    await expect(
      vulnerabilityTriageApi.syncRemediationTicket(findingId, {
        bindingId,
        expectedTicketVersion: 0,
        contextDigest: "not-a-digest",
        idempotencyKey,
      }),
    ).rejects.toThrow("The request contains invalid data.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends preview digest for explicit creation and version for replay", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ ticket: pendingTicket }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.syncRemediationTicket(findingId, {
        bindingId,
        expectedTicketVersion: 0,
        contextDigest: preview.contextDigest,
        idempotencyKey,
      }),
    ).resolves.toEqual({ ticket: pendingTicket });
    await expect(
      vulnerabilityTriageApi.replayRemediationTicket(findingId, ticketId, {
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).resolves.toEqual({ ticket: pendingTicket });

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      expectedTicketVersion: 0,
      contextDigest: preview.contextDigest,
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      `/api/v1/findings/${findingId}/remediation-tickets/${ticketId}/replay`,
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      expectedVersion: 1,
      idempotencyKey,
    });
  });
});
