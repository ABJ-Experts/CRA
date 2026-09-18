import { Readable } from "node:stream";
import type { SupabaseService } from "../../supabase/supabase.service";
import { EvidenceTextExtractionWorker } from "./evidence-text-extraction-worker";

describe("EvidenceTextExtractionWorker", () => {
  it("uses a fresh supplied worker identity and completes a verified claimed job", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: {
          versionId: "version",
          sourceSha256: "a".repeat(64),
          extractorVersion: "m8-03-local-v1",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: "completed", error: null });
    const select = jest.fn((table: string) => ({
      select: () => ({
        limit: () =>
          Promise.resolve({
            data:
              table === "evidence_document_extraction_jobs"
                ? [{ organization_id: "org" }]
                : [],
          }),
        eq: () => ({
          eq: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    object_key: "key",
                    actual_size_bytes: 10,
                    detected_media_type: "text/plain",
                    original_sha256: "a".repeat(64),
                  },
                ],
              }),
          }),
        }),
      }),
    }));
    const worker = new EvidenceTextExtractionWorker(
      {
        supabase: {
          admin: () => ({ rpc, from: select }),
        } as unknown as SupabaseService,
        storage: {
          openVerified: jest
            .fn()
            .mockResolvedValue(Readable.from(["safe evidence text"])),
        },
        extractor: {
          extract: jest.fn().mockResolvedValue({
            outcome: "complete",
            text: "safe evidence text",
            quality: "native",
            truncated: false,
          }),
        },
        leaseSeconds: 120,
      },
      "00000000-0000-4000-8000-000000000099",
    );
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_evidence_text_extraction_job_atomic",
      expect.objectContaining({
        p_worker_id: "00000000-0000-4000-8000-000000000099",
        p_quality: "sufficient",
      }),
    );
  });
});
