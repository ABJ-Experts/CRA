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
  BrandingUseCases,
  type BrandingError,
} from "./application/branding-use-cases";

@Injectable()
export class BrandingService {
  constructor(private readonly useCases: BrandingUseCases) {}

  resolved(command: Parameters<BrandingUseCases["getResolved"]>[0]) {
    return this.unwrap(this.useCases.getResolved(command));
  }

  preview(command: Parameters<BrandingUseCases["getDraft"]>[0]) {
    return this.unwrap(this.useCases.getDraft(command));
  }

  uploadLogo(command: Parameters<BrandingUseCases["uploadLogo"]>[0]) {
    return this.unwrap(this.useCases.uploadLogo(command));
  }

  renderLogo(command: Parameters<BrandingUseCases["renderLogo"]>[0]) {
    return this.unwrap(this.useCases.renderLogo(command));
  }

  renderPublishedLogo(
    command: Parameters<BrandingUseCases["renderPublishedLogo"]>[0],
  ) {
    return this.unwrap(this.useCases.renderPublishedLogo(command));
  }

  saveDraft(command: Parameters<BrandingUseCases["saveDraft"]>[0]) {
    return this.unwrap(this.useCases.saveDraft(command));
  }

  publish(command: Parameters<BrandingUseCases["publish"]>[0]) {
    return this.unwrap(this.useCases.publish(command));
  }

  removeLogo(command: Parameters<BrandingUseCases["removeLogo"]>[0]) {
    return this.unwrap(this.useCases.removeLogo(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, BrandingError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: BrandingError): Error {
    const message = "Organization branding request could not be completed.";
    switch (error.code) {
      case "invalid_request":
      case "scanner_rejected":
        return new BadRequestException({ message, code: error.code });
      case "conflict":
        return new ConflictException({ message, code: "conflict" });
      case "not_found":
        return new NotFoundException({ message, code: "not_found" });
      case "unavailable":
        return new ServiceUnavailableException({
          message,
          code: "unavailable",
        });
      case "malformed_provider":
        return new BadGatewayException({
          message,
          code: "malformed_provider",
        });
    }
  }
}
