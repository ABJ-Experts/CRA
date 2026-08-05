import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  PERMISSIONS,
  createProductRequest,
  productListQuery,
  productTransitionRequest,
} from '@repo/schemas';
import {
  ApiContract,
  C,
  CurrentPrincipal,
  RequirePermission,
  ZodValidationPipe,
} from '../common';
import type { Principal } from '../identity';
import {
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  transitionLifecycle,
  type ProductView,
} from './product.service';

const createProductSchema = z.object({
  name: z.string().min(1),
  internalCode: z.string().min(1),
  productType: z
    .enum([
      'hardware_with_software',
      'standalone_software',
      'component',
      'remote_data_processing',
    ])
    .optional(),
});
type CreateProductDto = z.infer<typeof createProductSchema>;

const transitionSchema = z.object({
  to: z.enum([
    'development',
    'placed_on_market',
    'in_support',
    'end_of_support',
    'withdrawn',
  ]),
  placedOnMarketAt: z.string().datetime().optional(),
});
type TransitionDto = z.infer<typeof transitionSchema>;

@Controller('products')
export class ProductController {
  @Post()
  @ApiContract({ response: C.Product, status: 201, body: createProductRequest })
  @RequirePermission(PERMISSIONS.PRODUCT_CREATE)
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto,
  ): Promise<ProductView> {
    return createProduct(p.organisationId, p.userAccountId, dto);
  }

  @Get()
  @ApiContract({ response: C.Product, array: true, query: productListQuery })
  @RequirePermission(PERMISSIONS.PRODUCT_READ)
  list(
    @CurrentPrincipal() p: Principal,
    @Query('search') search?: string,
  ): Promise<ProductView[]> {
    return listProducts(p.organisationId, { search });
  }

  @Get(':id')
  @ApiContract({ response: C.Product })
  @RequirePermission(PERMISSIONS.PRODUCT_READ)
  async get(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
  ): Promise<ProductView> {
    const product = await getProduct(p.organisationId, id);
    if (!product) throw new NotFoundException();
    return product;
  }

  @Post(':id/transitions')
  @ApiContract({ response: C.Product, body: productTransitionRequest })
  @RequirePermission(PERMISSIONS.PRODUCT_UPDATE)
  transition(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionSchema)) dto: TransitionDto,
  ): Promise<ProductView> {
    return transitionLifecycle(
      p.organisationId,
      p.userAccountId,
      id,
      dto.to,
      dto.placedOnMarketAt ? new Date(dto.placedOnMarketAt) : undefined,
    );
  }

  @Delete(':id')
  @ApiContract({ response: C.Product })
  @RequirePermission(PERMISSIONS.PRODUCT_ARCHIVE)
  async archive(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
  ): Promise<{ archived: true }> {
    await archiveProduct(p.organisationId, p.userAccountId, id);
    return { archived: true };
  }
}
