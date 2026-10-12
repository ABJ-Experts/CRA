import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderReadinessReport } from "./readiness-renderer";
const report = {
  version: "m14_03_v1",
  product: {
    id: "8cc33f37-0297-4327-aa68-8a11c557fe7a",
    name: "Café Ω 日本",
    version: 2,
  },
  snapshotAsOf: "2026-10-09T00:00:00Z",
  technicalFileVersion: 3,
  canonicalReadiness: null,
  evidence: [],
  degraded: true,
  notices: ["Restricted sources are omitted"],
  documentationReadinessOnly: true,
  sourceVersions: [],
} as const;
describe("documentation readiness renderer", () => {
  it("renders parseable PDF and exact JSON with explicit glyph degradation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readiness-test-"));
    try {
      const parts = await renderReadinessReport(directory, report);
      expect(parts.map((part) => part.name)).toEqual([
        "readiness.pdf",
        "readiness.json",
      ]);
      const pdf = await PDFDocument.load(await readFile(parts[0]!.path));
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(JSON.parse(await readFile(parts[1]!.path, "utf8"))).toEqual(
        report,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("renders canonical gaps, authorized evidence validity and source versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "readiness-complete-"));
  try {
    const gap = {
      sectionKey: "general_description",
      code: "missing_evidence",
      priority: 1,
      actionLabel: "Attach current evidence",
    };
    const value = {
      ...report,
      degraded: false,
      product: { ...report.product, name: "Café\u0001 Product" },
      notices: [],
      canonicalReadiness: {
        technicalFileId: report.product.id,
        overallStatus: "partial",
        recalculationStatus: "current",
        calculatedAt: report.snapshotAsOf,
        sections: [
          {
            sectionKey: "general_description",
            status: "partial",
            gapCount: 1,
            validEvidenceCount: 1,
            staleEvidenceCount: 0,
            unavailableEvidenceCount: 0,
            staleReasons: [],
            gaps: [gap],
          },
        ],
        gaps: [gap],
      },
      evidence: [
        {
          id: report.product.id,
          name: "Expired evidence",
          sourceKind: "evidence_document",
          sourceVersion: "v2",
          validityStatus: "expired",
          validFrom: report.snapshotAsOf,
          validUntil: report.snapshotAsOf,
          stale: true,
          unavailable: true,
        },
        {
          id: report.product.id,
          name: "Unknown source",
          sourceKind: "evidence_document",
          sourceVersion: null,
          validityStatus: "missing",
          validFrom: null,
          validUntil: null,
          stale: false,
          unavailable: false,
        },
      ],
      sourceVersions: [
        { source: "product", version: "2", asOf: report.snapshotAsOf },
      ],
    };
    const parts = await renderReadinessReport(directory, value);
    expect(
      (await PDFDocument.load(await readFile(parts[0]!.path))).getPageCount(),
    ).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects oversized source text without truncating", async () => {
  const directory = await mkdtemp(join(tmpdir(), "readiness-bounds-"));
  try {
    await expect(
      renderReadinessReport(directory, {
        ...report,
        notices: Array.from({ length: 100 }, () => "x".repeat(1000)),
        evidence: Array.from({ length: 6000 }, () => ({
          id: report.product.id,
          name: "x".repeat(1000),
          sourceKind: "document",
          sourceVersion: null,
          validityStatus: "missing",
          validFrom: null,
          validUntil: null,
          stale: false,
          unavailable: true,
        })),
      }),
    ).rejects.toThrow("export_limit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("fails an overlong printable report explicitly and closes the output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "readiness-page-limit-"));
  try {
    await expect(
      renderReadinessReport(directory, {
        ...report,
        evidence: Array.from({ length: 3000 }, () => ({
          id: report.product.id,
          name: "x".repeat(180),
          sourceKind: "document",
          sourceVersion: null,
          validityStatus: "missing",
          validFrom: null,
          validUntil: null,
          stale: false,
          unavailable: true,
        })),
      }),
    ).rejects.toThrow("export_limit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
