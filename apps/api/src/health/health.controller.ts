import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiContract, C, Public } from '../common';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @Public()
  @ApiContract({ response: C.Health })
  live(): Promise<HealthResponse> {
    return this.health.live();
  }

  @Get('ready')
  @Public()
  @ApiContract({ response: C.Health })
  async ready(): Promise<HealthResponse> {
    try {
      return await this.health.ready();
    } catch {
      throw new ServiceUnavailableException(
        'Required dependencies are unavailable',
      );
    }
  }
}
