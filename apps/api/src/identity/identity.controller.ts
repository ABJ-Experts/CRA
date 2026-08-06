import { Controller, Get } from '@nestjs/common';
import { ApiContract, C, CurrentPrincipal, RequirePermission } from '../common';
import { PERMISSIONS } from '@repo/schemas';
import type { Principal } from './auth.service';

/** Current active-organisation capabilities for presentation-layer gating. */
@Controller('identity')
export class IdentityController {
  @Get('current')
  @RequirePermission(PERMISSIONS.ORG_READ)
  @ApiContract({ response: C.Principal })
  current(@CurrentPrincipal() principal: Principal) {
    return {
      organisationId: principal.organisationId,
      roleKey: principal.roleKey,
      permissions: [...principal.permissions],
      mfaSatisfied: principal.mfaSatisfied,
    };
  }
}
