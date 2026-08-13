import { MODULE_METADATA } from "@nestjs/common/constants";

import {
  RELEASE_MARKET_AVAILABILITY_READER,
  RELEASE_REGULATORY_STATE_READER,
} from "./application/release-regulatory-reader.port";
import { ProductUseCases } from "./application/product-use-cases";
import { ProductsModule } from "./products.module";

describe("ProductsModule regulatory readers", () => {
  it("exports only application-owned release read boundaries", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ProductsModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      ProductsModule,
    ) as unknown[];

    expect(providers).toContainEqual({
      provide: RELEASE_REGULATORY_STATE_READER,
      useExisting: ProductUseCases,
    });
    expect(providers).toContainEqual({
      provide: RELEASE_MARKET_AVAILABILITY_READER,
      useExisting: ProductUseCases,
    });
    expect(exports).toEqual(
      expect.arrayContaining([
        RELEASE_REGULATORY_STATE_READER,
        RELEASE_MARKET_AVAILABILITY_READER,
      ]),
    );
  });
});
