import { describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  assertRlsBootSafety: vi.fn(),
  ping: vi.fn(),
}));

vi.mock('../db/sec014', () => ({
  assertRlsBootSafety: dependencies.assertRlsBootSafety,
}));
vi.mock('../jobs', () => ({ redis: () => ({ ping: dependencies.ping }) }));

import { HealthService } from './health.service';

describe('HealthService', () => {
  it('returns liveness without touching external dependencies', async () => {
    const service = new HealthService();

    await expect(service.live()).resolves.toEqual({ status: 'ok' });
    expect(dependencies.assertRlsBootSafety).not.toHaveBeenCalled();
    expect(dependencies.ping).not.toHaveBeenCalled();
  });

  it('requires RLS-safe Postgres and Redis before declaring readiness', async () => {
    dependencies.assertRlsBootSafety.mockResolvedValue(undefined);
    dependencies.ping.mockResolvedValue('PONG');
    const service = new HealthService();

    await expect(service.ready()).resolves.toEqual({ status: 'ok' });
    expect(dependencies.assertRlsBootSafety).toHaveBeenCalledOnce();
    expect(dependencies.ping).toHaveBeenCalledOnce();
  });
});
