// Public interface (Facade) for cross-cutting request context, guards, filters.
export {
  runWithContext,
  getContext,
  requireOrganisationId,
  type RequestContext,
  type ActorType,
} from './tenant-context';
export {
  RequirePermission,
  Public,
  RequireMfa,
  RequireAuth,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  MFA_KEY,
  AUTH_ONLY_KEY,
} from './require-permission.decorator';
export { PermissionGuard } from './permission.guard';
export { AuthMiddleware } from './auth.middleware';
export { ProblemDetailsFilter } from './problem-details.filter';
export { ZodValidationPipe } from './zod-validation.pipe';
export {
  CurrentPrincipal,
  CurrentIdentity,
} from './current-principal.decorator';
export {
  ApiContract,
  CONTRACT_COMPONENTS,
  registerComponent,
  toOpenApiSchema,
  type RouteContract,
} from './api-contract.decorator';
export { C } from './contracts';
