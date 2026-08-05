import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  PERMISSIONS,
  falsePositiveRequest,
  findingListQuery,
  findingTransitionRequest,
  vexAssessmentRequest,
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
  falsePositiveRates,
  getFinding,
  listFindings,
  markFalsePositive,
  recordVexAssessment,
  transitionFindingState,
  type FalsePositiveRate,
  type FindingPage,
  type FindingView,
} from './triage.service';

// FR-API-002: the boundary validates against the SHARED schema. These were
// previously restated inline here, which is how the published contract and the
// UI's idea of it drifted apart in the first place.
type FindingListQuery = z.infer<typeof findingListQuery>;
type TransitionDto = z.infer<typeof findingTransitionRequest>;
type VexDto = z.infer<typeof vexAssessmentRequest>;
type FalsePositiveDto = z.infer<typeof falsePositiveRequest>;

@Controller('findings')
export class TriageController {
  @Get()
  @ApiContract({ response: C.FindingPage, query: findingListQuery })
  @RequirePermission(PERMISSIONS.FINDING_READ)
  list(
    @CurrentPrincipal() p: Principal,
    @Query(new ZodValidationPipe(findingListQuery))
    query: FindingListQuery,
  ): Promise<FindingPage> {
    return listFindings(p.organisationId, query);
  }

  // Declared before ':id' so the literal path is not swallowed by the param route.
  @Get('false-positive-rates')
  @ApiContract({ response: C.FalsePositiveRate, array: true })
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  rates(@CurrentPrincipal() p: Principal): Promise<FalsePositiveRate[]> {
    return falsePositiveRates(p.organisationId);
  }

  @Get(':id')
  @ApiContract({ response: C.Finding })
  @RequirePermission(PERMISSIONS.FINDING_READ)
  async get(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
  ): Promise<FindingView> {
    const found = await getFinding(p.organisationId, id);
    if (!found) throw new NotFoundException();
    return found;
  }

  @Post(':id/transitions')
  @ApiContract({ response: C.Finding, body: findingTransitionRequest })
  @RequirePermission(PERMISSIONS.FINDING_TRIAGE)
  transition(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(findingTransitionRequest)) dto: TransitionDto,
  ): Promise<FindingView> {
    return transitionFindingState(
      p.organisationId,
      p.userAccountId,
      id,
      dto.to,
      {
        reason: dto.reason,
        suppressionExpiresAt: dto.suppressionExpiresAt
          ? new Date(dto.suppressionExpiresAt)
          : undefined,
      },
    );
  }

  @Post(':id/vex')
  @ApiContract({ response: C.Finding, body: vexAssessmentRequest })
  @RequirePermission(PERMISSIONS.FINDING_ASSESS)
  vex(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(vexAssessmentRequest)) dto: VexDto,
  ): Promise<FindingView> {
    return recordVexAssessment(p.organisationId, p.userAccountId, id, dto);
  }

  // FR-MATCH-004. Separate from /vex on purpose: a VEX assessment judges the
  // PRODUCT, this judges the MATCHER. Only the latter is a quality signal.
  @Post(':id/false-positive')
  @ApiContract({ response: C.Finding, body: falsePositiveRequest })
  @RequirePermission(PERMISSIONS.FINDING_TRIAGE)
  falsePositive(
    @CurrentPrincipal() p: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(falsePositiveRequest)) dto: FalsePositiveDto,
  ): Promise<FindingView> {
    return markFalsePositive(p.organisationId, p.userAccountId, id, dto.reason);
  }
}
