import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSIONS, createOrganisationRequest } from '@repo/schemas';
import {
  ApiContract,
  C,
  CurrentIdentity,
  CurrentPrincipal,
  RequireAuth,
  RequirePermission,
  ZodValidationPipe,
} from '../common';
import {
  ensureUserAccount,
  type AuthenticatedIdentity,
  type Principal,
} from '../identity';
import {
  createOrganisation,
  listMemberships,
  getOrganisation,
  type MembershipView,
  type OrganisationView,
} from './org.service';

// FR-API-002 — validated against the shared contract, not a local restatement.
type CreateOrgDto = z.infer<typeof createOrganisationRequest>;

@Controller('organisations')
export class OrgController {
  // Onboarding: an authenticated user with no org yet creates their first org.
  @Post()
  @ApiContract({
    response: C.CreatedResource,
    status: 201,
    body: createOrganisationRequest,
  })
  @RequireAuth()
  async create(
    @CurrentIdentity() identity: AuthenticatedIdentity,
    @Body(new ZodValidationPipe(createOrganisationRequest)) dto: CreateOrgDto,
  ): Promise<{ id: string }> {
    const userId = await ensureUserAccount(
      identity.supabaseUserId,
      identity.email,
    );
    return createOrganisation(userId, dto);
  }

  /**
   * The organisations this user belongs to, for the post-sign-in picker.
   *
   * @RequireAuth, not @RequirePermission: every permission is resolved FROM a
   * membership, so requiring one here would be circular — you could not read the
   * list you need in order to choose the org that grants you anything.
   */
  @Get()
  @ApiContract({ response: C.MembershipList })
  @RequireAuth()
  async memberships(
    @CurrentIdentity() identity: AuthenticatedIdentity,
  ): Promise<MembershipView[]> {
    return listMemberships(identity.supabaseUserId);
  }

  @Get('current')
  @ApiContract({ response: C.Organisation })
  @RequirePermission(PERMISSIONS.ORG_READ)
  async current(
    @CurrentPrincipal() principal: Principal,
  ): Promise<OrganisationView> {
    const org = await getOrganisation(principal.organisationId);
    if (!org) throw new NotFoundException();
    return org;
  }
}
