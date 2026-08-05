// Public interface (Facade) for the identity module.
export {
  type Principal,
  hasRequiredPermissions,
  resolvePrincipalForMember,
  resolvePrincipal,
  resolveUserAccountId,
  ensureUserAccount,
} from './auth.service';
export {
  type IdentityProvider,
  type AuthenticatedIdentity,
  type SsoLinkInput,
  type ProvisionUserInput,
  IDENTITY_PROVIDER,
  SupabaseIdentityAdapter,
} from './identity-provider';
export { IdentityModule } from './identity.module';
