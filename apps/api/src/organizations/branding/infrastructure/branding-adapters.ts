import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  BrandingRequestIdentityPort,
  BrandingScannerPort,
  BrandingScannerPolicyPort,
} from "../application/branding-use-cases";

/**
 * Placeholder for deployments without a connected scanner. Policy is decided
 * by `BrandingScannerPolicyPort`, so non-strict environments can still accept
 * already decoded raster-only logos while recording `scanner_not_available`.
 */
@Injectable()
export class UnavailableBrandingScannerAdapter implements BrandingScannerPort {
  scan(): Promise<Readonly<{ status: "unavailable" }>> {
    return Promise.resolve(Object.freeze({ status: "unavailable" as const }));
  }
}

@Injectable()
export class ConfigBrandingScannerPolicyAdapter implements BrandingScannerPolicyPort {
  constructor(private readonly config: ConfigService) {}

  isStrict(): boolean {
    return this.config.getOrThrow<boolean>("BRANDING_SCANNER_STRICT");
  }
}

@Injectable()
export class NodeBrandingRequestIdentityAdapter implements BrandingRequestIdentityPort {
  create(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
      operation: "publish_branding" | "remove_branding_logo";
    }>,
  ) {
    return Object.freeze({
      requestDigest: createHash("sha256")
        .update(
          JSON.stringify({
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey,
            operation: input.operation,
            organizationId: input.organizationId,
          }),
        )
        .digest("hex"),
    });
  }
}
