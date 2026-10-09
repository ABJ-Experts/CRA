import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { sbomComponentHashSchema } from "@repo/contracts/sboms";
import { SupabaseService } from "../../supabase/supabase.service";
import { vulnerabilityVexExportScopeProjectionSchema } from "../../findings/exports/infrastructure/supabase-vulnerability-vex-export.repository";
import type { SbomExportRepository } from "../application/sbom-export-use-cases";
import { SbomExportConflict } from "../application/sbom-export-serializer";
import { SupabaseSbomRepository } from "./supabase-sbom.repository";

const componentSchema = z
  .object({
    id: z.uuid(),
    normalized_name: z.string().min(1),
    normalized_version: z.string().nullable(),
    canonical_purl: z.string().nullable(),
    cpe: z.string().nullable(),
    supplier: z.string().nullable(),
    license_expression: z.string().nullable(),
    hashes: z.array(sbomComponentHashSchema).max(100),
  })
  .strict();
const dependencySchema = z
  .object({
    id: z.uuid(),
    parent_component_id: z.uuid().nullable(),
    child_component_id: z.uuid().nullable(),
    edge_state: z.string(),
  })
  .strict();
const sourceSchema = z
  .object({
    id: z.uuid(),
    product_id: z.uuid(),
    release_id: z.uuid(),
    status: z.literal("verified"),
  })
  .strict();

/** Existing immutable graph and M5 review projection; every service-role read is organization scoped. */
@Injectable()
export class SupabaseSbomExportRepository implements SbomExportRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly normalization: SupabaseSbomRepository,
  ) {}
  async graph(
    orgId: string,
    input: Parameters<SbomExportRepository["graph"]>[1],
  ) {
    const detail = await this.normalization.getDocument(orgId, {
      actorId: input.actorId,
      documentId: input.documentId,
    });
    if (!detail) return null;
    if (detail.document.state !== "completed")
      throw new SbomExportConflict(
        "Wait for normalization to complete before export.",
      );
    const mapping = await this.supabase
      .admin()
      .from("sbom_document_sources")
      .select("source_id")
      .eq("organization_id", orgId)
      .eq("document_id", input.documentId)
      .eq("source_id", input.sourceId)
      .maybeSingle();
    if (mapping.error) throw new Error("SBOM scope read failed");
    if (!mapping.data) return null;
    const source = await this.supabase
      .admin()
      .from("sbom_sources")
      .select("id,product_id,release_id,status")
      .eq("organization_id", orgId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (source.error) throw new Error("SBOM source read failed");
    if (!source.data) return null;
    const scoped = sourceSchema.parse(source.data);
    const components: z.output<typeof componentSchema>[] = [];
    let cursor: string | undefined;
    do {
      let query = this.supabase
        .admin()
        .from("sbom_components")
        .select(
          "id,normalized_name,normalized_version,canonical_purl,cpe,supplier,license_expression,hashes",
        )
        .eq("organization_id", orgId)
        .eq("document_id", input.documentId)
        .order("id")
        .limit(1000);
      if (cursor) query = query.gt("id", cursor);
      const page = await query;
      if (page.error) throw new Error("SBOM component read failed");
      const rows = z.array(componentSchema).max(1000).parse(page.data);
      components.push(...rows);
      if (components.length > 50_000)
        throw new SbomExportConflict("The export component ceiling is 50,000.");
      cursor = rows.length === 1000 ? rows.at(-1)?.id : undefined;
    } while (cursor);
    const edges: z.output<typeof dependencySchema>[] = [];
    cursor = undefined;
    do {
      let query = this.supabase
        .admin()
        .from("sbom_component_dependencies")
        .select("id,parent_component_id,child_component_id,edge_state")
        .eq("organization_id", orgId)
        .eq("document_id", input.documentId)
        .order("id")
        .limit(1000);
      if (cursor) query = query.gt("id", cursor);
      const page = await query;
      if (page.error) throw new Error("SBOM dependency read failed");
      const rows = z.array(dependencySchema).max(1000).parse(page.data);
      edges.push(...rows);
      if (edges.length > 250_000)
        throw new SbomExportConflict(
          "The export dependency ceiling is 250,000.",
        );
      cursor = rows.length === 1000 ? rows.at(-1)?.id : undefined;
    } while (cursor);
    if (
      components.length !== detail.document.componentCount ||
      edges.length !== detail.document.dependencyCount
    )
      throw new SbomExportConflict(
        "The exact normalized graph changed during export; retry the read.",
      );
    if (
      edges.some(
        (edge) =>
          edge.edge_state !== "retained" ||
          !edge.parent_component_id ||
          !edge.child_component_id,
      )
    )
      throw new SbomExportConflict(
        "Unresolved dependencies cannot be silently omitted from export.",
      );
    if (
      !(await this.normalization.getDocument(orgId, {
        actorId: input.actorId,
        documentId: input.documentId,
      }))
    )
      return null;
    return {
      documentId: input.documentId,
      sourceId: input.sourceId,
      productId: scoped.product_id,
      releaseId: scoped.release_id,
      createdAt: detail.document.createdAt,
      components: components.map((component) => ({
        id: component.id,
        name: component.normalized_name,
        version: component.normalized_version,
        purl: component.canonical_purl,
        cpe: component.cpe,
        supplier: component.supplier,
        license: component.license_expression,
        hashes: component.hashes,
      })),
      dependencies: edges.map((edge) => ({
        parentId: z.uuid().parse(edge.parent_component_id),
        childId: z.uuid().parse(edge.child_component_id),
      })),
    };
  }
  async reviewedVex(
    orgId: string,
    input: Parameters<SbomExportRepository["reviewedVex"]>[1],
  ) {
    const result = await this.supabase
      .admin()
      .rpc("preview_vulnerability_vex_export_scope", {
        p_organization_id: orgId,
        p_actor_user_id: input.actorId,
        p_product_id: input.productId,
        p_release_id: input.releaseId,
        p_export_format: "cyclonedx-vex",
      });
    if (result.error) throw new Error("Reviewed VEX read failed");
    const rows = z
      .array(z.object({ outcome: z.string(), result: z.unknown() }).strict())
      .length(1)
      .parse(result.data);
    const row = rows[0]!;
    if (row.outcome === "not_found" || row.outcome === "forbidden") return null;
    if (row.outcome !== "found" && row.outcome !== "no_eligible_assessments")
      throw new SbomExportConflict(
        "Reviewed VEX cannot be represented for this release.",
      );
    const { scope } = vulnerabilityVexExportScopeProjectionSchema.parse(
      row.result,
    );
    if (
      scope.organizationId !== orgId ||
      scope.product.id !== input.productId ||
      scope.release.id !== input.releaseId
    )
      throw new Error("Invalid VEX scope projection");
    return scope.assessments.map((assessment) => ({
      findingId: assessment.findingId,
      assessmentId: assessment.assessmentId,
      revision: assessment.revision,
      advisoryId: assessment.advisoryId,
      canonicalPurl: assessment.canonicalPurl,
      componentVersion: assessment.componentVersion,
      status: assessment.status,
      justification: assessment.justification,
      approvalState: assessment.approvalState,
      effectiveAt: assessment.decidedAt ?? assessment.submittedAt,
      provenanceReference: `${assessment.assessmentId}:${assessment.revision}`,
    }));
  }
}
