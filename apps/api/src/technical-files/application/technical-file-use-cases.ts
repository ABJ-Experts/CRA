import type {
  AddTechnicalFileSourceRequest,
  CreateTechnicalFileRequest,
  UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import type { TechnicalFileRepository } from "./technical-file.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";

/** Coordinates product validation with the tenant-scoped technical-file RPCs. */
export class TechnicalFileUseCases {
  constructor(
    private readonly repository: TechnicalFileRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const retention = await this.retentionFor(organizationId, input);
    const technicalFile = await this.repository.get(organizationId, input);
    return technicalFile ? { technicalFile, retention } : null;
  }

  async create(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateTechnicalFileRequest
    >,
  ) {
    const retention = await this.retentionFor(organizationId, input);
    const technicalFile = await this.repository.create(organizationId, input);
    return technicalFile ? { technicalFile, retention } : null;
  }

  async section(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; sectionKey: string }>,
  ) {
    await this.retentionFor(organizationId, input);
    return this.repository.getSection(organizationId, input);
  }

  async updateSection(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & UpdateTechnicalFileSectionRequest
    >,
  ) {
    await this.retentionFor(organizationId, input);
    return this.repository.updateSection(organizationId, input);
  }

  async addSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & AddTechnicalFileSourceRequest
    >,
  ) {
    await this.retentionFor(organizationId, input);
    return this.repository.addSource(organizationId, input);
  }

  async removeSource(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      sectionKey: string;
      sourceId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ) {
    await this.retentionFor(organizationId, input);
    return this.repository.removeSource(organizationId, input);
  }

  private async retentionFor(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const result = await this.retention.getProductRetentionCalculation({
      organizationId,
      actorId: input.actorId,
      productId: input.productId,
    });
    if (!result.ok) throw new TechnicalFileProductUnavailableError();
    return result.value.retention;
  }
}
