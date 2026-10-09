import {
  productOwnerOptionsResponseSchema,
  type ProductOwnerOptionsQuery,
  type ProductOwnerOption,
  type ProductOwnerOptionsResponse,
} from "@repo/contracts/products";
export const PRODUCT_OWNER_DIRECTORY = Symbol("PRODUCT_OWNER_DIRECTORY");
export class ProductOwnerAccessDenied extends Error {}
export interface ProductOwnerDirectory {
  ownerForProduct(
    organizationId: string,
    productId: string,
  ): Promise<ProductOwnerOption | null>;
  list(
    organizationId: string,
    query: ProductOwnerOptionsQuery,
  ): Promise<ProductOwnerOptionsResponse>;
}
export class ProductOwnerOptions {
  constructor(private readonly directory: ProductOwnerDirectory) {}
  async list(
    organizationId: string,
    query: ProductOwnerOptionsQuery,
    canListOwners: boolean,
  ): Promise<ProductOwnerOptionsResponse> {
    if (query.productId) {
      const selectedOwner = await this.directory.ownerForProduct(
        organizationId,
        query.productId,
      );
      return productOwnerOptionsResponseSchema.parse({
        owners: {
          rows: [],
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          pageCount: 1,
        },
        selectedOwner,
      });
    }
    if (!canListOwners)
      throw new ProductOwnerAccessDenied("Owner directory access is required.");
    return productOwnerOptionsResponseSchema.parse(
      await this.directory.list(organizationId, query),
    );
  }
}
