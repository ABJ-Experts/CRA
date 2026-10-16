import { Readable } from "node:stream";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { BsiProfileFacts } from "../quality/bsi-profile-facts";
import { SupabaseBsiEvidenceAdapter } from "./supabase-bsi-evidence.adapter";

const orgId = "a1111111-1111-4111-8111-111111111111";
const sourceId = "a2222222-2222-4222-8222-222222222222";
const documentId = "a3333333-3333-4333-8333-333333333333";
const reportId = "a4444444-4444-4444-8444-444444444444";
const workerId = "a5555555-5555-4555-8555-555555555555";
const rawId = "a6666666-6666-4666-8666-666666666666";
const productId = "a7777777-7777-4777-8777-777777777777";
const releaseId = "a8888888-8888-4888-8888-888888888888";
const hash = "a".repeat(64);
const input = { reportId, documentId, sourceId, workerId };
const facts: BsiProfileFacts = {
  format: "cyclonedx",
  serialization: "json",
  specificationVersion: "1.6",
  creatorContacts: [],
  timestamp: null,
  documentUri: null,
  primaryComponentReference: null,
  embeddedVulnerabilityInformation: false,
  externalBomLinks: [],
  components: [],
  limitations: [],
};

function harness() {
  const rows: Record<string, Record<string, unknown>> = {
    sbom_quality_reports: {
      organization_id: orgId,
      id: reportId,
      document_id: documentId,
      source_id: sourceId,
      release_id: releaseId,
      state: "processing",
      lease_owner: workerId,
      lease_expires_at: "2030-01-01T00:00:00Z",
    },
    sbom_documents: {
      organization_id: orgId,
      id: documentId,
      source_id: sourceId,
      raw_object_id: rawId,
      document_sha256: hash,
      state: "completed",
      completed_at: "2026-01-01T00:00:00Z",
      format: "cyclonedx",
      serialization: "json",
      specification_version: "1.6",
    },
    sbom_sources: {
      organization_id: orgId,
      id: sourceId,
      raw_object_id: rawId,
      release_id: releaseId,
      product_id: productId,
      declared_sha256: hash,
      declared_byte_size: 2,
      status: "verified",
      deduplicated_from_source_id: null,
    },
    sbom_document_sources: {
      organization_id: orgId,
      document_id: documentId,
      source_id: sourceId,
      raw_object_id: rawId,
      release_id: releaseId,
    },
    product_releases: {
      organization_id: orgId,
      id: releaseId,
      product_id: productId,
    },
    sbom_raw_objects: {
      organization_id: orgId,
      id: rawId,
      sha256: hash,
      byte_size: 2,
      media_type: "application/json",
      storage_bucket: "sbom-originals",
      storage_key: `${orgId}/${sourceId}/${hash}`,
    },
  };
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const from = jest.fn((table: string) => {
    const record = { table, filters: [] as [string, unknown][] };
    queries.push(record);
    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      gt: jest.fn(),
      maybeSingle: jest.fn(() =>
        Promise.resolve({
          data: (() => {
            let row =
              table === "sbom_sources" &&
              record.filters.some(
                ([key, value]) =>
                  key === "id" && value === rows.canonical_source?.id,
              )
                ? rows.canonical_source
                : rows[table];
            if (
              table === "sbom_document_sources" &&
              record.filters.some(
                ([key, value]) =>
                  key === "source_id" &&
                  value === rows.canonical_association?.source_id,
              )
            )
              row = rows.canonical_association;
            return record.filters.every(([key, value]) => row?.[key] === value)
              ? row
              : null;
          })(),
          error: null,
        }),
      ),
    };
    query.select.mockReturnValue(query);
    query.eq.mockImplementation((key: string, value: unknown) => {
      record.filters.push([key, value]);
      return query;
    });
    query.gt.mockReturnValue(query);
    return query;
  });
  const openVerified = jest.fn().mockImplementation(() =>
    Promise.resolve({
      outcome: "verified",
      stream: Readable.from([Buffer.from("{}")]),
      sha256: hash,
      byteSize: 2,
      contentType: "application/json",
    }),
  );
  const extract = jest.fn().mockImplementation(async (stream: Readable) => {
    for await (const chunk of stream) void chunk;
    return facts;
  });
  const adapter = new SupabaseBsiEvidenceAdapter(
    { admin: () => ({ from }) } as unknown as SupabaseService,
    { openVerified },
    extract,
    () => new Date("2026-01-01T00:00:00Z"),
  );
  return { adapter, rows, queries, openVerified, extract, from };
}

describe("SupabaseBsiEvidenceAdapter", () => {
  it("returns only derived facts after scoped verified EOF and a current lease", async () => {
    const { adapter, queries, openVerified } = harness();
    await expect(adapter.read(orgId, input)).resolves.toEqual({
      facts,
      sourceSha256: hash,
    });
    expect(
      queries.every(
        (query) =>
          query.filters[0]?.[0] === "organization_id" &&
          query.filters[0]?.[1] === orgId,
      ),
    ).toBe(true);
    expect(openVerified).toHaveBeenCalledWith({
      objectKey: `${orgId}/${sourceId}/${hash}`,
      sha256: hash,
      byteSize: 2,
      contentType: "application/json",
    });
    expect(
      queries.filter((query) => query.table === "sbom_quality_reports"),
    ).toHaveLength(2);
  });

  it.each([
    ["sbom_quality_reports", "organization_id", "other-org"],
    ["sbom_quality_reports", "document_id", "other-document"],
    ["sbom_quality_reports", "source_id", "other-source"],
    ["sbom_quality_reports", "lease_owner", "other-worker"],
    ["sbom_quality_reports", "state", "completed"],
    ["sbom_quality_reports", "lease_expires_at", "2025-01-01T00:00:00Z"],
    ["sbom_quality_reports", "lease_expires_at", "invalid"],
    ["sbom_documents", "state", "processing"],
    ["sbom_documents", "completed_at", null],
    ["sbom_documents", "source_id", "substituted-source"],
    ["sbom_documents", "format", "invented"],
    ["sbom_documents", "serialization", "yaml"],
    ["sbom_sources", "status", "reserved"],
    ["sbom_sources", "raw_object_id", "other-raw-object"],
    ["sbom_sources", "declared_sha256", "b".repeat(64)],
    ["sbom_sources", "declared_byte_size", 3],
    ["sbom_sources", "release_id", "other-release"],
    ["sbom_sources", "product_id", "other-product"],
    ["sbom_document_sources", "source_id", "other-source"],
    ["sbom_document_sources", "raw_object_id", "other-raw-object"],
    ["product_releases", "product_id", "other-product"],
    ["sbom_raw_objects", "organization_id", "other-org"],
    ["sbom_raw_objects", "sha256", "b".repeat(64)],
    ["sbom_raw_objects", "byte_size", 3],
    ["sbom_raw_objects", "storage_bucket", "public"],
    ["sbom_raw_objects", "storage_key", `other-org/${sourceId}/${hash}`],
    ["sbom_raw_objects", "storage_key", `${orgId}/${sourceId}/wrong-hash`],
  ])(
    "rejects substituted or unavailable %s.%s before reading bytes",
    async (table, key, value) => {
      const { adapter, rows, openVerified } = harness();
      rows[table]![key] = value;
      await expect(adapter.read(orgId, input)).rejects.toThrow();
      expect(openVerified).not.toHaveBeenCalled();
    },
  );

  it("accepts only an exact verified alias of the immutable canonical document", async () => {
    const { adapter, rows } = harness();
    const canonicalId = "b2222222-2222-4222-8222-222222222222";
    rows.canonical_source = { ...rows.sbom_sources, id: canonicalId };
    rows.canonical_association = {
      ...rows.sbom_document_sources,
      source_id: canonicalId,
    };
    rows.sbom_sources!.deduplicated_from_source_id = canonicalId;
    rows.sbom_documents!.source_id = canonicalId;
    await expect(adapter.read(orgId, input)).resolves.toEqual({
      facts,
      sourceSha256: hash,
    });
    rows.canonical_source.raw_object_id = "other-raw";
    await expect(adapter.read(orgId, input)).rejects.toThrow();
  });

  it("preserves completed-graph replay for a distinct release with an exact immutable association", async () => {
    const { adapter, rows } = harness();
    const originalSourceId = "b2222222-2222-4222-8222-222222222222";
    rows.canonical_source = {
      ...rows.sbom_sources,
      id: originalSourceId,
      product_id: "original-product",
      release_id: "original-release",
    };
    rows.sbom_documents!.source_id = originalSourceId;
    await expect(adapter.read(orgId, input)).resolves.toEqual({
      facts,
      sourceSha256: hash,
    });
  });

  it.each(["missing", "unavailable"])(
    "does not fabricate profile facts when storage is %s",
    async (outcome) => {
      const { adapter, openVerified, extract } = harness();
      openVerified.mockResolvedValueOnce({ outcome });
      await expect(adapter.read(orgId, input)).rejects.toThrow();
      expect(extract).not.toHaveBeenCalled();
    },
  );

  it("does not return facts if the verified stream fails at EOF", async () => {
    const { adapter, openVerified } = harness();
    const stream = Readable.from(
      (function* () {
        yield Buffer.from("{}");
        throw new Error("hash mismatch");
      })(),
    );
    openVerified.mockResolvedValueOnce({
      outcome: "verified",
      stream,
      sha256: hash,
      byteSize: 2,
      contentType: "application/json",
    });
    await expect(adapter.read(orgId, input)).rejects.toThrow("hash mismatch");
    expect(stream.destroyed).toBe(true);
  });

  it("cancels the stream when extraction fails or returns before verified EOF", async () => {
    const { adapter, openVerified, extract } = harness();
    const stream = Readable.from([Buffer.from("{}")]);
    openVerified.mockResolvedValueOnce({
      outcome: "verified",
      stream,
      sha256: hash,
      byteSize: 2,
      contentType: "application/json",
    });
    extract.mockRejectedValueOnce(new Error("component limit exceeded"));
    await expect(adapter.read(orgId, input)).rejects.toThrow(
      "component limit exceeded",
    );
    expect(stream.destroyed).toBe(true);
    const premature = Readable.from([Buffer.from("{}")]);
    openVerified.mockResolvedValueOnce({
      outcome: "verified",
      stream: premature,
      sha256: hash,
      byteSize: 2,
      contentType: "application/json",
    });
    extract.mockResolvedValueOnce(facts);
    await expect(adapter.read(orgId, input)).rejects.toThrow();
    expect(premature.destroyed).toBe(true);
  });

  it("rejects a lease reassigned during extraction instead of returning completed facts", async () => {
    const { adapter, rows, extract } = harness();
    extract.mockImplementationOnce(async (stream: Readable) => {
      for await (const chunk of stream) void chunk;
      rows.sbom_quality_reports!.lease_owner = "new-worker";
      return facts;
    });
    await expect(adapter.read(orgId, input)).rejects.toThrow();
  });

  it("propagates a provider failure without opening storage", async () => {
    const { adapter, from, openVerified } = harness();
    from.mockImplementationOnce(() => {
      throw new Error("provider unavailable");
    });
    await expect(adapter.read(orgId, input)).rejects.toThrow(
      "provider unavailable",
    );
    expect(openVerified).not.toHaveBeenCalled();
  });

  it.each([0, 100 * 1024 * 1024 + 1, 1.5])(
    "rejects retained original size %s before reading bytes",
    async (byteSize) => {
      const { adapter, rows, openVerified } = harness();
      rows.sbom_raw_objects!.byte_size = byteSize;
      rows.sbom_sources!.declared_byte_size = byteSize;
      await expect(adapter.read(orgId, input)).rejects.toThrow();
      expect(openVerified).not.toHaveBeenCalled();
    },
  );

  it("cancels a storage stream with substituted verified metadata", async () => {
    const { adapter, openVerified, extract } = harness();
    const stream = Readable.from([Buffer.from("{}")]);
    openVerified.mockResolvedValueOnce({
      outcome: "verified",
      stream,
      sha256: "b".repeat(64),
      byteSize: 2,
      contentType: "application/json",
    });
    await expect(adapter.read(orgId, input)).rejects.toThrow();
    expect(extract).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });
});
