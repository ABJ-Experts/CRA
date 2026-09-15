import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  ServiceUnavailableException,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import {
  confirmVulnerabilityOfflineBundleInputSchema,
  vulnerabilityOfflineBundleImportParamsSchema,
  vulnerabilityOfflineBundleImportResponseSchema,
  vulnerabilityOfflineBundlePreflightFieldsSchema,
  vulnerabilityOfflineBundlePreflightResponseSchema,
  vulnerabilityOfflineBundleImportStatusResponseSchema,
  type ConfirmVulnerabilityOfflineBundleInput,
  type VulnerabilityOfflineBundleImportParams,
  type VulnerabilityOfflineBundlePreflightFields,
} from "@repo/contracts/vulnerabilities";
import { diskStorage } from "multer";

import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import {
  OfflineBundleImportUnavailableError,
  OfflineBundleImportUseCases,
} from "./application/offline-bundle-import-use-cases";
import {
  OfflineBundlePreflightError,
  OfflineBundlePreflightService,
  offlineBundleManifestMaxBytes,
  offlineBundlePayloadMaxBytes,
  offlineBundleSignatureMaxBytes,
} from "./application/offline-bundle-preflight.service";

type MultipartFiles = Readonly<{
  manifest?: Express.Multer.File[];
  signature?: Express.Multer.File[];
  payloads?: Express.Multer.File[];
}>;

/** Admin-only deployment operation; its application service owns every effect. */
@Controller("vulnerability-feeds/offline-bundles")
@RequireRole("admin")
export class OfflineBundleImportsController {
  constructor(
    private readonly preflight: OfflineBundlePreflightService,
    private readonly imports: OfflineBundleImportUseCases,
  ) {}

  @Post("preflight")
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "manifest", maxCount: 1 },
        { name: "signature", maxCount: 1 },
        { name: "payloads", maxCount: 6 },
      ],
      {
        // Multipart names must remain equal to manifest paths (for example
        // `vendor/csaf.json`); the manifest parser rejects traversal and the
        // physical temporary filename is still a generated UUID.
        preservePath: true,
        storage: diskStorage({
          destination: (_request, _file, callback) => {
            mkdtemp(join(tmpdir(), "cra-vulnerability-bundle-"), callback);
          },
          filename: (_request, _file, callback) => callback(null, randomUUID()),
        }),
        limits: {
          fileSize: offlineBundlePayloadMaxBytes,
          files: 8,
          fields: 1,
          fieldSize: 128,
        },
      },
    ),
  )
  @ZodResponse(vulnerabilityOfflineBundlePreflightResponseSchema)
  async preflightBundle(
    @Body(zodBody(vulnerabilityOfflineBundlePreflightFieldsSchema))
    input: VulnerabilityOfflineBundlePreflightFields,
    @UploadedFiles() files: MultipartFiles | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    const manifest = oneFile(files?.manifest);
    const signature = oneFile(files?.signature);
    const payloads = files?.payloads ?? [];
    // The Zod pipe protects HTTP requests. Re-parse here so direct callers
    // (and a future non-HTTP adapter) still fail closed and release files.
    const parsedFields =
      vulnerabilityOfflineBundlePreflightFieldsSchema.safeParse(input);
    if (
      !parsedFields.success ||
      !manifest ||
      !signature ||
      payloads.length === 0
    ) {
      await cleanupRejectedUpload(files);
      throw this.badRequest("payload_inventory_invalid");
    }
    if (
      manifest.size > offlineBundleManifestMaxBytes ||
      signature.size > offlineBundleSignatureMaxBytes
    ) {
      await cleanupRejectedUpload(files);
      throw this.badRequest("payload_inventory_invalid");
    }
    try {
      return {
        import: await this.preflight.preflight({
          files: { manifest, signature, payloads },
          actorId: user.id,
          idempotencyKey: parsedFields.data.idempotencyKey,
          correlationId: randomUUID(),
        }),
      };
    } catch (error) {
      if (error instanceof OfflineBundlePreflightError) {
        throw this.badRequest(error.code);
      }
      throw this.unavailable(error);
    }
  }

  @Get(":importId")
  @ZodResponse(vulnerabilityOfflineBundleImportStatusResponseSchema)
  async status(
    @Param(zodParams(vulnerabilityOfflineBundleImportParamsSchema))
    params: VulnerabilityOfflineBundleImportParams,
  ) {
    try {
      return { import: await this.imports.get(params.importId) };
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  @Post(":importId/confirm")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(vulnerabilityOfflineBundleImportResponseSchema)
  async confirm(
    @Param(zodParams(vulnerabilityOfflineBundleImportParamsSchema))
    params: VulnerabilityOfflineBundleImportParams,
    @Body(zodBody(confirmVulnerabilityOfflineBundleInputSchema))
    input: ConfirmVulnerabilityOfflineBundleInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        import: await this.imports.confirm({
          importId: params.importId,
          actorId: user.id,
          idempotencyKey: input.idempotencyKey,
        }),
      };
    } catch (error) {
      throw this.unavailable(error);
    }
  }

  private badRequest(
    code: OfflineBundlePreflightError["code"],
  ): BadRequestException {
    return new BadRequestException({
      message: "The signed offline bundle could not be accepted.",
      code,
    });
  }

  private unavailable(error: unknown): ServiceUnavailableException {
    if (error instanceof OfflineBundleImportUnavailableError) {
      return new ServiceUnavailableException({
        message: "Offline bundle import is currently unavailable.",
        code: "unavailable",
      });
    }
    return new ServiceUnavailableException({
      message: "Offline bundle import is currently unavailable.",
      code: "unavailable",
    });
  }
}

function oneFile(
  files: Express.Multer.File[] | undefined,
): Express.Multer.File | null {
  return files?.length === 1 ? files[0]! : null;
}

async function cleanupRejectedUpload(
  files: MultipartFiles | undefined,
): Promise<void> {
  const directories = new Set(
    [
      ...(files?.manifest ?? []),
      ...(files?.signature ?? []),
      ...(files?.payloads ?? []),
    ].map((file) => dirname(file.path)),
  );
  await Promise.all(
    [...directories]
      .filter((directory) =>
        basename(directory).startsWith("cra-vulnerability-bundle-"),
      )
      .map(async (directory) => {
        try {
          await rm(directory, { force: true, recursive: true });
        } catch {
          // A rejected upload must not disclose or retain a host filesystem path.
        }
      }),
  );
}
