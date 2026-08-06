import type { PrincipalData } from "./api";

/** Presentation-only capability check; API permissions remain the authority. */
export function hasPermission(principal: PrincipalData | null, permission: string): boolean {
  return principal?.permissions.includes(permission) ?? false;
}
