import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS } from '@repo/schemas';
import { ApiContract, C, CurrentPrincipal, RequirePermission } from '../common';
import type { Principal } from '../identity';
import { getDashboard, type DashboardView } from './analytics.service';

@Controller('dashboard')
export class AnalyticsController {
  // FR-AN-001: tenant-isolated dashboard aggregates.
  @Get()
  @ApiContract({ response: C.Dashboard })
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  dashboard(@CurrentPrincipal() p: Principal): Promise<DashboardView> {
    return getDashboard(p.organisationId);
  }
}
