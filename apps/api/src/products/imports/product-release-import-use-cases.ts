import { createHash, randomUUID } from "node:crypto";
import {
  createProductInputSchema,
  createReleaseInputSchema,
  productImportSyncRowThreshold,
  updateProductInputSchema,
  updateReleaseInputSchema,
  type ProductImport,
  type ProductImportCommitInput,
  type ProductImportFieldIssue,
  type ProductImportListQuery,
  type ProductImportReportLinkResponse,
  type ProductImportRow,
  type ProductImportRowsQuery,
  type ProductImportUploadFields,
  type ProductType,
} from "@repo/contracts/products";
import type { BaseRole } from "@repo/contracts/permissions";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import {
  PRODUCT_IMPORT_SCHEMA_VERSION,
  PRODUCT_IMPORT_TEMPLATE,
  countRows,
  csvReport,
  isWithinSynchronousImportThreshold,
  normalizeIdentity,
  parseProductImportCsv,
  sha256Hex,
  type ImportFieldIssue,
  type ParsedImportFile,
  type ParsedImportRow,
  type PlannedImportRow,
} from "./product-release-import-format";

export type ImportProductSnapshot = Readonly<{
  id: string;
  internalCodeNormalized: string;
  name: string;
  internalCode: string;
  productType: ProductType;
  description: string | null;
  responsibleOwnerId: string;
  legalEntityId: string;
  archivedAt: string | null;
  version: number;
}>;

export type ImportReleaseSnapshot = Readonly<{
  id: string;
  productId: string;
  productInternalCodeNormalized: string;
  releaseVersionNormalized: string;
  label: string;
  version: string;
  description: string | null;
  archivedAt: string | null;
  versionNumber: number;
}>;

export type ImportDirectory = Readonly<{
  ownersByEmail: ReadonlyMap<string, string>;
  legalEntitiesByIdentifier: ReadonlyMap<string, string>;
  productsByCode: ReadonlyMap<string, ImportProductSnapshot>;
  releasesByProductAndVersion: ReadonlyMap<string, ImportReleaseSnapshot>;
}>;

export type ImportPage<T> = Readonly<{
  rows: readonly T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}>;

export type ProductImportClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      importId: string;
      contentHash: string;
      retryCount: number;
      work:
        | Readonly<{ kind: "dry_run" }>
        | Readonly<{
            kind: "commit";
            actorId: string;
            idempotencyKey: string;
          }>;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "invalid_request";
    }>;

export interface ProductImportRepository {
  begin(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      fields: ProductImportUploadFields;
      originalFilename: string;
      contentHash: string;
      byteSize: number;
      bytes: Buffer;
    }>,
  ): Promise<ImportRepositoryOutcome>;
  source(
    organizationId: string,
    importId: string,
  ): Promise<Readonly<{ bytes: Buffer; contentHash: string }> | null>;
  loadDirectory(organizationId: string): Promise<ImportDirectory>;
  completeDryRun(
    organizationId: string,
    input: Readonly<{
      importId: string;
      workerId: string;
      contentHash: string;
      parsedRowCount: number;
      rows: readonly PlannedImportRow[];
      reportCsv: string;
    }>,
  ): Promise<ImportRepositoryOutcome>;
  list(
    organizationId: string,
    actorId: string,
    query: ProductImportListQuery,
  ): Promise<ImportPage<ProductImport>>;
  get(
    organizationId: string,
    actorId: string,
    importId: string,
  ): Promise<ProductImport | null>;
  listRows(
    organizationId: string,
    actorId: string,
    importId: string,
    query: ProductImportRowsQuery,
  ): Promise<ImportPage<ProductImportRow> | null>;
  report(
    orgId: string,
    actorId: string,
    importId: string,
  ): Promise<ProductImportReportLinkResponse | null>;
  commit(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      importId: string;
      command: ProductImportCommitInput;
    }>,
  ): Promise<ImportRepositoryOutcome>;
  executeCommit(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      importId: string;
      contentHash: string;
      idempotencyKey: string;
    }>,
  ): Promise<ImportRepositoryOutcome>;
  cancel(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      importId: string;
      reason: string | null;
    }>,
  ): Promise<ImportRepositoryOutcome>;
  dueOrganizationIds(): Promise<readonly string[]>;
  claim(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<ProductImportClaim>;
  claimById(
    organizationId: string,
    input: Readonly<{
      importId: string;
      workerId: string;
      leaseSeconds: number;
    }>,
  ): Promise<ProductImportClaim>;
  failClaim(
    organizationId: string,
    input: Readonly<{
      importId: string;
      workerId: string;
      errorCode: string;
      retryable: boolean;
    }>,
  ): Promise<void>;
  markStaleClaim(
    organizationId: string,
    input: Readonly<{
      importId: string;
      workerId: string;
      errorCode:
        "authorization_changed" | "content_hash_mismatch" | "source_missing";
    }>,
  ): Promise<void>;
  actorBaseRole(orgId: string, actorId: string): Promise<BaseRole | null>;
}

export type ImportRepositoryOutcome =
  | Readonly<{
      outcome:
        | "created"
        | "replayed"
        | "queued"
        | "dry_run_completed"
        | "dry_run_failed"
        | "completed"
        | "retrying"
        | "dead_letter"
        | "stale_conflict"
        | "canceled";
      import: ProductImport;
    }>
  | Readonly<{
      outcome:
        "conflict" | "not_found" | "idempotency_mismatch" | "invalid_request";
    }>;

export type ImportUseCaseError =
  | Readonly<{
      code: "invalid_request";
      issues?: readonly ProductImportFieldIssue[];
    }>
  | Readonly<{ code: "not_found" }>
  | Readonly<{ code: "conflict" | "idempotency_mismatch" }>
  | Readonly<{ code: "source_missing" | "content_hash_mismatch" }>
  | Readonly<{ code: "unavailable" | "malformed_provider" }>;

type ImportResult<T> = Result<T, ImportUseCaseError>;

export class ProductImportUseCases {
  constructor(private readonly repository: ProductImportRepository) {}

  template() {
    return Object.freeze({
      schemaVersion: PRODUCT_IMPORT_SCHEMA_VERSION,
      filename: "product-release-import-v1.csv" as const,
      contentType: "text/csv; charset=utf-8" as const,
      csv: PRODUCT_IMPORT_TEMPLATE,
    });
  }

  async dryRun(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      fields: ProductImportUploadFields;
      originalFilename: string;
      bytes: Buffer;
    }>,
  ): Promise<ImportResult<Readonly<{ import: ProductImport }>>> {
    const contentHash = sha256Hex(command.bytes);
    try {
      const begun = await this.repository.begin(command.organizationId, {
        actorId: command.actorId,
        fields: command.fields,
        originalFilename: safeFilename(command.originalFilename),
        contentHash,
        byteSize: command.bytes.byteLength,
        bytes: command.bytes,
      });
      if (!("import" in begun)) return failure({ code: begun.outcome });
      if (begun.outcome === "replayed") {
        return success({ import: begun.import });
      }

      if (
        !isWithinSynchronousImportThreshold(
          command.bytes,
          productImportSyncRowThreshold,
        )
      ) {
        return success({ import: begun.import });
      }
      const claimWorkerId = randomUUID();
      const claim = await this.repository.claimById(command.organizationId, {
        importId: begun.import.id,
        workerId: claimWorkerId,
        leaseSeconds: 60,
      });
      if (claim.outcome !== "claimed" || claim.work.kind !== "dry_run") {
        return failure({ code: "conflict" });
      }
      const parsed = await parseProductImportCsv(command.bytes);
      return this.completeParsed({
        organizationId: command.organizationId,
        importId: begun.import.id,
        workerId: claimWorkerId,
        parsed,
      });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async processStored(
    command: Readonly<{
      organizationId: string;
      importId: string;
      workerId: string;
      expectedContentHash: string;
    }>,
  ): Promise<ImportResult<Readonly<{ import: ProductImport }>>> {
    try {
      const source = await this.repository.source(
        command.organizationId,
        command.importId,
      );
      if (!source) {
        return failure({ code: "source_missing" });
      }
      if (source.contentHash !== command.expectedContentHash) {
        return failure({ code: "content_hash_mismatch" });
      }
      const parsed = await parseProductImportCsv(source.bytes);
      if (parsed.contentHash !== command.expectedContentHash) {
        return failure({ code: "content_hash_mismatch" });
      }
      return this.completeParsed({
        organizationId: command.organizationId,
        importId: command.importId,
        workerId: command.workerId,
        parsed,
      });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async list(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      query: ProductImportListQuery;
    }>,
  ): Promise<ImportResult<Readonly<{ imports: ImportPage<ProductImport> }>>> {
    try {
      return success({
        imports: await this.repository.list(
          command.organizationId,
          command.actorId,
          command.query,
        ),
      });
    } catch {
      return failure({ code: "unavailable" });
    }
  }

  async get(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      importId: string;
    }>,
  ) {
    try {
      const found = await this.repository.get(
        command.organizationId,
        command.actorId,
        command.importId,
      );
      return found
        ? success({ import: found })
        : failure<ImportUseCaseError>({ code: "not_found" });
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  async rows(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      importId: string;
      query: ProductImportRowsQuery;
    }>,
  ) {
    try {
      const rows = await this.repository.listRows(
        command.organizationId,
        command.actorId,
        command.importId,
        command.query,
      );
      return rows
        ? success({ rows })
        : failure<ImportUseCaseError>({ code: "not_found" });
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  async report(
    command: Readonly<{
      organizationId: string;
      importId: string;
      actorId: string;
    }>,
  ) {
    try {
      const report = await this.repository.report(
        command.organizationId,
        command.actorId,
        command.importId,
      );
      return report
        ? success(report)
        : failure<ImportUseCaseError>({ code: "not_found" });
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  async commit(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      importId: string;
      input: ProductImportCommitInput;
    }>,
  ) {
    try {
      return mapOutcome(
        await this.repository.commit(command.organizationId, {
          actorId: command.actorId,
          importId: command.importId,
          command: command.input,
        }),
      );
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  async cancel(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      importId: string;
      reason: string | null;
    }>,
  ) {
    try {
      return mapOutcome(
        await this.repository.cancel(command.organizationId, command),
      );
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  async executeCommit(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      importId: string;
      contentHash: string;
      idempotencyKey: string;
    }>,
  ) {
    try {
      return mapOutcome(
        await this.repository.executeCommit(command.organizationId, command),
      );
    } catch {
      return failure<ImportUseCaseError>({ code: "unavailable" });
    }
  }

  private async completeParsed(
    command: Readonly<{
      organizationId: string;
      importId: string;
      workerId: string;
      parsed: ParsedImportFile;
    }>,
  ): Promise<ImportResult<Readonly<{ import: ProductImport }>>> {
    const directory = command.parsed.ok
      ? await this.repository.loadDirectory(command.organizationId)
      : null;
    const rows = command.parsed.ok
      ? planImportRows(command.parsed.rows, directory as ImportDirectory)
      : command.parsed.issues.map((issueValue, index) =>
          failedRow(index + 2, issueValue),
        );
    const result = await this.repository.completeDryRun(
      command.organizationId,
      {
        importId: command.importId,
        workerId: command.workerId,
        contentHash: command.parsed.contentHash,
        parsedRowCount: command.parsed.ok
          ? command.parsed.rows.length
          : rows.length,
        rows,
        reportCsv: csvReport(rows),
      },
    );
    return mapOutcome(result);
  }
}

export function planImportRows(
  rows: readonly ParsedImportRow[],
  directory: ImportDirectory,
): readonly PlannedImportRow[] {
  const productDuplicates = duplicateSet(
    rows
      .filter((row) => row.values.record_type === "product")
      .map((row) => normalizeIdentity(row.values.product_internal_code)),
  );
  const releaseDuplicates = duplicateSet(
    rows
      .filter((row) => row.values.record_type === "release")
      .map((row) => releaseKey(row)),
  );
  const productCreates = new Set(
    rows
      .filter(
        (row) =>
          row.values.record_type === "product" &&
          row.values.operation === "create",
      )
      .map((row) => normalizeIdentity(row.values.product_internal_code)),
  );

  return Object.freeze(
    rows.map((row) =>
      row.values.record_type === "release"
        ? planReleaseRow(row, directory, releaseDuplicates, productCreates)
        : planProductRow(row, directory, productDuplicates),
    ),
  );
}

function planProductRow(
  row: ParsedImportRow,
  directory: ImportDirectory,
  duplicates: ReadonlySet<string>,
): PlannedImportRow {
  const issues = commonIssues(row);
  const code = normalizeIdentity(row.values.product_internal_code);
  const existing = directory.productsByCode.get(code);
  const operation = validOperation(row.values.operation);
  const ownerId = row.values.owner_email
    ? directory.ownersByEmail.get(normalizeEmail(row.values.owner_email))
    : undefined;
  const legalEntityId = row.values.legal_entity_identifier
    ? directory.legalEntitiesByIdentifier.get(
        normalizeIdentity(row.values.legal_entity_identifier),
      )
    : undefined;

  if (duplicates.has(code)) {
    addIssue(
      issues,
      "product_internal_code",
      "duplicate_in_file",
      "This product code appears more than once in the file.",
    );
  }
  if (existing?.archivedAt) {
    addIssue(
      issues,
      "product_internal_code",
      "inactive",
      "The referenced product is not active.",
    );
  }
  if (row.values.owner_email && !ownerId) {
    addIssue(
      issues,
      "owner_email",
      "not_found",
      "The owner is not an active member of this organization.",
    );
  }
  if (row.values.legal_entity_identifier && !legalEntityId) {
    addIssue(
      issues,
      "legal_entity_identifier",
      "not_found",
      "The legal entity is not available in this organization.",
    );
  }

  let proposed: Readonly<Record<string, string | number | null>> = {};
  let proposedAction: PlannedImportRow["proposedAction"] =
    operation ?? "skipped";
  let expectedVersion: number | null = null;

  if (operation === "create") {
    if (existing) {
      addIssue(
        issues,
        "product_internal_code",
        "already_exists",
        "A product with this internal code already exists.",
      );
    }
    if (row.values.expected_version) {
      addIssue(
        issues,
        "expected_version",
        "unexpected_value",
        "Expected version is only supported for updates.",
      );
    }
    const candidate = {
      name: row.values.product_name,
      internalCode: row.values.product_internal_code,
      productType: row.values.product_type,
      ...(row.values.product_description
        ? { description: row.values.product_description }
        : {}),
      responsibleOwnerId: ownerId ?? "",
      legalEntityId: legalEntityId ?? "",
      idempotencyKey: deterministicRowUuid(row),
    };
    addZodIssues(issues, createProductInputSchema.safeParse(candidate));
    proposed = Object.freeze(candidate);
  } else if (operation === "update") {
    if (!existing) {
      addIssue(
        issues,
        "product_internal_code",
        "not_found",
        "No active product with this internal code exists.",
      );
    }
    expectedVersion = parseExpectedVersion(row, issues);
    if (
      existing &&
      expectedVersion !== null &&
      existing.version !== expectedVersion
    ) {
      addIssue(
        issues,
        "expected_version",
        "stale_version",
        "The product changed after the CSV snapshot was prepared.",
      );
    }
    if (existing && legalEntityId && legalEntityId !== existing.legalEntityId) {
      addIssue(
        issues,
        "legal_entity_identifier",
        "unexpected_value",
        "Legal entity reassignment is not supported by this import version.",
      );
    }
    const changes = compactChanges({
      ...(row.values.product_name ? { name: row.values.product_name } : {}),
      ...(row.values.product_type
        ? { productType: row.values.product_type }
        : {}),
      ...(row.values.product_description
        ? { description: row.values.product_description }
        : {}),
      ...(ownerId ? { responsibleOwnerId: ownerId } : {}),
    });
    if (existing && isProductUnchanged(existing, changes)) {
      proposedAction = "unchanged";
      proposed = Object.freeze({ expectedVersion: expectedVersion ?? -1 });
    } else {
      const candidate = { ...changes, expectedVersion: expectedVersion ?? -1 };
      addZodIssues(issues, updateProductInputSchema.safeParse(candidate));
      proposed = Object.freeze(candidate);
    }
  }

  return planned(row, {
    recordType: row.values.record_type === "product" ? "product" : null,
    proposedAction: issues.some(isError) ? "failed" : proposedAction,
    result: issues.some(isError)
      ? "failed"
      : proposedAction === "unchanged"
        ? "planned"
        : "planned",
    productInternalCodeNormalized: code || null,
    releaseVersionNormalized: null,
    productId: existing?.id ?? null,
    releaseId: null,
    expectedProductVersion: expectedVersion,
    expectedReleaseVersion: null,
    proposed,
    issues,
  });
}

function planReleaseRow(
  row: ParsedImportRow,
  directory: ImportDirectory,
  duplicates: ReadonlySet<string>,
  productCreates: ReadonlySet<string>,
): PlannedImportRow {
  const issues = commonIssues(row);
  const code = normalizeIdentity(row.values.product_internal_code);
  const releaseVersion = normalizeIdentity(row.values.release_version);
  const product = directory.productsByCode.get(code);
  const existing = directory.releasesByProductAndVersion.get(
    `${code}\u0000${releaseVersion}`,
  );
  const operation = validOperation(row.values.operation);
  if (duplicates.has(releaseKey(row))) {
    addIssue(
      issues,
      "release_version",
      "duplicate_in_file",
      "This release identity appears more than once in the file.",
    );
  }
  if (!product && !productCreates.has(code)) {
    addIssue(
      issues,
      "product_internal_code",
      "not_found",
      "No active product with this internal code exists in this organization or file.",
    );
  }
  if (product?.archivedAt) {
    addIssue(
      issues,
      "product_internal_code",
      "inactive",
      "The referenced product is not active.",
    );
  }
  if (existing?.archivedAt) {
    addIssue(
      issues,
      "release_version",
      "inactive",
      "The referenced release is not active.",
    );
  }

  let proposed: Readonly<Record<string, string | number | null>> = {};
  let proposedAction: PlannedImportRow["proposedAction"] =
    operation ?? "skipped";
  let expectedVersion: number | null = null;
  if (operation === "create") {
    if (existing) {
      addIssue(
        issues,
        "release_version",
        "already_exists",
        "A release with this version already exists for the product.",
      );
    }
    if (row.values.expected_version) {
      addIssue(
        issues,
        "expected_version",
        "unexpected_value",
        "Expected version is only supported for updates.",
      );
    }
    const candidate = {
      label: row.values.release_label,
      version: row.values.release_version,
      ...(row.values.release_description
        ? { description: row.values.release_description }
        : {}),
      idempotencyKey: deterministicRowUuid(row),
    };
    addZodIssues(issues, createReleaseInputSchema.safeParse(candidate));
    proposed = Object.freeze(candidate);
  } else if (operation === "update") {
    if (!existing) {
      addIssue(
        issues,
        "release_version",
        "not_found",
        "No active release with this version exists for the product.",
      );
    }
    expectedVersion = parseExpectedVersion(row, issues);
    if (
      existing &&
      expectedVersion !== null &&
      existing.versionNumber !== expectedVersion
    ) {
      addIssue(
        issues,
        "expected_version",
        "stale_version",
        "The release changed after the CSV snapshot was prepared.",
      );
    }
    const changes = compactChanges({
      ...(row.values.release_label ? { label: row.values.release_label } : {}),
      ...(row.values.release_description
        ? { description: row.values.release_description }
        : {}),
    });
    if (existing && isReleaseUnchanged(existing, changes)) {
      proposedAction = "unchanged";
      proposed = Object.freeze({ expectedVersion: expectedVersion ?? -1 });
    } else {
      const candidate = { ...changes, expectedVersion: expectedVersion ?? -1 };
      addZodIssues(issues, updateReleaseInputSchema.safeParse(candidate));
      proposed = Object.freeze(candidate);
    }
  }

  return planned(row, {
    recordType: "release",
    proposedAction: issues.some(isError) ? "failed" : proposedAction,
    result: issues.some(isError) ? "failed" : "planned",
    productInternalCodeNormalized: code || null,
    releaseVersionNormalized: releaseVersion || null,
    productId: product?.id ?? null,
    releaseId: existing?.id ?? null,
    expectedProductVersion: product?.version ?? null,
    expectedReleaseVersion: expectedVersion,
    proposed,
    issues,
  });
}

function commonIssues(row: ParsedImportRow): ImportFieldIssue[] {
  const issues: ImportFieldIssue[] = [];
  if (row.values.format_version !== PRODUCT_IMPORT_SCHEMA_VERSION) {
    addIssue(
      issues,
      "format_version",
      "unsupported_schema_version",
      "The import format version is not supported.",
    );
  }
  if (
    !(["product", "release"] as const).includes(row.values.record_type as never)
  ) {
    addIssue(
      issues,
      "record_type",
      "invalid_record_type",
      "Record type must be product or release.",
    );
  }
  if (!validOperation(row.values.operation)) {
    addIssue(
      issues,
      "operation",
      "invalid_operation",
      "Operation must be create or update.",
    );
  }
  if (!row.values.product_internal_code) {
    addIssue(
      issues,
      "product_internal_code",
      "required",
      "Product internal code is required.",
    );
  }
  return issues;
}

function addZodIssues(
  issues: ImportFieldIssue[],
  parsed: Readonly<{
    success: boolean;
    error?: Readonly<{ issues: readonly Readonly<{ path: PropertyKey[] }>[] }>;
  }>,
): void {
  if (parsed.success) return;
  for (const zodIssue of parsed.error?.issues ?? []) {
    const field = String(zodIssue.path[0] ?? "file");
    addIssue(
      issues,
      zodField(field),
      field === "expectedVersion" ? "invalid_format" : "invalid_value",
      "The field value does not satisfy the product registry rules.",
    );
  }
}

function zodField(field: string): string {
  return (
    (
      {
        name: "product_name",
        internalCode: "product_internal_code",
        productType: "product_type",
        description: "product_description",
        responsibleOwnerId: "owner_email",
        legalEntityId: "legal_entity_identifier",
        label: "release_label",
        version: "release_version",
        expectedVersion: "expected_version",
        idempotencyKey: "file",
      } as Readonly<Record<string, string>>
    )[field] ?? "file"
  );
}

function parseExpectedVersion(
  row: ParsedImportRow,
  issues: ImportFieldIssue[],
): number | null {
  if (!/^(0|[1-9][0-9]*)$/u.test(row.values.expected_version)) {
    addIssue(
      issues,
      "expected_version",
      row.values.expected_version ? "invalid_format" : "required",
      "Updates require a non-negative integer expected version.",
    );
    return null;
  }
  const value = Number(row.values.expected_version);
  if (!Number.isSafeInteger(value)) {
    addIssue(
      issues,
      "expected_version",
      "invalid_format",
      "Expected version is outside the supported range.",
    );
    return null;
  }
  return value;
}

function planned(
  row: ParsedImportRow,
  input: Omit<PlannedImportRow, "sourceRowNumber">,
): PlannedImportRow {
  return Object.freeze({
    sourceRowNumber: row.sourceRowNumber,
    ...input,
    proposed: Object.freeze({ ...input.proposed }),
    issues: Object.freeze(input.issues.map((value) => Object.freeze(value))),
  });
}

function failedRow(
  sourceRowNumber: number,
  issueValue: ImportFieldIssue,
): PlannedImportRow {
  return Object.freeze({
    sourceRowNumber,
    recordType: null,
    proposedAction: "failed",
    result: "failed",
    productInternalCodeNormalized: null,
    releaseVersionNormalized: null,
    productId: null,
    releaseId: null,
    expectedProductVersion: null,
    expectedReleaseVersion: null,
    proposed: Object.freeze({}),
    issues: Object.freeze([issueValue]),
  });
}

function addIssue(
  issues: ImportFieldIssue[],
  field: string,
  code: string,
  message: string,
  severity: "warning" | "error" = "error",
): void {
  issues.push(Object.freeze({ field, code, message, severity }));
}

function isError(issueValue: ImportFieldIssue): boolean {
  return issueValue.severity === "error";
}

function validOperation(value: string): "create" | "update" | null {
  return value === "create" || value === "update" ? value : null;
}

function duplicateSet(values: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function releaseKey(row: ParsedImportRow): string {
  return `${normalizeIdentity(row.values.product_internal_code)}\u0000${normalizeIdentity(row.values.release_version)}`;
}

function compactChanges(
  input: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== ""),
    ),
  );
}

function isProductUnchanged(
  existing: ImportProductSnapshot,
  changes: Readonly<Record<string, string>>,
): boolean {
  return (
    Object.keys(changes).length === 0 ||
    ((changes.name === undefined || changes.name === existing.name) &&
      (changes.productType === undefined ||
        changes.productType === existing.productType) &&
      (changes.description === undefined ||
        changes.description === existing.description) &&
      (changes.responsibleOwnerId === undefined ||
        changes.responsibleOwnerId === existing.responsibleOwnerId))
  );
}

function isReleaseUnchanged(
  existing: ImportReleaseSnapshot,
  changes: Readonly<Record<string, string>>,
): boolean {
  return (
    Object.keys(changes).length === 0 ||
    ((changes.label === undefined || changes.label === existing.label) &&
      (changes.description === undefined ||
        changes.description === existing.description))
  );
}

function deterministicRowUuid(row: ParsedImportRow): string {
  const hex = createHash("sha256")
    .update(
      JSON.stringify({
        sourceRowNumber: row.sourceRowNumber,
        values: row.values,
      }),
    )
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(
    13,
    16,
  )}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeFilename(value: string): string {
  const filename = value
    .replace(/.*[\\/]/u, "")
    .normalize("NFKC")
    .trim();
  return filename.slice(0, 255) || "product-release-import.csv";
}

function normalizeEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function mapOutcome(result: ImportRepositoryOutcome) {
  return "import" in result
    ? success({ import: result.import })
    : failure<ImportUseCaseError>({ code: result.outcome });
}

export function uploadDigest(
  input: Readonly<{
    idempotencyKey: string;
    contentHash: string;
    byteSize: number;
    originalFilename: string;
  }>,
): string {
  return sha256Hex(JSON.stringify(input));
}

export function importObjectPath(
  organizationId: string,
  importId: string = randomUUID(),
): Readonly<{
  importId: string;
  source: string;
  report: string;
}> {
  return Object.freeze({
    importId,
    source: `${organizationId}/${importId}/source.csv`,
    report: `${organizationId}/${importId}/report.csv`,
  });
}

export { countRows };
