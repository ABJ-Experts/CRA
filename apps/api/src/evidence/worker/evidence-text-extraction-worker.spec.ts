import { Readable } from "node:stream";
import type { SupabaseService } from "../../supabase/supabase.service";
import { EvidenceTextExtractionWorker } from "./evidence-text-extraction-worker";

describe("EvidenceTextExtractionWorker", () => {
  it.each([
    {
      pages: [{ page: 1, text: "safe evidence text" }],
      expectedPageMap: [{ page: 1, text: "safe evidence text" }],
    },
    { pages: [], expectedPageMap: null },
  ])(
    "completes a verified job with page map $expectedPageMap",
    async ({ pages, expectedPageMap }) => {
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
              pages,
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
          p_page_map: expectedPageMap,
        }),
      );
    },
  );

  it("deduplicates organization scans and leaves unclaimed jobs untouched", async () => {
    const { worker, rpc, extract } = harness({
      organizations: [
        { organization_id: "org" },
        { organization_id: "org" },
        { organization_id: "other" },
        { organization_id: null },
      ],
      claims: [null, { outcome: "empty" }],
    });
    await expect(worker.runOnce()).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_evidence_text_extraction_job_atomic",
      {
        p_organization_id: "org",
        p_worker_id: workerId,
        p_lease_seconds: 120,
      },
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it.each([
    ["missing version", null, "source_unavailable", "retry", "unavailable"],
    [
      "changed digest",
      { original_sha256: "b".repeat(64) },
      "source_unavailable",
      "retry",
      "unavailable",
    ],
  ])(
    "does not extract a %s",
    async (_label, version, _failure, outcome, code) => {
      const { worker, rpc, openVerified, extract } = harness({ version });
      await expect(worker.runOnce()).resolves.toBe(1);
      expect(openVerified).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenLastCalledWith(
        "complete_evidence_text_extraction_job_atomic",
        expect.objectContaining({
          p_outcome: outcome,
          p_failure_code: code,
          p_retry_after_seconds: 300,
          p_page_map: null,
        }),
      );
    },
  );

  it("treats unavailable verified storage as retryable without parsing bytes", async () => {
    const { worker, rpc, extract, openVerified } = harness({ stream: null });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(openVerified).toHaveBeenCalledWith({
      objectKey: "key",
      sha256: "a".repeat(64),
      byteSize: 10,
    });
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_evidence_text_extraction_job_atomic",
      expect.objectContaining({
        p_outcome: "retry",
        p_failure_code: "unavailable",
      }),
    );
  });

  it.each([
    ["low_quality", "failed", "low", null],
    ["unsupported", "failed", "not_assessed", null],
    ["timeout", "retry", "not_assessed", 300],
    ["extractor_unavailable", "failed", "not_assessed", null],
  ] as const)(
    "records %s extraction with its quality and retry policy",
    async (failureCode, outcome, quality, retryAfter) => {
      const { worker, rpc } = harness({
        result: { outcome: "failed", failureCode },
      });
      await expect(worker.runOnce()).resolves.toBe(1);
      expect(rpc).toHaveBeenLastCalledWith(
        "complete_evidence_text_extraction_job_atomic",
        expect.objectContaining({
          p_outcome: outcome,
          p_quality: quality,
          p_retry_after_seconds: retryAfter,
          p_extracted_text: null,
          p_page_map: null,
        }),
      );
    },
  );

  it("does not fabricate source spans for truncated extraction", async () => {
    const { worker, rpc } = harness({
      result: {
        outcome: "complete",
        text: "bounded text",
        quality: "native",
        truncated: true,
        pages: [],
      },
    });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(rpc).toHaveBeenLastCalledWith(
      "complete_evidence_text_extraction_job_atomic",
      expect.objectContaining({
        p_page_map: null,
        p_is_truncated: true,
        p_quality: "sufficient",
      }),
    );
  });

  it("fails closed when a claim or completion RPC fails", async () => {
    const claim = harness({ claimError: true });
    await expect(claim.worker.runOnce()).rejects.toThrow(
      "Evidence extraction claim unavailable",
    );
    expect(claim.extract).not.toHaveBeenCalled();

    const completion = harness({ completion: "conflict" });
    await expect(completion.worker.runOnce()).rejects.toThrow(
      "Evidence extraction completion was not accepted",
    );
  });
});

const workerId = "00000000-0000-4000-8000-000000000099";
const defaultVersion = {
  object_key: "key",
  actual_size_bytes: 10,
  detected_media_type: "text/plain",
  original_sha256: "a".repeat(64),
};

function harness(
  options: {
    organizations?: unknown[];
    claims?: unknown[];
    claimError?: boolean;
    completion?: unknown;
    version?: Record<string, unknown> | null;
    stream?: Readable | null;
    result?: unknown;
  } = {},
) {
  const claims = [
    ...(options.claims ?? [
      {
        versionId: "version",
        sourceSha256: "a".repeat(64),
        extractorVersion: "m8-03-local-v1",
      },
    ]),
  ];
  const rpc = jest.fn((name: string) => {
    if (name === "claim_evidence_text_extraction_job_atomic")
      return Promise.resolve(
        options.claimError
          ? { data: null, error: { message: "offline" } }
          : { data: claims.shift(), error: null },
      );
    return Promise.resolve({
      data: options.completion ?? "completed",
      error: null,
    });
  });
  const from = jest.fn((table: string) => ({
    select: () => ({
      limit: () =>
        Promise.resolve({
          data:
            table === "evidence_document_extraction_jobs"
              ? (options.organizations ?? [{ organization_id: "org" }])
              : options.version === undefined
                ? [defaultVersion]
                : options.version === null
                  ? []
                  : [{ ...defaultVersion, ...options.version }],
        }),
      eq: () => ({
        eq: () => ({
          limit: () =>
            Promise.resolve({
              data:
                options.version === undefined
                  ? [defaultVersion]
                  : options.version === null
                    ? []
                    : [{ ...defaultVersion, ...options.version }],
            }),
        }),
      }),
    }),
  }));
  const openVerified = jest
    .fn()
    .mockResolvedValue(
      options.stream === undefined
        ? Readable.from(["source text"])
        : options.stream,
    );
  const extract = jest.fn().mockResolvedValue(
    options.result ?? {
      outcome: "complete",
      text: "source text",
      quality: "native",
      truncated: false,
      pages: [{ page: 1, text: "source text" }],
    },
  );
  const worker = new EvidenceTextExtractionWorker(
    {
      supabase: { admin: () => ({ rpc, from }) } as unknown as SupabaseService,
      storage: { openVerified },
      extractor: { extract },
      leaseSeconds: 120,
    },
    workerId,
  );
  return { worker, rpc, from, openVerified, extract };
}
