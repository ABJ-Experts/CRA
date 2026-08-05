// Tenant/request context carried through a request or job via AsyncLocalStorage
// (BRD §6.3). Resolved from the authenticated principal — NEVER from a URL
// segment or request body, which are attacker-controlled.
import { AsyncLocalStorage } from 'node:async_hooks';

export type ActorType =
  'user' | 'service_account' | 'system' | 'ai' | 'operator';

export interface RequestContext {
  /** Active organisation. Absent during pre-auth / login membership resolution. */
  organisationId?: string;
  /** Authenticated user_account.id (or service account id). */
  userId?: string;
  actorType?: ActorType;
  correlationId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireOrganisationId(): string {
  const org = storage.getStore()?.organisationId;
  // WHY: a missing tenant context must fail loudly, never silently widen a query.
  if (!org) throw new Error('No tenant context: organisationId is not set');
  return org;
}
