import type {
  AcceptResidualRiskRequest,
  ArchiveRiskRegisterRiskRequest,
  CreateRiskRegisterRiskRequest,
  RiskRegisterRisk,
  RiskRegisterWorkspace,
  UpdateRiskRegisterRiskRequest,
} from "@repo/contracts/risk-registers";

export const RISK_REGISTER_REPOSITORY = Symbol("RISK_REGISTER_REPOSITORY");

export interface RiskRegisterRepository {
  get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ): Promise<RiskRegisterWorkspace["riskRegister"]>;
  createRisk(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateRiskRegisterRiskRequest
    >,
  ): Promise<RiskRegisterRisk | null>;
  updateRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & UpdateRiskRegisterRiskRequest
    >,
  ): Promise<RiskRegisterRisk | null>;
  archiveRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & ArchiveRiskRegisterRiskRequest
    >,
  ): Promise<RiskRegisterRisk | null>;
  acceptResidualRisk(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        riskId: string;
      } & AcceptResidualRiskRequest
    >,
  ): Promise<RiskRegisterRisk | null>;
}

export class RiskRegisterConflictError extends Error {
  constructor(readonly currentVersion: number | null = null) {
    super("The risk changed.");
  }
}

export class RiskRegisterInvalidRequestError extends Error {}
