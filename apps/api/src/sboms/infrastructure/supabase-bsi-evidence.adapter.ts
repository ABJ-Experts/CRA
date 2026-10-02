import { SupabaseService } from "../../supabase/supabase.service";
import type {
  BsiEvidenceReader,
  BsiFactsExtractor,
  BsiOriginalStorage,
} from "../quality/bsi-profile-facts";

/** Worker-only retained-original read. Service role requires explicit tenant scope. */
export class SupabaseBsiEvidenceAdapter implements BsiEvidenceReader {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly storage: BsiOriginalStorage,
    private readonly extract: BsiFactsExtractor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(orgId: string, input: Parameters<BsiEvidenceReader["read"]>[1]) {
    const report = await this.leasedReport(orgId, input);
    const client = this.supabase.admin();
    const { data: document, error: documentError } = await client
      .from("sbom_documents")
      .select(
        "id,source_id,raw_object_id,document_sha256,state,completed_at,format,serialization,specification_version",
      )
      .eq("organization_id", orgId)
      .eq("id", input.documentId)
      .maybeSingle();
    if (
      documentError ||
      !document ||
      document.state !== "completed" ||
      !document.completed_at
    )
      throw unavailable();
    if (
      (document.format !== "cyclonedx" && document.format !== "spdx") ||
      !["json", "json_ld", "xml", "tag_value"].includes(document.serialization)
    )
      throw unavailable();

    const { data: source, error: sourceError } = await client
      .from("sbom_sources")
      .select(
        "id,product_id,release_id,raw_object_id,declared_sha256,declared_byte_size,status,deduplicated_from_source_id",
      )
      .eq("organization_id", orgId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (
      sourceError ||
      !source ||
      source.status !== "verified" ||
      source.release_id !== report.release_id ||
      source.raw_object_id !== document.raw_object_id ||
      source.declared_sha256 !== document.document_sha256
    )
      throw unavailable();

    const canonicalIds = [
      ...new Set([document.source_id, source.deduplicated_from_source_id]),
    ].filter((id): id is string => id !== null && id !== source.id);
    for (const canonicalId of canonicalIds) {
      const { data: canonical, error } = await client
        .from("sbom_sources")
        .select(
          "id,product_id,release_id,raw_object_id,status,deduplicated_from_source_id,declared_sha256,declared_byte_size",
        )
        .eq("organization_id", orgId)
        .eq("id", canonicalId)
        .maybeSingle();
      if (
        error ||
        !canonical ||
        canonical.status !== "verified" ||
        canonical.deduplicated_from_source_id !== null ||
        canonical.raw_object_id !== document.raw_object_id ||
        (canonicalId === source.deduplicated_from_source_id &&
          (canonical.product_id !== source.product_id ||
            canonical.release_id !== source.release_id)) ||
        canonical.declared_sha256 !== source.declared_sha256 ||
        canonical.declared_byte_size !== source.declared_byte_size
      )
        throw unavailable();
      if (canonicalId === source.deduplicated_from_source_id) {
        const { data: linked, error: linkError } = await client
          .from("sbom_document_sources")
          .select("document_id")
          .eq("organization_id", orgId)
          .eq("document_id", input.documentId)
          .eq("source_id", canonicalId)
          .eq("raw_object_id", document.raw_object_id)
          .eq("release_id", canonical.release_id)
          .maybeSingle();
        if (linkError || !linked) throw unavailable();
      }
    }
    const { data: association, error: associationError } = await client
      .from("sbom_document_sources")
      .select("document_id")
      .eq("organization_id", orgId)
      .eq("document_id", input.documentId)
      .eq("source_id", input.sourceId)
      .eq("raw_object_id", document.raw_object_id)
      .eq("release_id", report.release_id)
      .maybeSingle();
    if (associationError || !association) throw unavailable();
    const { data: release, error: releaseError } = await client
      .from("product_releases")
      .select("id")
      .eq("organization_id", orgId)
      .eq("id", source.release_id)
      .eq("product_id", source.product_id)
      .maybeSingle();
    if (releaseError || !release) throw unavailable();
    const { data: raw, error: rawError } = await client
      .from("sbom_raw_objects")
      .select("id,sha256,byte_size,media_type,storage_key,storage_bucket")
      .eq("organization_id", orgId)
      .eq("id", document.raw_object_id)
      .maybeSingle();
    if (
      rawError ||
      !raw ||
      !/^[a-f0-9]{64}$/.test(raw.sha256) ||
      !Number.isSafeInteger(raw.byte_size) ||
      raw.byte_size < 1 ||
      raw.byte_size > 100 * 1024 * 1024 ||
      raw.sha256 !== document.document_sha256 ||
      raw.byte_size !== source.declared_byte_size ||
      raw.storage_bucket !== "sbom-originals" ||
      !raw.storage_key.startsWith(`${orgId}/`) ||
      !raw.storage_key.endsWith(`/${raw.sha256}`)
    )
      throw unavailable();
    const opened = await this.storage.openVerified({
      objectKey: raw.storage_key,
      sha256: raw.sha256,
      byteSize: raw.byte_size,
      contentType: raw.media_type,
    });
    if (opened.outcome !== "verified") throw unavailable();
    try {
      if (
        opened.sha256 !== raw.sha256 ||
        opened.byteSize !== raw.byte_size ||
        opened.contentType !== raw.media_type
      )
        throw unavailable();
      const facts = await this.extract(opened.stream, {
        format: document.format,
        serialization: document.serialization as
          "json" | "json_ld" | "xml" | "tag_value",
        specificationVersion: document.specification_version,
      });
      // A derived assessment is publishable only after the storage guard has
      // verified the complete byte count and digest, including the final chunk.
      if (!opened.stream.readableEnded || opened.stream.errored)
        throw unavailable();
      await this.leasedReport(orgId, input);
      return Object.freeze({ facts, sourceSha256: raw.sha256 });
    } finally {
      if (!opened.stream.readableEnded) opened.stream.destroy();
    }
  }

  private async leasedReport(
    orgId: string,
    input: Parameters<BsiEvidenceReader["read"]>[1],
  ) {
    const now = this.now();
    const { data: report, error } = await this.supabase
      .admin()
      .from("sbom_quality_reports")
      .select("release_id,lease_expires_at")
      .eq("organization_id", orgId)
      .eq("id", input.reportId)
      .eq("document_id", input.documentId)
      .eq("source_id", input.sourceId)
      .eq("state", "processing")
      .eq("lease_owner", input.workerId)
      .gt("lease_expires_at", now.toISOString())
      .maybeSingle();
    if (
      error ||
      !report ||
      !report.lease_expires_at ||
      !Number.isFinite(Date.parse(report.lease_expires_at)) ||
      Date.parse(report.lease_expires_at) <= now.getTime()
    )
      throw unavailable();
    return report;
  }
}

function unavailable(): Error {
  return new Error(
    "Retained SBOM profile evidence is unavailable for this worker scope.",
  );
}
