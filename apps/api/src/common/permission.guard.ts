import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MFA_REQUIRED_PERMISSIONS, type Permission } from '@repo/schemas';
import {
  hasRequiredPermissions,
  type AuthenticatedIdentity,
  type Principal,
} from '../identity';
import {
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  MFA_KEY,
  AUTH_ONLY_KEY,
} from './require-permission.decorator';

interface AuthedRequest {
  identity?: AuthenticatedIdentity;
  principal?: Principal;
}

// FR-IAM-002: server-side authorisation on every request. AuthMiddleware attaches
// req.identity (verified JWT) and req.principal (active-org membership + role).
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.identity)
      throw new UnauthorizedException('Authentication required');

    const required =
      this.reflector.getAllAndOverride<Permission[]>(
        PERMISSIONS_KEY,
        targets,
      ) ?? [];
    const authOnly =
      this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets) ===
      true;
    if (authOnly && required.length === 0) return true;

    const principal = req.principal;
    if (!principal)
      throw new UnauthorizedException('No active organisation context');

    if (!hasRequiredPermissions(principal.permissions, required)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const explicitMfa =
      this.reflector.getAllAndOverride<boolean>(MFA_KEY, targets) === true;
    const needsMfa =
      explicitMfa || required.some((p) => MFA_REQUIRED_PERMISSIONS.includes(p));
    if (needsMfa && !principal.mfaSatisfied) {
      throw new ForbiddenException('MFA required for this action');
    }
    return true;
  }
}
