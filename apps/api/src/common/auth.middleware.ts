import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  IDENTITY_PROVIDER,
  resolvePrincipal,
  type AuthenticatedIdentity,
  type IdentityProvider,
  type Principal,
} from '../identity';
import { runWithContext, type RequestContext } from './tenant-context';

interface AuthedRequest extends Request {
  identity?: AuthenticatedIdentity;
  principal?: Principal;
}

// Resolves the verified identity (JWT) and the active-org principal (from the
// X-Organisation-Id header — never the URL/body), then runs the rest of the
// request inside the AsyncLocalStorage tenant context (BRD §6.3).
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly idp: IdentityProvider,
  ) {}

  async use(
    req: AuthedRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const correlationId = req.header('x-correlation-id') ?? randomUUID();
    const authHeader = req.header('authorization');

    let identity: AuthenticatedIdentity | null = null;
    let principal: Principal | null = null;
    if (authHeader) {
      identity = await this.idp.authenticate(authHeader);
      if (identity) {
        const orgId = req.header('x-organisation-id');
        if (orgId) {
          principal = await resolvePrincipal(
            identity.supabaseUserId,
            orgId,
            identity.mfaSatisfied,
          );
        }
      }
    }
    req.identity = identity ?? undefined;
    req.principal = principal ?? undefined;

    const ctx: RequestContext = {
      organisationId: principal?.organisationId,
      userId: principal?.userAccountId,
      actorType: 'user',
      correlationId,
    };
    runWithContext(ctx, () => next());
  }
}
