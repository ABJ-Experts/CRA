import type {
  CreateTechnicalFileDeclarationDraftRequest,
  IssueTechnicalFileDeclarationRequest,
  ReissueTechnicalFileDeclarationRequest,
  TechnicalFileDeclaration,
  TechnicalFileDeclarationDownloadResponse,
  TechnicalFileDeclarationPreview,
} from "@repo/contracts/technical-files";

export const TECHNICAL_FILE_DECLARATION_REPOSITORY = Symbol(
  "TECHNICAL_FILE_DECLARATION_REPOSITORY",
);

/** Tenant-first declaration persistence boundary. Private paths never escape it. */
export interface TechnicalFileDeclarationRepository {
  preview(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ): Promise<TechnicalFileDeclarationPreview | null>;
  list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ): Promise<readonly TechnicalFileDeclaration[] | null>;
  saveDraft(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId?: string;
      } & CreateTechnicalFileDeclarationDraftRequest
    >,
  ): Promise<TechnicalFileDeclaration | null>;
  issue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & IssueTechnicalFileDeclarationRequest
    >,
  ): Promise<TechnicalFileDeclaration | null>;
  reissue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & ReissueTechnicalFileDeclarationRequest
    >,
  ): Promise<TechnicalFileDeclaration | null>;
  download(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      declarationId: string;
    }>,
  ): Promise<TechnicalFileDeclarationDownloadResponse | null>;
}

export class TechnicalFileDeclarationConflictError extends Error {
  constructor(readonly currentVersion: number | null = null) {
    super("The declaration changed.");
  }
}

export class TechnicalFileDeclarationInvalidRequestError extends Error {}
