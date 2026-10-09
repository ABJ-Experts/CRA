import { afterEach, describe, expect, it, vi } from "vitest";

import { technicalFilesApi } from "./technical-files.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const EXPORT_ID = "33333333-3333-4333-8333-333333333333";

function json(value: unknown) { return new Response(JSON.stringify(value), { status: 200 }); }

describe("technical-file auditor access gateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the scoped owner preview route and rejects an unsafe export identifier", async () => {
    const fetcher = vi.fn(async () => json({ preview: {} }));
    vi.stubGlobal("fetch", fetcher);
    expect(() => technicalFilesApi.previewAuditorGrant(PRODUCT_ID, SNAPSHOT_ID, "not-a-uuid")).toThrow("The snapshot export identifier is invalid.");
    expect(fetcher).not.toHaveBeenCalled();
    expect(technicalFilesApi.auditorArtifactPath("pdf")).toBe("/api/v1/auditor/snapshot/artifacts/pdf");
    expect(() => technicalFilesApi.auditorArtifactPath("pdf/other" as "pdf")).toThrow("The requested auditor artifact is invalid.");
    expect(EXPORT_ID).toHaveLength(36);
  });
});
