import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedIdentity, Principal } from '../identity';

// Non-optional by contract: these are only used on guarded routes where the
// PermissionGuard has already proven the value is present.
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<{ principal?: Principal }>()
      .principal as Principal,
);

export const CurrentIdentity = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedIdentity =>
    ctx.switchToHttp().getRequest<{ identity?: AuthenticatedIdentity }>()
      .identity as AuthenticatedIdentity,
);
