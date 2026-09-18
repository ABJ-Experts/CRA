import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  productImportFieldIssueSchema,
  productImportReportLinkResponseSchema,
  productImportReportLinkTtlSeconds,
  productImportSchema,
  productImportsResponseSchema,
  productImportRowsResponseSchema,
  type ProductImport,
  type ProductImportListQuery,
  type ProductImportRow,
  type ProductImportRowsQuery,
  type ProductType,
} from "@repo/contracts/products";
import { isBaseRole, type BaseRole } from "@repo/contracts/permissions";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  countRows,
  importObjectPath,
  type ImportDirectory,
  type ImportPage,
  type ImportProductSnapshot,
  type ImportReleaseSnapshot,
  type ImportRepositoryOutcome,
  type ProductImportClaim,
  type ProductImportRepository,
} from "./product-release-import-use-cases";
import {
  normalizeIdentity,
  sha256Hex,
  type PlannedImportRow,
} from "./product-release-import-format";

const bucket = "product-imports";
const directoryPageSize = 1_000;
const persistencePageSize = 500;
const workerLeaseSeconds = 60;

type ProviderError = Readonly<{ message: string }>;
type ProviderResult = Readonly<{
  data: unknown;
  error: ProviderError | null;
  count?: number | null;
}>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    argumentsValue: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}>;

const rpcRowSchema = z.record(z.string(), z.unknown());
const workSchema = z
  .object({
    kind: z.enum(["dry_run", "commit"]),
    sourceObjectPath: z.string().min(1),
    reportObjectPath: z.string().nullable(),
    checkpointRowNumber: z.number().int().nonnegative(),
    commitActorId: z.uuid().nullable(),
    commitIdempotencyKey: z.uuid().nullable(),
    retryCount: z.number().int().nonnegative().optional(),
  })
  .strict();

@Injectable()
export class SupabaseProductImportRepository implements ProductImportRepository {
  private readonly logger = new Logger(SupabaseProductImportRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async begin(
    organizationId: string,
    input: Parameters<ProductImportRepository["begin"]>[1],
  ): Promise<ImportRepositoryOutcome> {
    const paths = importObjectPath(organizationId);
    await this.upload(paths.source, input.bytes, false);
    const row = await this.one("create_product_import_job", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_import_id: paths.importId,
      p_upload_idempotency_key: input.fields.idempotencyKey,
      p_content_hash: input.contentHash,
      p_original_filename: input.originalFilename,
      p_byte_size: input.byteSize,
      p_source_object_path: paths.source,
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "created",
        "replayed",
        "idempotency_mismatch",
        "invalid_request",
        "conflict",
      ]),
    );
    if (outcome !== "created") {
      await this.remove(paths.source);
    }
    if (outcome === "created" || outcome === "replayed") {
      return Object.freeze({
        outcome,
        import: this.job(row.job),
      });
    }
    return Object.freeze({
      outcome: outcome as
        "conflict" | "not_found" | "idempotency_mismatch" | "invalid_request",
    });
  }

  async source(organizationId: string, importId: string) {
    const path = importObjectPath(organizationId, importId).source;
    const { data, error } = await this.supabase
      .admin()
      .storage.from(bucket)
      .download(path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    return Object.freeze({ bytes, contentHash: sha256Hex(bytes) });
  }

  async loadDirectory(organizationId: string): Promise<ImportDirectory> {
    const [owners, legalEntities, products, releases] = await Promise.all([
      this.loadOwners(organizationId),
      this.loadLegalEntities(organizationId),
      this.loadProducts(organizationId),
      this.loadReleases(organizationId),
    ]);
    return Object.freeze({
      ownersByEmail: owners,
      legalEntitiesByIdentifier: legalEntities,
      productsByCode: new Map(
        products.map((product) => [product.internalCodeNormalized, product]),
      ),
      releasesByProductAndVersion: new Map(
        releases.map((release) => [
          `${release.productInternalCodeNormalized}\u0000${release.releaseVersionNormalized}`,
          release,
        ]),
      ),
    });
  }

  async completeDryRun(
    organizationId: string,
    input: Parameters<ProductImportRepository["completeDryRun"]>[1],
  ): Promise<ImportRepositoryOutcome> {
    const reportPath = importObjectPath(organizationId, input.importId).report;
    await this.upload(reportPath, Buffer.from(input.reportCsv, "utf8"), true);
    for (
      let index = 0;
      index < input.rows.length;
      index += persistencePageSize
    ) {
      const page = input.rows.slice(index, index + persistencePageSize);
      const saved = await this.one("save_product_import_rows_page", {
        p_organization_id: organizationId,
        p_import_id: input.importId,
        p_worker_id: input.workerId,
        p_content_hash: input.contentHash,
        p_rows: page.map((row) => this.persistedRow(input.contentHash, row)),
      });
      if (
        this.outcome(
          saved,
          new Set([
            "saved",
            "content_mismatch",
            "not_found",
            "invalid_request",
          ]),
        ) !== "saved"
      ) {
        throw new ProductImportProviderError("malformed_provider");
      }
      const checkpoint = await this.one("checkpoint_product_import_job", {
        p_organization_id: organizationId,
        p_import_id: input.importId,
        p_worker_id: input.workerId,
        p_status: "validating",
        p_processed_row_count: index + page.length,
        p_checkpoint_row_number: Math.max(
          ...page.map((row) => row.sourceRowNumber),
        ),
        p_lease_seconds: workerLeaseSeconds,
      });
      if (
        this.outcome(
          checkpoint,
          new Set(["checkpointed", "not_found", "invalid_request"]),
        ) !== "checkpointed"
      ) {
        throw new ProductImportProviderError("malformed_provider");
      }
    }
    const counts = countRows(input.rows);
    const completed = await this.one("complete_product_import_dry_run", {
      p_organization_id: organizationId,
      p_import_id: input.importId,
      p_worker_id: input.workerId,
      p_content_hash: input.contentHash,
      p_row_count: input.parsedRowCount,
      p_create_count: counts.create,
      p_update_count: counts.update,
      p_unchanged_count: counts.unchanged,
      p_skipped_count: counts.skipped,
      p_failed_count: counts.failed,
      p_warning_count: counts.warnings,
      p_report_object_path: reportPath,
      p_error_code: counts.failed > 0 ? "validation_failed" : null,
    });
    const outcome = this.outcome(
      completed,
      new Set([
        "dry_run_completed",
        "dry_run_failed",
        "checkpoint_mismatch",
        "not_found",
        "invalid_request",
      ]),
    );
    if (outcome === "dry_run_completed" || outcome === "dry_run_failed") {
      return Object.freeze({ outcome, import: this.job(completed.job) });
    }
    return Object.freeze({
      outcome: outcome === "not_found" ? "not_found" : "invalid_request",
    });
  }

  async list(
    organizationId: string,
    actorId: string,
    query: ProductImportListQuery,
  ): Promise<ImportPage<ProductImport>> {
    const row = await this.one("list_product_import_jobs", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_status: query.status ?? null,
      p_page: query.page,
      p_page_size: query.pageSize,
    });
    if (
      this.outcome(row, new Set(["found", "not_found", "invalid_request"])) !==
      "found"
    ) {
      throw new ProductImportProviderError("malformed_provider");
    }
    return productImportsResponseSchema.parse({ imports: row.imports }).imports;
  }

  async get(organizationId: string, actorId: string, importId: string) {
    const row = await this.one("get_product_import_job", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_import_id: importId,
    });
    const outcome = this.outcome(row, new Set(["found", "not_found"]));
    return outcome === "found" ? this.job(row.job) : null;
  }

  async listRows(
    organizationId: string,
    actorId: string,
    importId: string,
    query: ProductImportRowsQuery,
  ): Promise<ImportPage<ProductImportRow> | null> {
    const row = await this.one("list_product_import_rows", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_import_id: importId,
      p_result: query.result ?? null,
      p_page: query.page,
      p_page_size: query.pageSize,
    });
    const outcome = this.outcome(
      row,
      new Set(["found", "not_found", "invalid_request"]),
    );
    if (outcome === "not_found") return null;
    if (outcome !== "found")
      throw new ProductImportProviderError("malformed_provider");
    return productImportRowsResponseSchema.parse({ rows: row.rows }).rows;
  }

  async report(orgId: string, actorId: string, importId: string) {
    const recorded = await this.one("record_product_import_report_download", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_import_id: importId,
      p_correlation_id: randomUUID(),
    });
    if (this.outcome(recorded, new Set(["found", "not_found"])) !== "found") {
      return null;
    }
    const expectedPath = importObjectPath(orgId, importId).report;
    if (recorded.object_path !== expectedPath) {
      throw new ProductImportProviderError("malformed_provider");
    }
    const signed = await this.supabase
      .admin()
      .storage.from(bucket)
      .createSignedUrl(expectedPath, productImportReportLinkTtlSeconds, {
        download: "product-release-import-report.csv",
      });
    if (signed.error || !signed.data?.signedUrl) {
      throw new ProductImportProviderError("provider_unavailable");
    }
    return productImportReportLinkResponseSchema.parse({
      report: {
        filename: "product-release-import-report.csv",
        contentType: "text/csv; charset=utf-8",
        downloadUrl: signed.data.signedUrl,
        expiresAt: new Date(
          Date.now() + productImportReportLinkTtlSeconds * 1_000,
        ).toISOString(),
      },
    });
  }

  async commit(
    organizationId: string,
    input: Parameters<ProductImportRepository["commit"]>[1],
  ): Promise<ImportRepositoryOutcome> {
    return this.jobOutcome(
      await this.one("request_product_import_commit", {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_import_id: input.importId,
        p_content_hash: input.command.contentHash,
        p_idempotency_key: input.command.idempotencyKey,
      }),
      new Set([
        "queued",
        "replayed",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_request",
      ]),
    );
  }

  async executeCommit(
    organizationId: string,
    input: Parameters<ProductImportRepository["executeCommit"]>[1],
  ): Promise<ImportRepositoryOutcome> {
    return this.jobOutcome(
      await this.one("commit_product_import_atomic", {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_import_id: input.importId,
        p_content_hash: input.contentHash,
        p_idempotency_key: input.idempotencyKey,
      }),
      new Set([
        "completed",
        "replayed",
        "retrying",
        "dead_letter",
        "stale_conflict",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_request",
      ]),
    );
  }

  async cancel(
    organizationId: string,
    input: Parameters<ProductImportRepository["cancel"]>[1],
  ): Promise<ImportRepositoryOutcome> {
    return this.jobOutcome(
      await this.one("cancel_product_import_job", {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_import_id: input.importId,
        p_reason: input.reason,
      }),
      new Set(["canceled", "not_found", "conflict", "invalid_request"]),
    );
  }

  async dueOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.many("list_due_product_import_organizations", {
      p_limit: 500,
    });
    return Object.freeze(
      rows.map((row) => z.uuid().parse(row.organization_id)),
    );
  }

  async claim(
    organizationId: string,
    input: Parameters<ProductImportRepository["claim"]>[1],
  ): Promise<ProductImportClaim> {
    return this.claimFrom(
      organizationId,
      await this.one("claim_product_import_job", {
        p_organization_id: organizationId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      }),
    );
  }

  async claimById(
    organizationId: string,
    input: Parameters<ProductImportRepository["claimById"]>[1],
  ): Promise<ProductImportClaim> {
    return this.claimFrom(
      organizationId,
      await this.one("claim_product_import_job_by_id", {
        p_organization_id: organizationId,
        p_import_id: input.importId,
        p_worker_id: input.workerId,
        p_lease_seconds: input.leaseSeconds,
      }),
    );
  }

  async failClaim(
    organizationId: string,
    input: Parameters<ProductImportRepository["failClaim"]>[1],
  ): Promise<void> {
    const row = await this.one("fail_product_import_job", {
      p_organization_id: organizationId,
      p_import_id: input.importId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_retryable: input.retryable,
    });
    this.outcome(
      row,
      new Set(["retrying", "dead_letter", "not_found", "invalid_request"]),
    );
  }

  async markStaleClaim(
    organizationId: string,
    input: Parameters<ProductImportRepository["markStaleClaim"]>[1],
  ): Promise<void> {
    const row = await this.one("mark_product_import_stale_conflict", {
      p_organization_id: organizationId,
      p_import_id: input.importId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
    });
    this.outcome(
      row,
      new Set(["stale_conflict", "not_found", "invalid_request"]),
    );
  }

  async actorBaseRole(
    orgId: string,
    actorId: string,
  ): Promise<BaseRole | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (error) throw new ProductImportProviderError("provider_unavailable");
    return data && isBaseRole(data.role) ? data.role : null;
  }

  private async loadOwners(organizationId: string) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += directoryPageSize) {
      const { data, error } = await this.supabase
        .admin()
        .from("organization_members")
        .select("users!inner(id,email,is_active)")
        .eq("organization_id", organizationId)
        .range(offset, offset + directoryPageSize - 1);
      if (error) throw new ProductImportProviderError("provider_unavailable");
      rows.push(...(data ?? []));
      if ((data ?? []).length < directoryPageSize) break;
    }
    return new Map(
      rows
        .map(
          (row) =>
            row as { users: { id: string; email: string; is_active: boolean } },
        )
        .filter((row) => row.users.is_active)
        .map((row) => [
          row.users.email.normalize("NFKC").trim().toLowerCase(),
          row.users.id,
        ]),
    );
  }

  private async loadLegalEntities(organizationId: string) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += directoryPageSize) {
      const { data, error } = await this.supabase
        .admin()
        .from("organization_legal_entities")
        .select("id,identifier,status,completion_status")
        .eq("organization_id", organizationId)
        .range(offset, offset + directoryPageSize - 1);
      if (error) throw new ProductImportProviderError("provider_unavailable");
      rows.push(...(data ?? []));
      if ((data ?? []).length < directoryPageSize) break;
    }
    return new Map(
      rows
        .map(
          (row) =>
            row as {
              id: string;
              identifier: string;
              status: string;
              completion_status: string;
            },
        )
        .filter(
          (row) =>
            row.status === "active" && row.completion_status === "complete",
        )
        .map((row) => [normalizeIdentity(row.identifier), row.id]),
    );
  }

  private async loadProducts(
    organizationId: string,
  ): Promise<readonly ImportProductSnapshot[]> {
    const rows: ImportProductSnapshot[] = [];
    for (let offset = 0; ; offset += directoryPageSize) {
      const { data, error } = await this.supabase
        .admin()
        .from("products")
        .select(
          "id,internal_code,internal_code_normalized,name,product_type,description,responsible_owner_id,legal_entity_id,archived_at,version",
        )
        .eq("organization_id", organizationId)
        .range(offset, offset + directoryPageSize - 1);
      if (error) throw new ProductImportProviderError("provider_unavailable");
      for (const value of data ?? []) {
        rows.push(
          Object.freeze({
            id: value.id,
            internalCodeNormalized:
              value.internal_code_normalized ??
              normalizeIdentity(value.internal_code),
            name: value.name,
            internalCode: value.internal_code,
            productType: value.product_type as ProductType,
            description: value.description,
            responsibleOwnerId: value.responsible_owner_id,
            legalEntityId: value.legal_entity_id,
            archivedAt: value.archived_at,
            version: value.version,
          }),
        );
      }
      if ((data ?? []).length < directoryPageSize) break;
    }
    return Object.freeze(rows);
  }

  private async loadReleases(
    organizationId: string,
  ): Promise<readonly ImportReleaseSnapshot[]> {
    const rows: ImportReleaseSnapshot[] = [];
    for (let offset = 0; ; offset += directoryPageSize) {
      const { data, error } = await this.supabase
        .admin()
        .from("product_releases")
        .select(
          "id,product_id,release_version,release_version_normalized,label,description,archived_at,version,products!inner(internal_code_normalized)",
        )
        .eq("organization_id", organizationId)
        .range(offset, offset + directoryPageSize - 1);
      if (error) throw new ProductImportProviderError("provider_unavailable");
      for (const row of data ?? []) {
        const product = row.products as unknown as {
          internal_code_normalized: string;
        };
        rows.push(
          Object.freeze({
            id: row.id,
            productId: row.product_id,
            productInternalCodeNormalized: product.internal_code_normalized,
            releaseVersionNormalized:
              row.release_version_normalized ??
              normalizeIdentity(row.release_version),
            label: row.label,
            version: row.release_version,
            description: row.description,
            archivedAt: row.archived_at,
            versionNumber: row.version,
          }),
        );
      }
      if ((data ?? []).length < directoryPageSize) break;
    }
    return Object.freeze(rows);
  }

  private persistedRow(contentHash: string, row: PlannedImportRow) {
    const publicIdentifiers =
      row.result === "failed"
        ? { productInternalCode: null, releaseVersion: null }
        : {
            productInternalCode: row.productInternalCodeNormalized,
            releaseVersion: row.releaseVersionNormalized,
          };
    const issues = row.issues.map((issueValue) =>
      productImportFieldIssueSchema.parse(issueValue),
    );
    const stable = {
      sourceRowNumber: row.sourceRowNumber,
      rowType: row.recordType,
      proposedAction: row.proposedAction,
      result: row.result,
      ...publicIdentifiers,
      productInternalCodeNormalized: row.productInternalCodeNormalized,
      releaseVersionNormalized: row.releaseVersionNormalized,
      productId: row.productId,
      releaseId: row.releaseId,
      expectedProductVersion: row.expectedProductVersion,
      expectedReleaseVersion: row.expectedReleaseVersion,
      proposed: row.proposed,
      issues,
    };
    return Object.freeze({
      ...stable,
      rowHash: sha256Hex(`${contentHash}:${JSON.stringify(stable)}`),
    });
  }

  private claimFrom(
    organizationId: string,
    row: Record<string, unknown>,
  ): ProductImportClaim {
    const outcome = this.outcome(
      row,
      new Set(["claimed", "empty", "not_found", "conflict", "invalid_request"]),
    );
    if (outcome !== "claimed") {
      return Object.freeze({
        outcome:
          outcome === "empty" || outcome === "not_found"
            ? "none_available"
            : (outcome as "conflict" | "invalid_request"),
      });
    }
    const job = this.job(row.job);
    const work = workSchema.parse(row.work);
    const expectedSource = importObjectPath(organizationId, job.id).source;
    if (work.sourceObjectPath !== expectedSource) {
      throw new ProductImportProviderError("malformed_provider");
    }
    if (work.kind === "commit") {
      if (!work.commitActorId || !work.commitIdempotencyKey) {
        throw new ProductImportProviderError("malformed_provider");
      }
      return Object.freeze({
        outcome: "claimed",
        organizationId,
        importId: job.id,
        contentHash: job.contentHash,
        retryCount: work.retryCount ?? 0,
        work: Object.freeze({
          kind: "commit",
          actorId: work.commitActorId,
          idempotencyKey: work.commitIdempotencyKey,
        }),
      });
    }
    return Object.freeze({
      outcome: "claimed",
      organizationId,
      importId: job.id,
      contentHash: job.contentHash,
      retryCount: work.retryCount ?? 0,
      work: Object.freeze({ kind: "dry_run" }),
    });
  }

  private jobOutcome(
    row: Record<string, unknown>,
    allowed: ReadonlySet<string>,
  ): ImportRepositoryOutcome {
    const outcome = this.outcome(row, allowed);
    if (row.job !== null && row.job !== undefined) {
      if (
        [
          "conflict",
          "not_found",
          "idempotency_mismatch",
          "invalid_request",
        ].includes(outcome)
      ) {
        return Object.freeze({
          outcome: outcome as
            | "conflict"
            | "not_found"
            | "idempotency_mismatch"
            | "invalid_request",
        });
      }
      return Object.freeze({
        outcome: outcome as
          | "queued"
          | "replayed"
          | "completed"
          | "retrying"
          | "dead_letter"
          | "stale_conflict"
          | "canceled",
        import: this.job(row.job),
      });
    }
    return Object.freeze({
      outcome:
        outcome === "not_found" ||
        outcome === "conflict" ||
        outcome === "idempotency_mismatch"
          ? outcome
          : "invalid_request",
    });
  }

  private job(value: unknown): ProductImport {
    return productImportSchema.parse(value);
  }

  private async upload(path: string, bytes: Buffer, upsert: boolean) {
    const { error } = await this.supabase
      .admin()
      .storage.from(bucket)
      .upload(path, bytes, {
        contentType: "text/csv",
        upsert,
      });
    if (error) throw new ProductImportProviderError("provider_unavailable");
  }

  private async remove(path: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .storage.from(bucket)
      .remove([path]);
    if (error) this.logger.warn("product import orphan cleanup failed safely");
  }

  private async one(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const rows = await this.many(name, args);
    if (rows.length !== 1) {
      throw new ProductImportProviderError("malformed_provider");
    }
    return rows[0] as Record<string, unknown>;
  }

  private async many(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly Record<string, unknown>[]> {
    try {
      const result = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
      if (result.error) {
        this.logger.error(`product import provider operation ${name} failed`);
        throw new ProductImportProviderError("provider_unavailable");
      }
      if (!Array.isArray(result.data)) {
        throw new ProductImportProviderError("malformed_provider");
      }
      return Object.freeze(
        result.data.map((value) => rpcRowSchema.parse(value)),
      );
    } catch (error) {
      if (error instanceof ProductImportProviderError) throw error;
      throw new ProductImportProviderError("provider_unavailable");
    }
  }

  private outcome(
    row: Readonly<Record<string, unknown>>,
    allowed: ReadonlySet<string>,
  ): string {
    if (typeof row.outcome !== "string" || !allowed.has(row.outcome)) {
      throw new ProductImportProviderError("malformed_provider");
    }
    return row.outcome;
  }
}

export class ProductImportProviderError extends Error {
  readonly name = "ProductImportProviderError";

  constructor(readonly code: "malformed_provider" | "provider_unavailable") {
    super(code);
  }
}
