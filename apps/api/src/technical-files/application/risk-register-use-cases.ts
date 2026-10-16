import type {
  AcceptResidualRiskRequest,
  ArchiveRiskRegisterRiskRequest,
  CreateRiskRegisterRiskRequest,
  UpdateRiskRegisterRiskRequest,
} from "@repo/contracts/risk-registers";

import type { ProductRetentionReaderPort } from "../../products/application/product-retention-reader.port";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import type { RiskRegisterRepository } from "./risk-register.port";

/** Coordinates the published product projection with tenant-scoped risk RPCs. */
export class RiskRegisterUseCases {
  constructor(
    private readonly repository: RiskRegisterRepository,
    private readonly retention: ProductRetentionReaderPort,
  ) {}

  async get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.get(organizationId, input);
  }

  async risk(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; riskId: string }>,
  ) {
    const register = await this.get(organizationId, input);
    return register?.risks.find((risk) => risk.id === input.riskId) ?? null;
  }

  async createRisk(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateRiskRegisterRiskRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.createRisk(organizationId, input);
  }

  async updateRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & UpdateRiskRegisterRiskRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.updateRisk(organizationId, input);
  }

  async archiveRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & ArchiveRiskRegisterRiskRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.archiveRisk(organizationId, input);
  }

  async acceptResidualRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & AcceptResidualRiskRequest
    >,
  ) {
    await this.productExists(organizationId, input);
    return this.repository.acceptResidualRisk(organizationId, input);
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
