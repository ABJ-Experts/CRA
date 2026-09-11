import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { Result } from "../common/domain/result";
import { SupplierSbomUseCases } from "./application/supplier-sbom-use-cases";
import type { SbomIntakeError } from "./application/sbom-intake-use-cases";

@Injectable()
export class SupplierSbomService {
  constructor(private readonly useCases: SupplierSbomUseCases) {}

  createRequest(command: Parameters<SupplierSbomUseCases["createRequest"]>[0]) {
    return this.unwrap(this.useCases.createRequest(command));
  }
  listRequests(command: Parameters<SupplierSbomUseCases["listRequests"]>[0]) {
    return this.unwrap(this.useCases.listRequests(command));
  }
  createInvitation(
    command: Parameters<SupplierSbomUseCases["createInvitation"]>[0],
  ) {
    return this.unwrap(this.useCases.createInvitation(command));
  }
  exchangeInvitation(
    command: Parameters<SupplierSbomUseCases["exchangeInvitation"]>[0],
  ) {
    return this.unwrap(this.useCases.exchangeInvitation(command));
  }
  initializeUpload(
    command: Parameters<SupplierSbomUseCases["initializeUpload"]>[0],
  ) {
    return this.unwrap(this.useCases.initializeUpload(command));
  }
  completeUpload(
    command: Parameters<SupplierSbomUseCases["completeUpload"]>[0],
  ) {
    return this.unwrap(this.useCases.completeUpload(command));
  }
  reviewSubmission(
    command: Parameters<SupplierSbomUseCases["reviewSubmission"]>[0],
  ) {
    return this.unwrap(this.useCases.reviewSubmission(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, SbomIntakeError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    const message = "Supplier SBOM request could not be completed.";
    return this.failure(result.error.code, message);
  }

  private failure(code: SbomIntakeError["code"], message: string): never {
    switch (code) {
      case "invalid_request":
        throw new BadRequestException({ message, code });
      case "not_found":
        throw new NotFoundException({ message, code });
      case "unavailable":
        throw new ServiceUnavailableException({ message, code });
      default:
        throw new ConflictException({ message, code });
    }
  }
}
