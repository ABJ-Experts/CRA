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
  FindingPropagationUseCases,
  type FindingPropagationError,
} from "./application/finding-propagation-use-cases";

@Injectable()
export class FindingsService {
  constructor(private readonly useCases: FindingPropagationUseCases) {}

  registerSource(
    command: Parameters<FindingPropagationUseCases["registerSource"]>[0],
  ) {
    return this.unwrap(this.useCases.registerSource(command));
  }

  updateSource(
    command: Parameters<FindingPropagationUseCases["updateSource"]>[0],
  ) {
    return this.unwrap(this.useCases.updateSource(command));
  }

  getProductImpactSummary(
    command: Parameters<
      FindingPropagationUseCases["getProductImpactSummary"]
    >[0],
  ) {
    return this.unwrap(this.useCases.getProductImpactSummary(command));
  }

  createProductImpactOverride(
    command: Parameters<
      FindingPropagationUseCases["createProductImpactOverride"]
    >[0],
  ) {
    return this.unwrap(this.useCases.createProductImpactOverride(command));
  }

  endProductImpactOverride(
    command: Parameters<
      FindingPropagationUseCases["endProductImpactOverride"]
    >[0],
  ) {
    return this.unwrap(this.useCases.endProductImpactOverride(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, FindingPropagationError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: FindingPropagationError): Error {
    const message = "Finding propagation request could not be completed.";
    switch (error.code) {
      case "invalid_request":
        return new BadRequestException({ message, code: error.code });
      case "not_found":
        // Tenant-scoped lookups deliberately collapse foreign tenants and
        // absent records to the same response.
        return new NotFoundException({ message, code: error.code });
      case "conflict":
      case "idempotency_mismatch":
        return new ConflictException({ message, code: error.code });
      case "unavailable":
        return new ServiceUnavailableException({ message, code: error.code });
      case "malformed_provider":
        return new BadGatewayException({ message, code: error.code });
    }
  }
}
