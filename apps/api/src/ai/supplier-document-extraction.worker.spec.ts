import { Readable } from "node:stream";
import type { SupabaseService } from "../supabase/supabase.service";

import { AiGatewayError } from "./ai-gateway";
import { SupplierDocumentExtractionWorker } from "./supplier-document-extraction.worker";

const orgId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const workerId = "00000000-0000-4000-8000-000000000004";
const sha = "a".repeat(64);
const pages = [{ page: 1, text: "Certification: ISO 9001" }];
const claimed = [
  {
    id: runId,
    organizationId: orgId,
    evidenceVersionId: versionId,
    evidenceSha256: sha,
  },
];
const context = {
  organizationId: orgId,
  runId,
  evidenceVersionId: versionId,
  evidenceSha256: sha,
  objectBucket: "evidence-documents",
  objectKey: `${orgId}/${orgId}/${versionId}/${runId}`,
  byteSize: 12,
  mediaType: "application/pdf",
  pageMap: pages,
  aiEnabled: true,
  aiResidency: "local_only",
  maxInputTokens: 10_000,
};
const candidate = {
  fieldKey: "certification_held",
  candidateGroup: "certificate-1",
  originalValue: "ISO 9001",
  confidence: 0.9,
  sourceSpan: { page: 1, startOffset: 15, endOffset: 23, quote: "ISO 9001" },
};

function setup(overrides: Record<string, unknown> = {}) {
  const rpc = jest.fn<Promise<{ data: unknown; error: null }>, [string]>(
    (name: string) => {
      if (name === "claim_supplier_document_extraction_atomic")
        return Promise.resolve({ data: claimed, error: null });
      if (name === "get_supplier_document_extraction_worker_atomic")
        return Promise.resolve({
          data: { ...context, ...overrides },
          error: null,
        });
      if (name === "attach_supplier_document_page_map_atomic")
        return Promise.resolve({ data: "attached", error: null });
      if (name === "complete_supplier_document_extraction_atomic")
        return Promise.resolve({
          data: [{ outcome: "completed" }],
          error: null,
        });
      throw new Error(`Unexpected RPC ${name}`);
    },
  );
  const storage = {
    openVerified: jest.fn().mockResolvedValue(Readable.from(["bytes"])),
  };
  const extractor = {
    extract: jest
      .fn()
      .mockResolvedValue({ outcome: "complete", pages, text: pages[0]!.text }),
  };
  const gateway = {
    extractSupplierFields: jest.fn().mockResolvedValue({
      promptVersion: "supplier-fields-v1",
      model: "qwen2.5:7b",
      candidates: [candidate],
      inputTokens: 50,
      outputTokens: 40,
      latencyMs: 5,
    }),
  };
  const worker = new SupplierDocumentExtractionWorker(
    {
      supabase: { admin: () => ({ rpc }) } as unknown as SupabaseService,
      storage,
      extractor,
      gateway,
    },
    workerId,
  );
  return { worker, rpc, storage, extractor, gateway };
}

describe("SupplierDocumentExtractionWorker", () => {
  it("completes a claimed run using its clean version-pinned page map", async () => {
    const { worker, rpc, storage, gateway } = setup();
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(storage.openVerified).not.toHaveBeenCalled();
    expect(gateway.extractSupplierFields).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        versionId,
        sourceSha256: sha,
        pages,
        policy: { enabled: true, mode: "local-only", remainingTokens: 10_000 },
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_worker_id: workerId,
        p_run_id: runId,
        p_model: "qwen2.5:7b",
        p_prompt_version: "supplier-fields-v1",
        p_suggestions: [candidate],
        p_failure_code: null,
      }),
    );
  });

  it("attaches page text from verified local OCR before inference when absent", async () => {
    const { worker, rpc, storage, extractor } = setup({ pageMap: null });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(storage.openVerified).toHaveBeenCalledWith({
      objectKey: context.objectKey,
      sha256: sha,
      byteSize: 12,
    });
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "application/pdf",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "attach_supplier_document_page_map_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_worker_id: workerId,
        p_run_id: runId,
        p_page_map: pages,
      }),
    );
  });

  it("fails closed when tenant policy is disabled", async () => {
    const { worker, rpc, gateway } = setup({ aiEnabled: false });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_failure_code: "policy_disabled",
        p_suggestions: [],
      }),
    );
  });

  it("maps provider outage to a durable failure and never persists suggestions", async () => {
    const { worker, rpc, gateway } = setup();
    gateway.extractSupplierFields.mockRejectedValue(
      new AiGatewayError("unavailable"),
    );
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_failure_code: "provider_unavailable",
        p_suggestions: [],
      }),
    );
  });

  it("does not infer when the leased source context is gone", async () => {
    const { worker, rpc, gateway } = setup();
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === "claim_supplier_document_extraction_atomic"
            ? claimed
            : name === "get_supplier_document_extraction_worker_atomic"
              ? null
              : [{ outcome: "stale_source" }],
        error: null,
      }),
    );
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
  });

  it("rejects a substituted organization or source version in the worker context", async () => {
    const { worker, rpc, gateway } = setup({ evidenceVersionId: runId });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({ p_failure_code: "stale_source" }),
    );
  });

  it("does not infer from an empty source page", async () => {
    const { worker, rpc, gateway } = setup({
      pageMap: [{ page: 1, text: "  " }],
    });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({ p_failure_code: "no_evidence" }),
    );
  });

  it("bounds page text without changing page-relative citation offsets", async () => {
    const { worker, gateway } = setup({
      pageMap: [
        { page: 1, text: "x".repeat(30_000) },
        { page: 2, text: "y".repeat(30_000) },
      ],
      maxInputTokens: 500,
    });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).toHaveBeenCalledWith(
      expect.objectContaining({
        pages: [
          { page: 1, text: "x".repeat(20_000) },
          { page: 2, text: "y".repeat(20_000) },
        ],
        policy: { enabled: true, mode: "local-only", remainingTokens: 500 },
      }),
    );
  });

  it.each([
    ["refusal", "refused"],
    ["malformed_output", "malformed_output"],
    ["budget_exhausted", "budget_exhausted"],
    ["timeout", "timeout"],
    ["invalid_input", "failed"],
  ] as const)("records gateway %s as %s", async (code, failureCode) => {
    const { worker, rpc, gateway } = setup();
    gateway.extractSupplierFields.mockRejectedValue(new AiGatewayError(code));
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_failure_code: failureCode,
        p_suggestions: [],
      }),
    );
  });

  it.each([
    ["timeout", "timeout"],
    ["empty", "no_evidence"],
  ] as const)("records OCR %s as %s", async (ocrFailure, failureCode) => {
    const { worker, rpc, extractor, gateway } = setup({ pageMap: null });
    extractor.extract.mockResolvedValue({
      outcome: "failed",
      failureCode: ocrFailure,
    });
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({ p_failure_code: failureCode }),
    );
  });

  it("does not infer when verified storage is unavailable", async () => {
    const { worker, rpc, storage, gateway } = setup({ pageMap: null });
    storage.openVerified.mockResolvedValue(null);
    await expect(worker.runOnce()).resolves.toBe(1);
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "complete_supplier_document_extraction_atomic",
      expect.objectContaining({ p_failure_code: "no_evidence" }),
    );
  });

  it("leaves an unaccepted completion leased for safe recovery", async () => {
    const { worker, rpc } = setup();
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === "claim_supplier_document_extraction_atomic"
            ? claimed
            : name === "get_supplier_document_extraction_worker_atomic"
              ? context
              : [{ outcome: "invalid_request" }],
        error: null,
      }),
    );
    await expect(worker.runOnce()).rejects.toThrow(
      "completion was not accepted",
    );
  });

  it("accepts a policy revocation enforced by the completion RPC", async () => {
    const { worker, rpc } = setup();
    rpc.mockImplementation((name: string) =>
      Promise.resolve({
        data:
          name === "claim_supplier_document_extraction_atomic"
            ? claimed
            : name === "get_supplier_document_extraction_worker_atomic"
              ? context
              : [{ outcome: "policy_disabled" }],
        error: null,
      }),
    );
    await expect(worker.runOnce()).resolves.toBe(1);
  });

  it("rejects a malformed claim without a provider call", async () => {
    const { worker, rpc, gateway } = setup();
    rpc.mockResolvedValue({ data: [{ id: "bad" }], error: null });
    await expect(worker.runOnce()).rejects.toThrow("claim malformed");
    expect(gateway.extractSupplierFields).not.toHaveBeenCalled();
  });
});
