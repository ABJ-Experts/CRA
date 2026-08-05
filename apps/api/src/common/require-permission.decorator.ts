import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { Permission } from '@repo/schemas';

export const PERMISSIONS_KEY = 'cras:required_permissions';
export const PUBLIC_KEY = 'cras:public';
export const MFA_KEY = 'cras:require_mfa';
export const AUTH_ONLY_KEY = 'cras:auth_only';

// Authenticated but no org/permission required (onboarding: create first org).
export const RequireAuth = (): CustomDecorator =>
  SetMetadata(AUTH_ONLY_KEY, true);

// FR-IAM-001: every endpoint declares its required permission (or is @Public()).
// A build-time test asserts no route handler lacks one of the two.
export const RequirePermission = (
  ...permissions: Permission[]
): CustomDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

export const Public = (): CustomDecorator => SetMetadata(PUBLIC_KEY, true);

// FR-AUTH-002: force an MFA-satisfied session for this route (also implied by any
// approval/submission permission).
export const RequireMfa = (): CustomDecorator => SetMetadata(MFA_KEY, true);
