import type {
  RecalculateTechnicalFileReadinessRequest,
  ReviewTechnicalFileSourceRequest,
  SignalTechnicalFileSourceMaterialChangeRequest,
} from "@repo/contracts/technical-files";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import type { TechnicalFileReadinessRepository } from "./technical-file-readiness.port";

/** Validates product scope before invoking the durable evidence-readiness RPCs. */
export class TechnicalFileReadinessUseCases {
  constructor(
    private readonly repository: TechnicalFileReadinessRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.get(organizationId, input);
  }

  async recalculate(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & RecalculateTechnicalFileReadinessRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.recalculate(organizationId, input);
  }

  async reviewSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & ReviewTechnicalFileSourceRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.reviewSource(organizationId, input);
  }

  async signalMaterialChange(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
        sourceId: string;
      } & SignalTechnicalFileSourceMaterialChangeRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.signalMaterialChange(organizationId, input);
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
