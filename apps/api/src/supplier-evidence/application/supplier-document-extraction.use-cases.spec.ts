import { SupplierDocumentExtractionUseCases } from "./supplier-document-extraction.use-cases";

describe("SupplierDocumentExtractionUseCases", () => {
  const source = {
    productId: "c91a6a2a-6ef2-4c3a-a647-048592557e2a",
    expectedRequestVersion: 3,
    expectedSubmissionUpdatedAt: "2026-09-23T10:00:00Z",
    expectedEvidenceVersionId: "0eb7306a-3960-4d29-a1a4-fb66c0447de7",
    expectedSha256: "a".repeat(64),
    idempotencyKey: "63c24fe5-c0db-4dde-baf6-cf38a5d8b0b2",
  } as const;
  const scope = {
    organizationId: "org-id",
    actorId: "actor-id",
    requestId: "request-id",
    submissionId: "submission-id",
  } as const;

  it("passes verified scope and all optimistic source pins to the repository", async () => {
    const start = jest
      .fn()
      .mockResolvedValue({ run: null, suggestions: [], pages: [] });
    const useCases = new SupplierDocumentExtractionUseCases({
      start,
      read: jest.fn(),
      decide: jest.fn(),
      manual: jest.fn(),
    });

    await useCases.start(scope.organizationId, {
      actorId: scope.actorId,
      requestId: scope.requestId,
      submissionId: scope.submissionId,
      ...source,
    });

    expect(start).toHaveBeenCalledWith(scope.organizationId, {
      actorId: scope.actorId,
      requestId: scope.requestId,
      submissionId: scope.submissionId,
      ...source,
    });
  });

  it("passes pagination and verified scope through to the read port", async () => {
    const response = {
      run: null,
      suggestions: [],
      pages: [],
      nextCursor: null,
    };
    const read = jest.fn().mockResolvedValue(response);
    const useCases = new SupplierDocumentExtractionUseCases({
      start: jest.fn(),
      read,
      decide: jest.fn(),
      manual: jest.fn(),
    });
    const input = {
      ...scope,
      productId: source.productId,
      limit: 10,
      cursor: "next",
    };

    await expect(useCases.read(scope.organizationId, input)).resolves.toBe(
      response,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(scope.organizationId, input);
  });

  it("passes an explicit decision and its version pin through to the decision port", async () => {
    const response = { field: { id: "field-id" } };
    const decide = jest.fn().mockResolvedValue(response);
    const useCases = new SupplierDocumentExtractionUseCases({
      start: jest.fn(),
      read: jest.fn(),
      decide,
      manual: jest.fn(),
    });
    const input = {
      ...scope,
      ...source,
      fieldId: "field-id",
      expectedFieldVersion: 4,
      decision: "reject" as const,
    };

    await expect(useCases.decide(scope.organizationId, input)).resolves.toBe(
      response,
    );
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith(scope.organizationId, input);
  });

  it("passes manual input through and does not swallow repository errors", async () => {
    const failure = new Error("database unavailable");
    const manual = jest.fn().mockRejectedValue(failure);
    const useCases = new SupplierDocumentExtractionUseCases({
      start: jest.fn(),
      read: jest.fn(),
      decide: jest.fn(),
      manual,
    });
    const input = {
      ...scope,
      ...source,
      fieldKey: "certification_held" as const,
      value: "ISO 9001",
    };

    await expect(useCases.manual(scope.organizationId, input)).rejects.toBe(
      failure,
    );
    expect(manual).toHaveBeenCalledWith(scope.organizationId, input);
  });
});
