import { MODULE_METADATA } from "@nestjs/common/constants";

import {
  RELEASE_MARKET_AVAILABILITY_READER,
  RELEASE_REGULATORY_STATE_READER,
} from "./application/release-regulatory-reader.port";
import {
  PRODUCT_RETENTION_PROJECTION,
  PRODUCT_RETENTION_READER,
} from "./application/product-retention-reader.port";
import { PRODUCT_RELATIONSHIP_RESOLVER } from "./application/product-relationship-reader.port";
import {
  PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
  PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
} from "./application/product-relationship-worker.port";
import { ProductUseCases } from "./application/product-use-cases";
import { SupabaseProductRelationshipWorkerAdapter } from "./infrastructure/supabase-product-relationship-worker.adapter";
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
    expect(providers).toContainEqual({
      provide: PRODUCT_RETENTION_READER,
      useExisting: ProductUseCases,
    });
    expect(providers).toContainEqual({
      provide: PRODUCT_RETENTION_PROJECTION,
      useExisting: ProductUseCases,
    });
    expect(providers).toContainEqual({
      provide: PRODUCT_RELATIONSHIP_RESOLVER,
      useExisting: ProductUseCases,
    });
    expect(providers).toContainEqual({
      provide: PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
      useExisting: SupabaseProductRelationshipWorkerAdapter,
    });
    expect(providers).toContainEqual({
      provide: PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
      useExisting: SupabaseProductRelationshipWorkerAdapter,
    });
    expect(exports).toEqual(
      expect.arrayContaining([
        RELEASE_REGULATORY_STATE_READER,
        RELEASE_MARKET_AVAILABILITY_READER,
        PRODUCT_RETENTION_READER,
        PRODUCT_RETENTION_PROJECTION,
        PRODUCT_RELATIONSHIP_RESOLVER,
        PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER,
        PRODUCT_RELATIONSHIP_PROPAGATION_WORKER,
      ]),
    );
  });
});
