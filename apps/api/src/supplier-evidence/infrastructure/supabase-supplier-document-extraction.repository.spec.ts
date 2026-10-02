import { SupabaseService } from "../../supabase/supabase.service";
import {
  SupplierEvidenceConflictError,
  SupplierEvidenceForbiddenError,
  SupplierEvidenceInvalidRequestError,
  SupplierEvidenceUnavailableError,
} from "../application/supplier-evidence-use-cases";
import { SupabaseSupplierDocumentExtractionRepository } from "./supabase-supplier-document-extraction.repository";

const orgId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const submissionId = "55555555-5555-4555-8555-555555555555";
const versionId = "66666666-6666-4666-8666-666666666666";
const fieldId = "77777777-7777-4777-8777-777777777777";
const key = "88888888-8888-4888-8888-888888888888";
const sha = "a".repeat(64);

const pins = {
  actorId,
  productId,
  requestId,
  submissionId,
  expectedRequestVersion: 2,
  expectedSubmissionUpdatedAt: "2026-09-23T10:00:00Z",
  expectedEvidenceVersionId: versionId,
  expectedSha256: sha,
  idempotencyKey: key,
};
const run = {
  id: key,
  submissionId,
  evidenceVersionId: versionId,
  evidenceSha256: sha,
  status: "pending",
  model: "local-ollama",
  promptVersion: "m9-05-v1",
  createdAt: "2026-09-23T10:01:00Z",
  completedAt: null,
  errorCode: null,
};
const manualField = {
  id: fieldId,
  fieldKey: "certification_held",
  origin: "manual",
  runId: null,
  evidenceVersionId: versionId,
  evidenceSha256: sha,
  model: null,
  promptVersion: null,
  candidateGroup: null,
  originalValue: null,
  correctedValue: "ISO 9001",
  confidence: null,
  sourceSpan: null,
  status: "confirmed",
  version: 1,
  reviewedByUserId: actorId,
  reviewedAt: "2026-09-23T10:02:00Z",
  createdAt: "2026-09-23T10:02:00Z",
};

describe("SupabaseSupplierDocumentExtractionRepository", () => {
  const rpc = jest.fn();
  const repository = new SupabaseSupplierDocumentExtractionRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);

  beforeEach(() => rpc.mockReset());

  it("scopes reads to verified actor, organization, product and submission", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { run: null, suggestions: [], pages: [], nextCursor: null },
        },
      ],
      error: null,
    });
    await expect(
      repository.read(orgId, {
        actorId,
        productId,
        requestId,
        submissionId,
        limit: 25,
      }),
    ).resolves.toEqual({
      run: null,
      suggestions: [],
      pages: [],
      nextCursor: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_supplier_document_extraction_atomic",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_submission_id: submissionId,
        p_cursor: null,
        p_limit: 25,
      },
    );
  });

  it("passes a supplied cursor and bounded page size to the read RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { run: null, suggestions: [], pages: [], nextCursor: "next" },
        },
      ],
      error: null,
    });
    await expect(
      repository.read(orgId, {
        actorId,
        productId,
        requestId,
        submissionId,
        limit: 5,
        cursor: "prior",
      }),
    ).resolves.toMatchObject({ nextCursor: "next" });
    expect(rpc).toHaveBeenCalledWith(
      "get_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_cursor: "prior",
        p_limit: 5,
      }),
    );
  });

  it("maps a conflicting decision to a retryable conflict", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "conflict", result: null }],
      error: null,
    });
    await expect(
      repository.decide(orgId, {
        ...pins,
        fieldId,
        expectedFieldVersion: 0,
        decision: "confirm",
        correctedValue: "ISO 9001",
      }),
    ).rejects.toBeInstanceOf(SupplierEvidenceConflictError);
    expect(rpc).toHaveBeenCalledWith(
      "decide_supplier_document_field_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_decision: "confirmed",
        p_corrected_value: "ISO 9001",
        p_expected_version: 0,
        p_idempotency_key: key,
      }),
    );
  });

  it("rejects a low-confidence confirmation from the database boundary", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "low_confidence", result: null }],
      error: null,
    });
    await expect(
      repository.decide(orgId, {
        ...pins,
        fieldId,
        expectedFieldVersion: 0,
        decision: "confirm",
        correctedValue: "ISO 9001",
      }),
    ).rejects.toBeInstanceOf(SupplierEvidenceConflictError);
  });

  it("rejects malformed successful RPC output", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: {
            run: null,
            suggestions: [{ bad: true }],
            pages: [],
            nextCursor: null,
          },
        },
      ],
      error: null,
    });
    await expect(
      repository.read(orgId, {
        actorId,
        productId,
        requestId,
        submissionId,
        limit: 25,
      }),
    ).rejects.toThrow();
  });

  it("preserves the exact idempotent run on start even if a newer run appears", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ outcome: "replayed", result: run }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: {
              run: { ...run, id: fieldId },
              suggestions: [],
              pages: [],
              nextCursor: null,
            },
          },
        ],
        error: null,
      });
    const response = await repository.start(orgId, pins);
    expect(response.run?.id).toBe(key);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "start_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_expected_evidence_version_id: versionId,
        p_expected_sha256: sha,
        p_idempotency_key: key,
      }),
    );
  });

  it("returns a newly queued run with a parsed snapshot", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ outcome: "queued", result: run }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: { run: null, suggestions: [], pages: [], nextCursor: null },
          },
        ],
        error: null,
      });
    await expect(repository.start(orgId, pins)).resolves.toEqual({
      run,
      suggestions: [],
      pages: [],
      nextCursor: null,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_supplier_document_extraction_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_limit: 25,
      }),
    );
  });

  it("rejects an invalid run returned by a successful start RPC", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ outcome: "queued", result: { id: key } }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: { run: null, suggestions: [], pages: [], nextCursor: null },
          },
        ],
        error: null,
      });
    await expect(repository.start(orgId, pins)).rejects.toThrow();
  });

  it("maps rejection to a null corrected value and parses the decided field", async () => {
    const rejected = {
      ...manualField,
      origin: "ai",
      runId: key,
      model: "local-ollama",
      promptVersion: "m9-05-v1",
      candidateGroup: "certificate-1",
      originalValue: "ISO 9001",
      correctedValue: null,
      confidence: 0.9,
      sourceSpan: { page: 1, startOffset: 0, endOffset: 8, quote: "ISO 9001" },
      status: "rejected",
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "rejected", result: { field: rejected } }],
      error: null,
    });
    await expect(
      repository.decide(orgId, {
        ...pins,
        fieldId,
        expectedFieldVersion: 1,
        decision: "reject",
      }),
    ).resolves.toEqual({ field: rejected });
    expect(rpc).toHaveBeenCalledWith(
      "decide_supplier_document_field_atomic",
      expect.objectContaining({
        p_decision: "rejected",
        p_corrected_value: null,
        p_expected_version: 1,
      }),
    );
  });

  it("accepts an idempotently replayed field decision", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", result: { field: manualField } }],
      error: null,
    });
    await expect(
      repository.decide(orgId, {
        ...pins,
        fieldId,
        expectedFieldVersion: 1,
        decision: "confirm",
        correctedValue: "ISO 9001",
      }),
    ).resolves.toEqual({ field: manualField });
  });

  it("creates manual fields without requiring inference", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "confirmed", result: { field: manualField } }],
      error: null,
    });
    await expect(
      repository.manual(orgId, {
        ...pins,
        fieldKey: "certification_held",
        value: "ISO 9001",
      }),
    ).resolves.toEqual({ field: manualField });
    expect(rpc).toHaveBeenCalledWith(
      "add_supplier_document_field_atomic",
      expect.objectContaining({
        p_organization_id: orgId,
        p_field_key: "certification_held",
        p_value: "ISO 9001",
      }),
    );
  });

  it("accepts an idempotently replayed manual field", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", result: { field: manualField } }],
      error: null,
    });
    await expect(
      repository.manual(orgId, {
        ...pins,
        fieldKey: "certification_held",
        value: "ISO 9001",
      }),
    ).resolves.toEqual({ field: manualField });
  });

  it.each([
    ["forbidden", SupplierEvidenceForbiddenError],
    ["invalid_request", SupplierEvidenceInvalidRequestError],
    ["conflict", SupplierEvidenceConflictError],
    ["idempotency_conflict", SupplierEvidenceConflictError],
    ["stale_source", SupplierEvidenceConflictError],
    ["not_found", SupplierEvidenceConflictError],
    ["low_confidence", SupplierEvidenceConflictError],
    ["budget_exhausted", SupplierEvidenceUnavailableError],
    ["unavailable", SupplierEvidenceUnavailableError],
  ])(
    "maps %s RPC outcomes to the expected public error",
    async (outcome, errorType) => {
      rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
      await expect(
        repository.read(orgId, {
          actorId,
          productId,
          requestId,
          submissionId,
          limit: 25,
        }),
      ).rejects.toBeInstanceOf(errorType);
    },
  );

  it.each([null, {}, [], [null], [{ outcome: "unexpected" }]])(
    "fails closed on absent or unknown RPC rows (%p)",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        repository.read(orgId, {
          actorId,
          productId,
          requestId,
          submissionId,
          limit: 25,
        }),
      ).rejects.toBeInstanceOf(SupplierEvidenceUnavailableError);
    },
  );

  it.each([
    ["start", () => repository.start(orgId, pins)],
    [
      "decide",
      () =>
        repository.decide(orgId, {
          ...pins,
          fieldId,
          expectedFieldVersion: 0,
          decision: "confirm",
          correctedValue: "ISO 9001",
        }),
    ],
    [
      "manual",
      () =>
        repository.manual(orgId, {
          ...pins,
          fieldKey: "certification_held",
          value: "ISO 9001",
        }),
    ],
  ])("fails closed on unknown %s RPC outcome", async (_name, action) => {
    rpc.mockResolvedValue({
      data: [{ outcome: "unexpected", result: null }],
      error: null,
    });
    await expect(action()).rejects.toBeInstanceOf(
      SupplierEvidenceUnavailableError,
    );
  });

  it("rejects malformed successful field decision and manual responses", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "confirmed", result: { field: { id: fieldId } } }],
      error: null,
    });
    await expect(
      repository.decide(orgId, {
        ...pins,
        fieldId,
        expectedFieldVersion: 0,
        decision: "confirm",
        correctedValue: "ISO 9001",
      }),
    ).rejects.toThrow();
    await expect(
      repository.manual(orgId, {
        ...pins,
        fieldKey: "certification_held",
        value: "ISO 9001",
      }),
    ).rejects.toThrow();
  });

  it("fails closed on an RPC transport error", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    await expect(
      repository.read(orgId, {
        actorId,
        productId,
        requestId,
        submissionId,
        limit: 25,
      }),
    ).rejects.toThrow("Supplier document extraction unavailable.");
  });
});
