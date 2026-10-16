import { createHash } from "node:crypto";

import { renderTechnicalFileSnapshotExport } from "./technical-file-snapshot-export-renderer";

describe("renderTechnicalFileSnapshotExport", () => {
  it("produces a bounded PDF and deterministic ZIP manifest without rendering HTML", async () => {
    const result = await renderTechnicalFileSnapshotExport(snapshot());

    expect(result.pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(result.archive.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(result.manifest.toString("utf8")).toContain("snapshot.json");
    expect(result.manifestSha256).toBe(
      createHash("sha256").update(result.manifest).digest("hex"),
    );
  });

  function snapshot() {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      purpose: "audit",
      auditRationale: "A controlled audit record is required.",
      releaseId: null,
      createdAt: "2026-09-14T10:00:00.000Z",
      readinessStatus: "partial",
      templateKey: "annex_vii",
      templateVersion: "1.0.0",
      payloadSha256: "a".repeat(64),
      payload: {
        technicalFile: {
          sections: [
            {
              heading: "General description",
              requirementText: "Describe the product.",
              status: "incomplete",
              narrative: "<script>not rendered as HTML</script>",
              sources: [],
            },
          ],
        },
      },
    } as never;
  }
});
