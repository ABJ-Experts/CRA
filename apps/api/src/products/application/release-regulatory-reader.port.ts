import type {
  Release,
  ReleaseMarketAvailability,
} from "@repo/contracts/products";

import type { Result } from "../../common/domain/result";
import type { ProductError } from "./product-use-cases";

export type ReleaseRegulatoryReadCommand = Readonly<{
  organizationId: string;
  actorId: string;
  productId: string;
  releaseId: string;
}>;

/** Published read boundary for reporting and retention owners. */
export interface ReleaseRegulatoryStateReader {
  getReleaseRegulatoryState(
    command: ReleaseRegulatoryReadCommand,
  ): Promise<Result<Readonly<{ release: Release }>, ProductError>>;
}

/** Published read boundary for release-level Member State consumers. */
export interface ReleaseMarketAvailabilityReader {
  getReleaseMarketAvailability(
    command: ReleaseRegulatoryReadCommand,
  ): Promise<
    Result<
      Readonly<{ marketAvailability: readonly ReleaseMarketAvailability[] }>,
      ProductError
    >
  >;
}

export const RELEASE_REGULATORY_STATE_READER = Symbol(
  "RELEASE_REGULATORY_STATE_READER",
);
export const RELEASE_MARKET_AVAILABILITY_READER = Symbol(
  "RELEASE_MARKET_AVAILABILITY_READER",
);
