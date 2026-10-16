import type {
  AddTechnicalFileSourceRequest,
  CreateTechnicalFileRequest,
  TechnicalFile,
  TechnicalFileSection,
  UpdateTechnicalFileSectionRequest,
} from "@repo/contracts/technical-files";

export const TECHNICAL_FILE_REPOSITORY = Symbol("TECHNICAL_FILE_REPOSITORY");

/** Tenant-first persistence boundary. Mutations are durable RPC transactions. */
export interface TechnicalFileRepository {
  get(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ): Promise<TechnicalFile | null>;
  create(
    organizationId: string,
    input: Readonly<
      { actorId: string; productId: string } & CreateTechnicalFileRequest
    >,
  ): Promise<TechnicalFile | null>;
  getSection(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; sectionKey: string }>,
  ): Promise<TechnicalFileSection | null>;
  updateSection(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & UpdateTechnicalFileSectionRequest
    >,
  ): Promise<TechnicalFileSection | null>;
  addSource(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        sectionKey: string;
      } & AddTechnicalFileSourceRequest
    >,
  ): Promise<TechnicalFileSection | null>;
  removeSource(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      sectionKey: string;
      sourceId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>,
  ): Promise<TechnicalFileSection | null>;
}

export class TechnicalFileConflictError extends Error {
  constructor(readonly section: TechnicalFileSection | null = null) {
    super("The technical-file section changed.");
  }
}

export class TechnicalFileInvalidRequestError extends Error {}

export class TechnicalFileProductUnavailableError extends Error {
  constructor() {
    super("The product is unavailable in this organization.");
    this.name = "TechnicalFileProductUnavailableError";
  }
}
