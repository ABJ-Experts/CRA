import { PRODUCT_IMPORT_SCHEMA_VERSION } from "./product-release-import-format";
import {
  ProductImportUseCases,
  planImportRows,
  type ImportDirectory,
} from "./product-release-import-use-cases";

const organizationId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const ownerId = "00000000-0000-4000-8000-000000000003";
const legalEntityId = "00000000-0000-4000-8000-000000000004";
const productId = "00000000-0000-4000-8000-000000000005";

const emptyDirectory: ImportDirectory = {
  ownersByEmail: new Map([["owner@cra.test", ownerId]]),
  legalEntitiesByIdentifier: new Map([["abj-eu", legalEntityId]]),
  productsByCode: new Map(),
  releasesByProductAndVersion: new Map(),
};

function parsedRow(
  sourceRowNumber: number,
  overrides: Partial<
    Record<
      | "format_version"
      | "record_type"
      | "operation"
      | "product_internal_code"
      | "product_name"
      | "product_type"
      | "product_description"
      | "owner_email"
      | "legal_entity_identifier"
      | "release_version"
      | "release_label"
      | "release_description"
      | "expected_version",
      string
    >
  > = {},
) {
  return {
    sourceRowNumber,
    values: {
      format_version: PRODUCT_IMPORT_SCHEMA_VERSION,
      record_type: "product",
      operation: "create",
      product_internal_code: "GW-100",
      product_name: "Gateway",
      product_type: "hardware_with_software",
      product_description: "",
      owner_email: "owner@cra.test",
      legal_entity_identifier: "abj-eu",
      release_version: "",
      release_label: "",
      release_description: "",
      expected_version: "",
      ...overrides,
    },
  } as const;
}

describe("ProductImportUseCases", () => {
  it("plans a release before its product without requiring a database id", () => {
    const planned = planImportRows(
      [
        parsedRow(2, {
          record_type: "release",
          product_internal_code: "GW-100",
          product_name: "",
          product_type: "",
          owner_email: "",
          legal_entity_identifier: "",
          release_version: "1.0.0",
          release_label: "Initial",
        }),
        parsedRow(3),
      ],
      emptyDirectory,
    );

    expect(planned[0]).toMatchObject({
      recordType: "release",
      proposedAction: "create",
      result: "planned",
      productId: null,
      issues: [],
    });
  });

  it("rejects duplicates and stale update versions deterministically", () => {
    const directory: ImportDirectory = {
      ...emptyDirectory,
      productsByCode: new Map([
        [
          "gw-100",
          {
            id: productId,
            internalCodeNormalized: "gw-100",
            internalCode: "GW-100",
            name: "Gateway",
            productType: "hardware_with_software",
            description: null,
            responsibleOwnerId: ownerId,
            legalEntityId,
            archivedAt: null,
            version: 4,
          },
        ],
      ]),
    };

    const planned = planImportRows(
      [
        parsedRow(2, { operation: "update", expected_version: "3" }),
        parsedRow(3, { operation: "update", expected_version: "3" }),
      ],
      directory,
    );

    expect(planned).toHaveLength(2);
    for (const row of planned) {
      expect(row.proposedAction).toBe("failed");
      expect(row.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["duplicate_in_file", "stale_version"]),
      );
    }
  });

  it("returns a queued durable job without planning more than 1,000 rows", async () => {
    const importValue = {
      id: productId,
      schemaVersion: PRODUCT_IMPORT_SCHEMA_VERSION,
      status: "queued",
      contentHash: "a".repeat(64),
      byteSize: 1,
      rowCount: 0,
      processedRowCount: 0,
      counts: {
        create: 0,
        update: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
        warnings: 0,
      },
      errorCode: null,
      expiresAt: "2026-08-18T00:00:00.000Z",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      committedAt: null,
    } as const;
    const repository = {
      begin: jest.fn().mockResolvedValue({
        outcome: "created",
        import: importValue,
      }),
      completeDryRun: jest.fn(),
    };
    const useCases = new ProductImportUseCases(repository as never);
    const header = Object.keys(parsedRow(2).values).join(",");
    const row = Object.values(parsedRow(2).values).join(",");
    const bytes = Buffer.from(
      `${header}\n${Array(1_001).fill(row).join("\n")}\n`,
    );

    const result = await useCases.dryRun({
      organizationId,
      actorId,
      fields: { idempotencyKey: productId },
      originalFilename: "products.csv",
      bytes,
    });

    expect(result).toEqual({ ok: true, value: { import: importValue } });
    expect(repository.completeDryRun).not.toHaveBeenCalled();
  });
});
