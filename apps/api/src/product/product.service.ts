import { and, eq, ilike, isNull, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { product, withTenant } from '../db';
import { recordAuditInTx } from '../audit';

export type LifecycleState =
  | 'development'
  | 'placed_on_market'
  | 'in_support'
  | 'end_of_support'
  | 'withdrawn';

export type ProductType =
  | 'hardware_with_software'
  | 'standalone_software'
  | 'component'
  | 'remote_data_processing';

// Product lifecycle State machine (BRD §8.4). Deterministic, validated here so
// status is never an ad-hoc write. Moving to placed_on_market requires a date
// that starts the 10-year retention clock (FR-PROD-006).
const LIFECYCLE_TRANSITIONS: Record<LifecycleState, readonly LifecycleState[]> =
  {
    development: ['placed_on_market'],
    placed_on_market: ['in_support', 'withdrawn'],
    in_support: ['end_of_support', 'withdrawn'],
    end_of_support: ['withdrawn'],
    withdrawn: [],
  };

export function canTransition(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  return LIFECYCLE_TRANSITIONS[from].includes(to);
}

// Typed domain error, mapped centrally to RFC 9457 (§26.3: no ad-hoc throws).
export class DomainError extends Error {
  constructor(
    readonly code:
      'not_found' | 'conflict' | 'validation' | 'invalid_transition',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export interface CreateProductInput {
  name: string;
  internalCode: string;
  productType?: ProductType;
}

export interface ProductView {
  id: string;
  name: string;
  internalCode: string;
  productType: string;
  lifecycleState: string;
  placedOnMarketAt: Date | null;
  version: number;
}

function toView(row: typeof product.$inferSelect): ProductView {
  return {
    id: row.id,
    name: row.name,
    internalCode: row.internalCode,
    productType: row.productType,
    lifecycleState: row.lifecycleState,
    placedOnMarketAt: row.placedOnMarketAt,
    version: row.version,
  };
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  const causeCode = (e as { cause?: { code?: string } }).cause?.code;
  return code === '23505' || causeCode === '23505';
}

export async function createProduct(
  organisationId: string,
  userAccountId: string,
  input: CreateProductInput,
): Promise<ProductView> {
  const id = uuidv7();
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    let row: typeof product.$inferSelect | undefined;
    try {
      [row] = await tx
        .insert(product)
        .values({
          id,
          organisationId,
          name: input.name,
          internalCode: input.internalCode,
          productType: input.productType ?? 'standalone_software',
          createdBy: userAccountId,
          updatedBy: userAccountId,
        })
        .returning();
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new DomainError(
          'conflict',
          `A product with internal code "${input.internalCode}" already exists`,
        );
      }
      throw e;
    }
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'product.created',
      resourceType: 'product',
      resourceId: id,
      afterState: { name: input.name, internalCode: input.internalCode },
    });
    // A single-row INSERT ... RETURNING always yields a row; anything else means
    // the audit event above describes a product that was never written.
    if (!row) throw new Error('product insert returned no row');
    return toView(row);
  });
}

export interface ProductFilter {
  search?: string;
  lifecycleState?: LifecycleState;
  includeArchived?: boolean;
}

// Repository + Specification: filters compose into a single WHERE (tenant-scoped by RLS).
export async function listProducts(
  organisationId: string,
  filter: ProductFilter = {},
): Promise<ProductView[]> {
  return withTenant({ organisationId }, async (tx) => {
    const conditions: SQL[] = [];
    if (!filter.includeArchived) conditions.push(isNull(product.deletedAt));
    if (filter.lifecycleState)
      conditions.push(eq(product.lifecycleState, filter.lifecycleState));
    if (filter.search)
      conditions.push(ilike(product.name, `%${filter.search}%`));
    const rows = await tx
      .select()
      .from(product)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(product.createdAt);
    return rows.map(toView);
  });
}

export async function getProduct(
  organisationId: string,
  id: string,
): Promise<ProductView | null> {
  return withTenant({ organisationId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(product)
      .where(and(eq(product.id, id), isNull(product.deletedAt)))
      .limit(1);
    return row ? toView(row) : null;
  });
}

export async function transitionLifecycle(
  organisationId: string,
  userAccountId: string,
  id: string,
  to: LifecycleState,
  placedOnMarketAt?: Date,
): Promise<ProductView> {
  return withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [row] = await tx
      .select()
      .from(product)
      .where(and(eq(product.id, id), isNull(product.deletedAt)))
      .limit(1);
    if (!row) throw new DomainError('not_found', 'Product not found');

    const from = row.lifecycleState as LifecycleState;
    if (!canTransition(from, to)) {
      throw new DomainError(
        'invalid_transition',
        `Cannot move product from ${from} to ${to}`,
      );
    }
    if (to === 'placed_on_market' && !placedOnMarketAt) {
      throw new DomainError(
        'validation',
        'placed_on_market requires a placedOnMarketAt date',
      );
    }

    const [updated] = await tx
      .update(product)
      .set({
        lifecycleState: to,
        placedOnMarketAt:
          to === 'placed_on_market' ? placedOnMarketAt : row.placedOnMarketAt,
        version: row.version + 1,
        updatedBy: userAccountId,
        updatedAt: new Date(),
      })
      .where(and(eq(product.id, id), eq(product.version, row.version)))
      .returning();
    if (!updated)
      throw new DomainError('conflict', 'Product was modified concurrently');

    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'product.lifecycle_changed',
      resourceType: 'product',
      resourceId: id,
      beforeState: { lifecycleState: from },
      afterState: { lifecycleState: to },
    });
    return toView(updated);
  });
}

export async function archiveProduct(
  organisationId: string,
  userAccountId: string,
  id: string,
): Promise<void> {
  await withTenant({ organisationId, userId: userAccountId }, async (tx) => {
    const [updated] = await tx
      .update(product)
      .set({
        deletedAt: new Date(),
        updatedBy: userAccountId,
        updatedAt: new Date(),
      })
      .where(and(eq(product.id, id), isNull(product.deletedAt)))
      .returning({ id: product.id });
    if (!updated) throw new DomainError('not_found', 'Product not found');
    await recordAuditInTx(tx, organisationId, {
      actorType: 'user',
      actorId: userAccountId,
      action: 'product.archived',
      resourceType: 'product',
      resourceId: id,
    });
  });
}
