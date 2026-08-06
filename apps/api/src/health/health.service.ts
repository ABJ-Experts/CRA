import { Injectable } from '@nestjs/common';
import { assertRlsBootSafety } from '../db';
import { redis } from '../jobs';

export interface HealthResponse {
  status: 'ok';
}

/**
 * Readiness is deliberately stricter than liveness: a process that cannot use
 * its RLS-protected database or its queue must be removed from service.
 */
@Injectable()
export class HealthService {
  live(): Promise<HealthResponse> {
    return Promise.resolve({ status: 'ok' });
  }

  async ready(): Promise<HealthResponse> {
    await Promise.all([assertRlsBootSafety(), redis().ping()]);
    return { status: 'ok' };
  }
}
