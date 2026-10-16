import {
  customFrameworkImportSchema,
  customFrameworkValidationResponseSchema,
  type CustomFrameworkCommandInput,
  type CustomFrameworkCommandResponse,
  type CustomFrameworkContent,
  type CustomFrameworkDetailResponse,
  type CustomFrameworkListResponse,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

export const CUSTOM_FRAMEWORK_REPOSITORY = Symbol(
  "CUSTOM_FRAMEWORK_REPOSITORY",
);

export class CustomFrameworkConflictError extends Error {}
export class CustomFrameworkForbiddenError extends Error {}
export class CustomFrameworkNotFoundError extends Error {}
export class CustomFrameworkInvalidError extends Error {}
export class CustomFrameworkBlockedError extends Error {}

export interface CustomFrameworkRepository {
  list(
    orgId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<CustomFrameworkListResponse>;
  detail(
    orgId: string,
    actorId: string,
    draftId: string,
  ): Promise<CustomFrameworkDetailResponse>;
  exportVersion(
    orgId: string,
    actorId: string,
    draftId: string,
    versionKey: string,
  ): Promise<CustomFrameworkContent>;
  command(
    orgId: string,
    actorId: string,
    draftId: string | null,
    input: CustomFrameworkCommandInput,
  ): Promise<CustomFrameworkCommandResponse>;
  validate(
    orgId: string,
    actorId: string,
    content: CustomFrameworkContent,
  ): Promise<z.output<typeof customFrameworkValidationResponseSchema>>;
}

export class CustomFrameworkUseCases {
  constructor(private readonly repository: CustomFrameworkRepository) {}

  list(orgId: string, actorId: string, limit: number, offset: number) {
    return this.repository.list(orgId, actorId, limit, offset);
  }

  detail(orgId: string, actorId: string, draftId: string) {
    return this.repository.detail(orgId, actorId, draftId);
  }

  command(
    orgId: string,
    actorId: string,
    draftId: string | null,
    input: CustomFrameworkCommandInput,
  ) {
    return this.repository.command(orgId, actorId, draftId, input);
  }

  async validateImport(orgId: string, actorId: string, input: unknown) {
    const parsed = customFrameworkImportSchema.safeParse(input);
    if (!parsed.success) {
      return {
        valid: false as const,
        errors: parsed.error.issues.slice(0, 1_000).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
    }
    return this.repository.validate(orgId, actorId, parsed.data.content);
  }

  export(
    orgId: string,
    actorId: string,
    draftId: string,
    versionKey?: string,
  ): Promise<{
    schemaVersion: 1;
    kind: "customer_defined";
    content: CustomFrameworkContent;
  }> {
    const content = versionKey
      ? this.repository.exportVersion(orgId, actorId, draftId, versionKey)
      : this.detail(orgId, actorId, draftId).then((detail) => detail.content);
    return content.then((document) =>
      customFrameworkImportSchema.parse({
        schemaVersion: 1,
        kind: "customer_defined",
        content: document,
      }),
    );
  }
}
