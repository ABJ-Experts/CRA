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
  ProductUseCases,
  type ProductError,
} from "./application/product-use-cases";

@Injectable()
export class ProductsService {
  constructor(private readonly useCases: ProductUseCases) {}

  list(
    organizationId: string,
    actorId: string,
    query: Parameters<ProductUseCases["list"]>[2],
  ) {
    return this.unwrap(this.useCases.list(organizationId, actorId, query));
  }
  get(command: Parameters<ProductUseCases["get"]>[0]) {
    return this.unwrap(this.useCases.get(command));
  }
  create(command: Parameters<ProductUseCases["create"]>[0]) {
    return this.unwrap(this.useCases.create(command));
  }
  update(command: Parameters<ProductUseCases["update"]>[0]) {
    return this.unwrap(this.useCases.update(command));
  }
  assignLegalEntity(
    command: Parameters<ProductUseCases["assignLegalEntity"]>[0],
  ) {
    return this.unwrap(this.useCases.assignLegalEntity(command));
  }
  archive(command: Parameters<ProductUseCases["archive"]>[0]) {
    return this.unwrap(this.useCases.archive(command));
  }
  listReleases(command: Parameters<ProductUseCases["listReleases"]>[0]) {
    return this.unwrap(this.useCases.listReleases(command));
  }
  getRelease(command: Parameters<ProductUseCases["getRelease"]>[0]) {
    return this.unwrap(this.useCases.getRelease(command));
  }
  createRelease(command: Parameters<ProductUseCases["createRelease"]>[0]) {
    return this.unwrap(this.useCases.createRelease(command));
  }
  updateRelease(command: Parameters<ProductUseCases["updateRelease"]>[0]) {
    return this.unwrap(this.useCases.updateRelease(command));
  }
  archiveRelease(command: Parameters<ProductUseCases["archiveRelease"]>[0]) {
    return this.unwrap(this.useCases.archiveRelease(command));
  }
  listMemberStates(
    command: Parameters<ProductUseCases["listMemberStates"]>[0],
  ) {
    return this.unwrap(this.useCases.listMemberStates(command));
  }
  getReleaseMarketAvailability(
    command: Parameters<ProductUseCases["getReleaseMarketAvailability"]>[0],
  ) {
    return this.unwrap(this.useCases.getReleaseMarketAvailability(command));
  }
  addReleaseMarketAvailability(
    command: Parameters<ProductUseCases["addReleaseMarketAvailability"]>[0],
  ) {
    return this.unwrap(this.useCases.addReleaseMarketAvailability(command));
  }
  removeReleaseMarketAvailability(
    command: Parameters<ProductUseCases["removeReleaseMarketAvailability"]>[0],
  ) {
    return this.unwrap(this.useCases.removeReleaseMarketAvailability(command));
  }
  correctReleaseMarketAvailability(
    command: Parameters<ProductUseCases["correctReleaseMarketAvailability"]>[0],
  ) {
    return this.unwrap(this.useCases.correctReleaseMarketAvailability(command));
  }
  transitionReleaseLifecycle(
    command: Parameters<ProductUseCases["transitionReleaseLifecycle"]>[0],
  ) {
    return this.unwrap(this.useCases.transitionReleaseLifecycle(command));
  }
  correctPlacedOnMarketDate(
    command: Parameters<ProductUseCases["correctPlacedOnMarketDate"]>[0],
  ) {
    return this.unwrap(this.useCases.correctPlacedOnMarketDate(command));
  }
  getReleaseLifecycleTimeline(
    command: Parameters<ProductUseCases["getReleaseLifecycleTimeline"]>[0],
  ) {
    return this.unwrap(this.useCases.getReleaseLifecycleTimeline(command));
  }
  getSupportPeriods(
    command: Parameters<ProductUseCases["getSupportPeriods"]>[0],
  ) {
    return this.unwrap(this.useCases.getSupportPeriods(command));
  }
  previewSupportPeriodChange(
    command: Parameters<ProductUseCases["previewSupportPeriodChange"]>[0],
  ) {
    return this.unwrap(this.useCases.previewSupportPeriodChange(command));
  }
  createSupportPeriod(
    command: Parameters<ProductUseCases["createSupportPeriod"]>[0],
  ) {
    return this.unwrap(this.useCases.createSupportPeriod(command));
  }
  supersedeSupportPeriod(
    command: Parameters<ProductUseCases["supersedeSupportPeriod"]>[0],
  ) {
    return this.unwrap(this.useCases.supersedeSupportPeriod(command));
  }
  getProductRetentionCalculation(
    command: Parameters<ProductUseCases["getProductRetentionCalculation"]>[0],
  ) {
    return this.unwrap(this.useCases.getProductRetentionCalculation(command));
  }
  getSupportAlertHistory(
    command: Parameters<ProductUseCases["getSupportAlertHistory"]>[0],
  ) {
    return this.unwrap(this.useCases.getSupportAlertHistory(command));
  }
  getSupportAlertIntervals(
    command: Parameters<ProductUseCases["getSupportAlertIntervals"]>[0],
  ) {
    return this.unwrap(this.useCases.getSupportAlertIntervals(command));
  }
  updateSupportAlertIntervals(
    command: Parameters<ProductUseCases["updateSupportAlertIntervals"]>[0],
  ) {
    return this.unwrap(this.useCases.updateSupportAlertIntervals(command));
  }

  private async unwrap<T>(
    pending: Promise<Result<T, ProductError>>,
  ): Promise<T> {
    const result = await pending;
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: ProductError): Error {
    const message = "Product registry request could not be completed.";
    switch (error.code) {
      case "invalid_request":
        return new BadRequestException({ message, code: error.code });
      case "not_found":
      case "market_availability_not_found":
        return new NotFoundException({ message, code: error.code });
      case "conflict":
        return new ConflictException({
          message,
          code: error.code,
          ...(error.current ? { current: error.current } : {}),
        });
      case "invalid_state":
      case "dependency_blocked":
      case "inactive":
      case "incomplete":
      case "invalid_transition":
      case "placement_requires_placed_on_market_at":
      case "placement_requires_active_market_availability":
      case "placed_on_market_date_not_set":
      case "member_state_unavailable":
        return new ConflictException({ message, code: error.code });
      case "unavailable":
        return new ServiceUnavailableException({ message, code: error.code });
      case "malformed_provider":
        return new BadGatewayException({ message, code: error.code });
    }
  }
}
