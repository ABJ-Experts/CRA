import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Result } from "../../common/domain/result";
import {
  TenantAdministrationUseCases,
  type TenantAdministrationError,
} from "./application/tenant-administration-use-cases";

@Injectable()
export class TenantAdministrationService {
  constructor(private readonly useCases: TenantAdministrationUseCases) {}

  settings(organizationId: string) {
    return this.unwrap(this.useCases.settings(organizationId));
  }

  settingsCatalog(organizationId: string) {
    return this.unwrap(this.useCases.settingsCatalog(organizationId));
  }

  updateSettings(
    command: Parameters<TenantAdministrationUseCases["updateSettings"]>[0],
  ) {
    return this.unwrap(this.useCases.updateSettings(command));
  }

  retention(organizationId: string) {
    return this.unwrap(this.useCases.retention(organizationId));
  }

  updateRetention(
    command: Parameters<TenantAdministrationUseCases["updateRetention"]>[0],
  ) {
    return this.unwrap(this.useCases.updateRetention(command));
  }

  requestExport(
    command: Parameters<TenantAdministrationUseCases["requestExport"]>[0],
  ) {
    return this.unwrap(this.useCases.requestExport(command));
  }

  exportStatus(
    command: Parameters<TenantAdministrationUseCases["exportStatus"]>[0],
  ) {
    return this.unwrap(this.useCases.exportStatus(command));
  }

  latestExport(organizationId: string) {
    return this.unwrap(this.useCases.latestExport(organizationId));
  }

  downloadExport(
    command: Parameters<TenantAdministrationUseCases["downloadExport"]>[0],
  ) {
    return this.unwrap(this.useCases.downloadExport(command));
  }

  lifecycle(organizationId: string) {
    return this.unwrap(this.useCases.lifecycle(organizationId));
  }

  reauthenticate(
    command: Parameters<TenantAdministrationUseCases["reauthenticate"]>[0],
  ) {
    return this.unwrap(this.useCases.reauthenticate(command));
  }

  deactivate(
    command: Parameters<TenantAdministrationUseCases["deactivate"]>[0],
  ) {
    return this.unwrap(this.useCases.deactivate(command));
  }

  schedulePurge(
    command: Parameters<TenantAdministrationUseCases["schedulePurge"]>[0],
  ) {
    return this.unwrap(this.useCases.schedulePurge(command));
  }

  recover(command: Parameters<TenantAdministrationUseCases["recover"]>[0]) {
    return this.unwrap(this.useCases.recover(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, TenantAdministrationError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: TenantAdministrationError): Error {
    const safeMessage =
      "Organization administration request could not be completed.";
    switch (error.code) {
      case "invalid_request":
      case "mfa_not_ready":
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
      case "forbidden":
      case "invalid_grant":
      case "mfa_required":
        return new ForbiddenException({
          message: safeMessage,
          code: error.code,
        });
      case "invalid_state":
        return new ConflictException({
          message: safeMessage,
          code: error.code,
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
