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
  ProductImportUseCases,
  type ImportUseCaseError,
} from "./product-release-import-use-cases";

@Injectable()
export class ProductImportsService {
  constructor(private readonly useCases: ProductImportUseCases) {}

  template() {
    return this.useCases.template();
  }

  dryRun(command: Parameters<ProductImportUseCases["dryRun"]>[0]) {
    return this.unwrap(this.useCases.dryRun(command));
  }

  list(command: Parameters<ProductImportUseCases["list"]>[0]) {
    return this.unwrap(this.useCases.list(command));
  }

  get(command: Parameters<ProductImportUseCases["get"]>[0]) {
    return this.unwrap(this.useCases.get(command));
  }

  rows(command: Parameters<ProductImportUseCases["rows"]>[0]) {
    return this.unwrap(this.useCases.rows(command));
  }

  report(command: Parameters<ProductImportUseCases["report"]>[0]) {
    return this.unwrap(this.useCases.report(command));
  }

  commit(command: Parameters<ProductImportUseCases["commit"]>[0]) {
    return this.unwrap(this.useCases.commit(command));
  }

  cancel(command: Parameters<ProductImportUseCases["cancel"]>[0]) {
    return this.unwrap(this.useCases.cancel(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, ImportUseCaseError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    const message = "Product import request could not be completed.";
    switch (result.error.code) {
      case "invalid_request":
        return Promise.reject(
          new BadRequestException({
            message,
            code: result.error.code,
          }),
        );
      case "not_found":
        return Promise.reject(
          new NotFoundException({ message, code: result.error.code }),
        );
      case "conflict":
      case "idempotency_mismatch":
      case "source_missing":
      case "content_hash_mismatch":
        return Promise.reject(
          new ConflictException({ message, code: result.error.code }),
        );
      case "malformed_provider":
        return Promise.reject(
          new BadGatewayException({ message, code: result.error.code }),
        );
      case "unavailable":
        return Promise.reject(
          new ServiceUnavailableException({
            message,
            code: result.error.code,
          }),
        );
    }
  }
}
