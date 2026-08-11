import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { Result } from "../../common/domain/result";
import {
  LegalEntityUseCases,
  type LegalEntityError,
} from "./application/legal-entity-use-cases";

@Injectable()
export class LegalEntitiesService {
  constructor(private readonly useCases: LegalEntityUseCases) {}

  list(organizationId: string, actorId: string) {
    return this.unwrap(this.useCases.list(organizationId, actorId));
  }

  get(command: Parameters<LegalEntityUseCases["get"]>[0]) {
    return this.unwrap(this.useCases.get(command));
  }

  create(command: Parameters<LegalEntityUseCases["create"]>[0]) {
    return this.unwrap(this.useCases.create(command));
  }

  update(command: Parameters<LegalEntityUseCases["update"]>[0]) {
    return this.unwrap(this.useCases.update(command));
  }

  transition(command: Parameters<LegalEntityUseCases["transition"]>[0]) {
    return this.unwrap(this.useCases.transition(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, LegalEntityError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: LegalEntityError): Error {
    const safeMessage =
      "Organization legal-entity request could not be completed.";
    switch (error.code) {
      case "invalid_request":
      case "invalid_authority":
      case "invalid_facts":
        return new BadRequestException({
          message: safeMessage,
          code: error.code,
        });
      case "conflict":
        return new ConflictException({
          message: safeMessage,
          code: "conflict",
          ...(error.current ? { current: error.current } : {}),
        });
      case "not_found":
        return new NotFoundException({
          message: safeMessage,
          code: "not_found",
        });
      case "invalid_state":
      case "inactive":
      case "incomplete":
        return new ConflictException({
          message: safeMessage,
          code: error.code,
        });
      case "dependency_blocked":
        return new ConflictException({
          message: safeMessage,
          code: "dependency_blocked",
          ...(error.reason ? { reason: error.reason } : {}),
        });
      case "unavailable":
        return new ServiceUnavailableException({
          message: safeMessage,
          code: "unavailable",
        });
      case "malformed_provider":
        return new BadGatewayException({
          message: safeMessage,
          code: "malformed_provider",
        });
    }
  }
}
