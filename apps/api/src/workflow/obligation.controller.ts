import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  PERMISSIONS,
  openObligationRequest,
  recordAnchorRequest,
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
  listObligations,
  listStages,
  openObligationFromFinding,
  recordAnchor,
  type ObligationView,
  type StageView,
  type TickResult,
} from './obligation.service';
import { WorkflowService } from './workflow.service';

const fromFindingSchema = z.object({
  findingId: z.string().uuid(),
  awarenessAt: z.string().datetime(),
});
type FromFindingDto = z.infer<typeof fromFindingSchema>;

const anchorSchema = z.object({
  anchor: z.enum(['remediation_available', 'notification_submitted']),
  at: z.string().datetime(),
});
type AnchorDto = z.infer<typeof anchorSchema>;

const tickSchema = z.object({ now: z.string().datetime().optional() });
type TickDto = z.infer<typeof tickSchema>;

@Controller('obligations')
export class ObligationController {
  constructor(
    @Inject(WorkflowService) private readonly workflow: WorkflowService,
  ) {}

  @Get()
  @ApiContract({ response: C.Obligation, array: true })
  @RequirePermission(PERMISSIONS.OBLIGATION_READ)
  list(@CurrentPrincipal() p: Principal): Promise<ObligationView[]> {
    return listObligations(p.organisationId);
  }

  @Get(':id/stages')
  @ApiContract({ response: C.ObligationStage, array: true })
  @RequirePermission(PERMISSIONS.OBLIGATION_READ)
  stages(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
  ): Promise<StageView[]> {
    return listStages(p.organisationId, id);
  }

  // FR-VULN-011: open an actively-exploited-vulnerability obligation from a KEV finding.
  @Post('from-finding')
  @ApiContract({
    response: C.Obligation,
    status: 201,
    body: openObligationRequest,
  })
  @RequirePermission(PERMISSIONS.OBLIGATION_MANAGE)
  fromFinding(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(fromFindingSchema)) dto: FromFindingDto,
  ): Promise<{ id: string }> {
    return openObligationFromFinding(
      p.organisationId,
      p.userAccountId,
      dto.findingId,
      new Date(dto.awarenessAt),
    );
  }

  @Post(':id/anchors')
  @ApiContract({
    response: C.ObligationStage,
    array: true,
    body: recordAnchorRequest,
  })
  @RequirePermission(PERMISSIONS.OBLIGATION_MANAGE)
  async anchor(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(anchorSchema)) dto: AnchorDto,
  ): Promise<{ recorded: true }> {
    await recordAnchor(
      p.organisationId,
      p.userAccountId,
      id,
      dto.anchor,
      new Date(dto.at),
    );
    return { recorded: true };
  }

  // FR-SLA-005: reconcile this org's obligations against the clock (escalations →
  // notifications via the Observer bus). The global scheduler is worker infra (V1).
  @Post('tick')
  @ApiContract({ response: C.ObligationTick })
  @RequirePermission(PERMISSIONS.OBLIGATION_MANAGE)
  tick(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodValidationPipe(tickSchema)) dto: TickDto,
  ): Promise<TickResult> {
    return this.workflow.tick(
      p.organisationId,
      dto.now ? new Date(dto.now) : new Date(),
    );
  }
}
