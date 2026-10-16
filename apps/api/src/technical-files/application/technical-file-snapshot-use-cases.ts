import type {
  CancelTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotExportRequest,
  CreateTechnicalFileSnapshotRequest,
} from "@repo/contracts/technical-files";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import type {
  TechnicalFileSnapshotArtifactName,
  TechnicalFileSnapshotRepository,
} from "./technical-file-snapshot.port";

/** Applies verified product scope before immutable snapshot/export RPCs. */
export class TechnicalFileSnapshotUseCases {
  constructor(
    private readonly repository: TechnicalFileSnapshotRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.list(organizationId, input);
  }

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.get(organizationId, input);
  }

  async create(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & CreateTechnicalFileSnapshotRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.create(organizationId, input);
  }

  async requestExport(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
      } & CreateTechnicalFileSnapshotExportRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.requestExport(organizationId, input);
  }

  async export(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.getExport(organizationId, input);
  }

  async cancelExport(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        exportId: string;
      } & CancelTechnicalFileSnapshotExportRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.cancelExport(organizationId, input);
  }

  async download(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
      artifact: TechnicalFileSnapshotArtifactName;
    }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.getDownload(organizationId, input);
  }

  private async productExists(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const result = await this.retention.getProductRetentionCalculation({
      organizationId,
      actorId: input.actorId,
      productId: input.productId,
    });
    if (!result.ok) throw new TechnicalFileProductUnavailableError();
  }
}
