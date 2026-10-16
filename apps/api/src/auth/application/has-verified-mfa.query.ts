import { failure, success } from "../../common/domain/result";
import {
  AuthIdentitySessionInvalidError,
  type AuthIdentityProvider,
} from "./auth-identity-provider.port";

export class HasVerifiedMfaQuery {
  constructor(private readonly identity: AuthIdentityProvider) {}

  async execute(query: Readonly<{ accessToken: string }>) {
    try {
      const factors = await this.identity.listUserMfaFactors(query.accessToken);
      return factors
        ? success(factors.some(({ status }) => status === "verified"))
        : failure(Object.freeze({ code: "auth_unavailable" as const }));
    } catch (error) {
      return failure(
        Object.freeze({
          code:
            error instanceof AuthIdentitySessionInvalidError
              ? ("session_revoked" as const)
              : ("auth_unavailable" as const),
        }),
      );
    }
  }
}
