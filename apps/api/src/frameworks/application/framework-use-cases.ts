import type { z } from "zod";
import type {
  frameworkCatalogResponseSchema,
  frameworkTreeResponseSchema,
  frameworkSelectionResponseSchema,
  frameworkTreeQuerySchema,
  selectFrameworkInputSchema,
} from "@repo/contracts/frameworks";

export const FRAMEWORK_REPOSITORY = Symbol("FRAMEWORK_REPOSITORY");

export class FrameworkConflictError extends Error {}
export class FrameworkUpgradeRequiredError extends Error {}
export class FrameworkPackBlockedError extends Error {}
export class FrameworkForbiddenError extends Error {}
export class FrameworkInvalidRequestError extends Error {}

type Catalog = z.output<typeof frameworkCatalogResponseSchema>;
type Tree = z.output<typeof frameworkTreeResponseSchema>;
type Selection = z.output<typeof frameworkSelectionResponseSchema>;
type TreeQuery = z.output<typeof frameworkTreeQuerySchema>;
type SelectInput = z.output<typeof selectFrameworkInputSchema>;

export interface FrameworkRepository {
  catalog(orgId: string, actorId: string): Promise<Catalog>;
  tree(
    orgId: string,
    input: Readonly<
      { actorId: string; packKey: string; versionKey: string } & TreeQuery
    >,
  ): Promise<Tree | null>;
  select(
    orgId: string,
    input: Readonly<{ actorId: string; packKey: string } & SelectInput>,
  ): Promise<Selection>;
}

export class FrameworkUseCases {
  constructor(private readonly repository: FrameworkRepository) {}

  catalog(orgId: string, actorId: string): Promise<Catalog> {
    return this.repository.catalog(orgId, actorId);
  }

  tree(
    orgId: string,
    input: Readonly<
      { actorId: string; packKey: string; versionKey: string } & TreeQuery
    >,
  ): Promise<Tree | null> {
    return this.repository.tree(orgId, input);
  }

  select(
    orgId: string,
    input: Readonly<{ actorId: string; packKey: string } & SelectInput>,
  ): Promise<Selection> {
    return this.repository.select(orgId, input);
  }
}
