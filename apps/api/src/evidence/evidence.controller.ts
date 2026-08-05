import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, uploadEvidenceRequest } from '@repo/schemas';
import {
  ApiContract,
  C,
  CurrentPrincipal,
  RequirePermission,
  ZodValidationPipe,
} from '../common';
import type { Principal } from '../identity';
import { EvidenceService, type EvidenceView } from './evidence.service';

// MVP accepts base64 content in JSON (no multipart) — the StorageProvider stores
// the decoded bytes and the service hashes them at upload (FR-EVD-001/003).
const uploadSchema = z.object({
  title: z.string().min(1),
  classification: z
    .enum([
      'test_report',
      'conformity_assessment',
      'risk_assessment',
      'sbom_export',
      'vex_document',
      'audit_log',
      'other',
    ])
    .default('other'),
  productId: z.string().uuid().optional(),
  validFrom: z.string().date().optional(),
  validUntil: z.string().date().optional(),
  contentBase64: z.string().min(1),
  contentType: z.string().optional(),
});
type UploadDto = z.infer<typeof uploadSchema>;

@Controller('evidence')
export class EvidenceController {
  constructor(
    @Inject(EvidenceService) private readonly evidence: EvidenceService,
  ) {}

  @Get()
  @ApiContract({ response: C.Evidence, array: true })
  @RequirePermission(PERMISSIONS.EVIDENCE_READ)
  list(@CurrentPrincipal() p: Principal): Promise<EvidenceView[]> {
    return this.evidence.list(p.organisationId);
  }

  @Post()
  @ApiContract({
    response: C.Evidence,
    status: 201,
    body: uploadEvidenceRequest,
  })
  @RequirePermission(PERMISSIONS.EVIDENCE_WRITE)
  upload(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(uploadSchema)) dto: UploadDto,
  ): Promise<EvidenceView> {
    return this.evidence.upload(p.organisationId, p.userAccountId, {
      title: dto.title,
      classification: dto.classification,
      productId: dto.productId,
      validFrom: dto.validFrom,
      validUntil: dto.validUntil,
      content: Buffer.from(dto.contentBase64, 'base64'),
      contentType: dto.contentType,
    });
  }

  // FR-EVD-003: retrieval re-verifies the content hash (tamper detection).
  @Get(':id')
  @ApiContract({ response: C.Evidence })
  @RequirePermission(PERMISSIONS.EVIDENCE_READ)
  retrieve(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
  ): Promise<{ evidence: EvidenceView; signedUrl: string | null }> {
    return this.evidence.retrieve(p.organisationId, p.userAccountId, id);
  }
}
