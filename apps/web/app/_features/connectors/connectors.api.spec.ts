import { afterEach, describe, expect, it, vi } from "vitest";

import { connectorsApi } from "./connectors.api";

const CONNECTOR_ID = "11111111-1111-4111-8111-111111111111";

const POLICY = {
  id: "22222222-2222-4222-8222-222222222222",
  connectorId: CONNECTOR_ID,
  entityType: "product",
  fieldName: "name",
  policyValue: "cra_authoritative",
  protected: false,
  protectedReason: null,
  policyVersion: 1,
} as const;

const DIAGNOSTICS = {
  filename: "connector-diagnostic-reference-connector.json",
  report: {
    generatedAt: "2026-08-20T10:00:00.000Z",
    connectorId: CONNECTOR_ID,
    connectorStatus: "completed",
    cursorAgeSeconds: 12,
    latestRun: null,
    counts: { openConflicts: 0, deadLetters: 0, retries: 0 },
  },
} as const;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("connectorsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves field authority through the controller's POST mapping route", async () => {
    const fetcher = vi.fn(async () => json({ policy: POLICY }));
    vi.stubGlobal("fetch", fetcher);

    const input = {
      entityType: "product" as const,
      fieldName: "name",
      policyValue: "cra_authoritative" as const,
      protected: false,
      previewDigest: "a".repeat(64),
    };

    await expect(connectorsApi.saveMapping(CONNECTOR_ID, input)).resolves.toEqual({
      policy: POLICY,
    });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/connectors/${CONNECTOR_ID}/mapping`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("parses the controller's outcome envelope when unlinking an external identity", async () => {
    const mappingId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn(async () => json({ outcome: "identity_unlinked" }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      connectorsApi.unlinkIdentity(CONNECTOR_ID, mappingId, {
        reason: "The external record was reassigned.",
      }),
    ).resolves.toEqual({ outcome: "identity_unlinked" });

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/connectors/${CONNECTOR_ID}/identities/${mappingId}/unlink`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects an invalid external identity path before it sends a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(
      connectorsApi.unlinkIdentity(CONNECTOR_ID, "not-a-uuid", {
        reason: "The external record was reassigned.",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("exports only the redacted diagnostics report through the dedicated route", async () => {
    const fetcher = vi.fn(async () => json(DIAGNOSTICS));
    vi.stubGlobal("fetch", fetcher);

    await expect(connectorsApi.exportDiagnostics(CONNECTOR_ID)).resolves.toEqual(
      DIAGNOSTICS,
    );

    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/connectors/${CONNECTOR_ID}/diagnostics/export`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });
});
