import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  PERMISSIONS,
  createReleaseRequest,
  releaseListQuery,
  uploadSbomRequest,
} from '@repo/schemas';
import {
  ApiContract,
  C,
  CurrentPrincipal,
  RequirePermission,
  ZodValidationPipe,
} from '../common';
import type { Principal } from '../identity';
import { matchRelease, type MatchReleaseResult } from '../vuln';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage';
import {
  createRelease,
  ingestSbom,
  listReleases,
  type IngestResult,
  type ReleaseView,
} from './sbom.service';

const createReleaseSchema = z.object({
  productId: z.string().uuid(),
  versionLabel: z.string().min(1),
});
type CreateReleaseDto = z.infer<typeof createReleaseSchema>;

const ingestSchema = z.object({
  // Raw SBOM document as a string (CycloneDX/SPDX JSON). Stored byte-exact.
  document: z.string().min(1),
  source: z.string().optional(),
});
type IngestDto = z.infer<typeof ingestSchema>;

@Controller('releases')
export class SbomController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  @Get()
  @ApiContract({ response: C.Release, array: true, query: releaseListQuery })
  @RequirePermission(PERMISSIONS.SBOM_READ)
  list(
    @CurrentPrincipal() p: Principal,
    @Query('productId') productId?: string,
  ): Promise<ReleaseView[]> {
    return listReleases(p.organisationId, productId);
  }

  @Post()
  @ApiContract({ response: C.Release, status: 201, body: createReleaseRequest })
  @RequirePermission(PERMISSIONS.SBOM_UPLOAD)
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(createReleaseSchema)) dto: CreateReleaseDto,
  ): Promise<{ id: string }> {
    return createRelease(
      p.organisationId,
      p.userAccountId,
      dto.productId,
      dto.versionLabel,
    );
  }

  // FR-SBOM-002/003 + FR-VULN-004: ingest, then run matching so findings appear
  // in one call (the ingest→match pipeline; §10 is deterministic).
  @Post(':id/sbom')
  @ApiContract({ response: C.SbomIngest, status: 201, body: uploadSbomRequest })
  @RequirePermission(PERMISSIONS.SBOM_UPLOAD)
  async ingest(
    @CurrentPrincipal() p: Principal,
    @Param('id') releaseId: string,
    @Body(new ZodValidationPipe(ingestSchema)) dto: IngestDto,
  ): Promise<{ ingest: IngestResult; match: MatchReleaseResult }> {
    const ingest = await ingestSbom(
      p.organisationId,
      p.userAccountId,
      releaseId,
      dto.document,
      this.storage,
      dto.source,
    );
    const match = await matchRelease(
      p.organisationId,
      p.userAccountId,
      releaseId,
    );
    return { ingest, match };
  }
}
