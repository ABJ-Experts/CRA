export {
  HEALTH_SOURCES,
  type HealthSource,
  type HealthSourceObservation,
} from "../domain/health-source";
import type {
  HealthSource,
  HealthSourceObservation,
} from "../domain/health-source";
export interface SystemHealthSourcePort {
  readSource(
    orgId: string,
    actorId: string,
    source: HealthSource,
    signal: AbortSignal,
  ): Promise<HealthSourceObservation>;
}
export interface SystemHealthRuntimePort {
  database(signal: AbortSignal): Promise<boolean>;
  audit(signal: AbortSignal): Promise<boolean>;
  storage(signal: AbortSignal): Promise<boolean>;
}
export class SystemHealthAuthorizationError extends Error {
  constructor() {
    super("System health access is not permitted");
  }
}
