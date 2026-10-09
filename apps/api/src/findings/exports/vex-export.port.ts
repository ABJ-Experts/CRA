import type {
  GeneratedVexExport,
  VexAssessmentExportRecord,
} from "./vex-export-generator";

/** Trusted, tenant-scoped projection; private assessment text is excluded. */
export type VexExportScopeProjection = Readonly<{
  organizationId: string;
  productId: string;
  releaseId: string;
  productName: string;
  releaseLabel: string;
  /** Ordered effective-assessment digest returned by the locked scope RPC. */
  scopeDigest: string;
  scopeVersion: number;
  assessments: readonly VexAssessmentExportRecord[];
}>;

/**
 * The repository must lock and materialize this projection before generation;
 * the generator has no authority to query across tenants.
 */
export interface VexExportScopePort {
  effectiveScope(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; releaseId: string }>,
  ): Promise<VexExportScopeProjection | null>;
}

/** Immutable private object storage boundary for the exact validated bytes. */
export interface VexExportStoragePort {
  putImmutable(
    input: Readonly<{
      organizationId: string;
      exportId: string;
      objectKey: string;
      bytes: Buffer;
      contentType: GeneratedVexExport["mediaType"];
      sha256: string;
    }>,
  ): Promise<Readonly<{ objectKey: string; byteSize: number }>>;
  readImmutable(
    input: Readonly<{ organizationId: string; objectKey: string }>,
  ): Promise<Buffer | null>;
}
