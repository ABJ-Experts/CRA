import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { AgentRepositoryError } from "./supabase-agent.repository";

export function agentHttpError(error: unknown): Error {
  if (!(error instanceof AgentRepositoryError))
    return error instanceof Error
      ? error
      : new ServiceUnavailableException({ code: "unavailable" });
  const body = {
    code: error.code,
    message: "Agent request could not be completed.",
  };
  switch (error.code) {
    case "not_found":
      return new NotFoundException(body);
    case "invalid_enrollment":
    case "invalid_token":
    case "expired":
    case "token_expired":
    case "token_consumed":
      return new GoneException(body);
    case "forbidden":
    case "forbidden_by_policy":
      return new ForbiddenException(body);
    case "invalid_request":
      return new BadRequestException(body);
    case "revoked":
    case "identity_mismatch":
    case "key_expired":
      return new UnauthorizedException(body);
    case "replacement_requires_new_connector":
      return new ConflictException({
        code: error.code,
        message:
          "This connector has a retired agent. Create a new connector and reconcile its source checkpoint before enrolling a replacement.",
      });
    case "conflict":
    case "identity_revoked":
    case "replay":
    case "sequence_gap":
    case "sequence_conflict":
    case "rotation_in_progress":
    case "idempotency_mismatch":
    case "idempotency_conflict":
    case "invalid_state":
      return new ConflictException(body);
    case "backpressure":
      return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
    default:
      return new ServiceUnavailableException({
        code: "unavailable",
        message: body.message,
      });
  }
}
