import type {
  CreateTechnicalFileDeclarationDraftRequest,
  IssueTechnicalFileDeclarationRequest,
  ReissueTechnicalFileDeclarationRequest,
} from "@repo/contracts/technical-files";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import type { TechnicalFileDeclarationRepository } from "./technical-file-declaration.port";

/** Applies the established retention/product boundary before declaration RPCs. */
export class TechnicalFileDeclarationUseCases {
  constructor(
    private readonly repository: TechnicalFileDeclarationRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async preview(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.preview(organizationId, input);
  }
  async list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.list(organizationId, input);
  }
  async saveDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId?: string;
      } & CreateTechnicalFileDeclarationDraftRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.saveDraft(organizationId, input);
  }
  async issue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & IssueTechnicalFileDeclarationRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.issue(organizationId, input);
  }
  async reissue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & ReissueTechnicalFileDeclarationRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.reissue(organizationId, input);
  }
  async download(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      declarationId: string;
    }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.download(organizationId, input);
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
