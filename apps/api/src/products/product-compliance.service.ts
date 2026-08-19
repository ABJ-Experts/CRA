import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { Result } from "../common/domain/result";
import {
  ProductComplianceUseCases,
  type ProductComplianceError,
} from "./application/product-compliance-use-cases";

/** Maps compliance use-case outcomes to the product API’s safe error envelope. */
@Injectable()
export class ProductComplianceService {
  constructor(private readonly useCases: ProductComplianceUseCases) {}

  listAssessments(
    command: Parameters<ProductComplianceUseCases["listAssessments"]>[0],
  ) {
    return this.unwrap(this.useCases.listAssessments(command));
  }

  getAssessment(
    command: Parameters<ProductComplianceUseCases["getAssessment"]>[0],
  ) {
    return this.unwrap(this.useCases.getAssessment(command));
  }

  createAssessment(
    command: Parameters<ProductComplianceUseCases["createAssessment"]>[0],
  ) {
    return this.unwrap(this.useCases.createAssessment(command));
  }

  createAssessmentDraft(
    command: Parameters<ProductComplianceUseCases["createAssessmentDraft"]>[0],
  ) {
    return this.unwrap(this.useCases.createAssessmentDraft(command));
  }

  reassessAssessment(
    command: Parameters<ProductComplianceUseCases["reassessAssessment"]>[0],
  ) {
    return this.unwrap(this.useCases.reassessAssessment(command));
  }

  reviewAssessment(
    command: Parameters<ProductComplianceUseCases["reviewAssessment"]>[0],
  ) {
    return this.unwrap(this.useCases.reviewAssessment(command));
  }

  listArtifacts(
    command: Parameters<ProductComplianceUseCases["listArtifacts"]>[0],
  ) {
    return this.unwrap(this.useCases.listArtifacts(command));
  }

  getArtifact(
    command: Parameters<ProductComplianceUseCases["getArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.getArtifact(command));
  }

  reserveArtifact(
    command: Parameters<ProductComplianceUseCases["reserveArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.reserveArtifact(command));
  }

  finalizeArtifact(
    command: Parameters<ProductComplianceUseCases["finalizeArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.finalizeArtifact(command));
  }

  reviewArtifact(
    command: Parameters<ProductComplianceUseCases["reviewArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.reviewArtifact(command));
  }

  publishArtifact(
    command: Parameters<ProductComplianceUseCases["publishArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.publishArtifact(command));
  }

  replaceArtifact(
    command: Parameters<ProductComplianceUseCases["replaceArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.replaceArtifact(command));
  }

  withdrawArtifact(
    command: Parameters<ProductComplianceUseCases["withdrawArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.withdrawArtifact(command));
  }

  updateArtifactMetadata(
    command: Parameters<ProductComplianceUseCases["updateArtifactMetadata"]>[0],
  ) {
    return this.unwrap(this.useCases.updateArtifactMetadata(command));
  }

  downloadArtifact(
    command: Parameters<ProductComplianceUseCases["downloadArtifact"]>[0],
  ) {
    return this.unwrap(this.useCases.downloadArtifact(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, ProductComplianceError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: ProductComplianceError): Error {
    const message = "Product compliance request could not be completed.";
    switch (error.code) {
      case "invalid_request":
        return new BadRequestException({ message, code: error.code });
      case "not_found":
        return new NotFoundException({ message, code: error.code });
      case "conflict":
      case "invalid_state":
      case "incomplete":
      case "blocked":
        return new ConflictException({ message, code: error.code });
      case "unavailable":
        return new ServiceUnavailableException({ message, code: error.code });
      case "malformed_provider":
        return new BadGatewayException({ message, code: error.code });
    }
  }
}
