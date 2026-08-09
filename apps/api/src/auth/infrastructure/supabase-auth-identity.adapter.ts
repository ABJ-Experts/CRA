import { Injectable } from "@nestjs/common";

import type { AuthIdentityProvider } from "../application/auth-identity-provider.port";
import { SupabaseService } from "../../supabase/supabase.service";

export class AuthIdentityProviderUnavailableError extends Error {
  constructor() {
    super("auth identity provider unavailable");
    this.name = "AuthIdentityProviderUnavailableError";
  }
}

@Injectable()
export class SupabaseAuthIdentityAdapter implements AuthIdentityProvider {
  constructor(private readonly supabase: SupabaseService) {}

  async updatePassword(authUserId: string, password: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .admin()
        .auth.admin.updateUserById(authUserId, { password });
      if (error) throw new AuthIdentityProviderUnavailableError();
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async listMfaFactors(
    authUserId: string,
  ): Promise<readonly Readonly<{ id: string }>[]> {
    try {
      const { data, error } = await this.supabase
        .admin()
        .auth.admin.mfa.listFactors({ userId: authUserId });
      if (error || !data || !Array.isArray(data.factors)) {
        throw new AuthIdentityProviderUnavailableError();
      }
      const factors = data.factors.map((factor) => {
        if (
          !factor ||
          typeof factor.id !== "string" ||
          factor.id.length === 0
        ) {
          throw new AuthIdentityProviderUnavailableError();
        }
        return Object.freeze({ id: factor.id });
      });
      return Object.freeze(factors);
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async deleteMfaFactor(authUserId: string, factorId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .admin()
        .auth.admin.mfa.deleteFactor({ id: factorId, userId: authUserId });
      if (error) throw new AuthIdentityProviderUnavailableError();
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }
}
