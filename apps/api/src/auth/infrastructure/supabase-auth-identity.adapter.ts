import { Injectable } from "@nestjs/common";

import {
  AuthIdentityProviderUnavailableError,
  type AuthIdentityProvider,
} from "../application/auth-identity-provider.port";
import { SupabaseService } from "../../supabase/supabase.service";

@Injectable()
export class SupabaseAuthIdentityAdapter implements AuthIdentityProvider {
  constructor(private readonly supabase: SupabaseService) {}

  async register(email: string, password: string, username: string) {
    try {
      const { data, error } = await this.supabase
        .anon()
        .auth.signUp({ email, password, options: { data: { username } } });
      if (error)
        return Object.freeze({
          outcome: /already registered|already exists/i.test(error.message)
            ? ("email_taken" as const)
            : ("failed" as const),
        });
      if (!data.session || !data.user)
        return Object.freeze({ outcome: "failed" as const });
      return Object.freeze({
        outcome: "created" as const,
        identity: Object.freeze({
          authUserId: data.user.id,
          tokens: Object.freeze({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          }),
        }),
      });
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async authenticate(email: string, password: string) {
    try {
      const { data, error } = await this.supabase
        .anon()
        .auth.signInWithPassword({ email, password });
      if (error || !data.session) return null;
      return Object.freeze({
        authUserId: data.user?.id ?? "",
        tokens: Object.freeze({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        }),
      });
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async refresh(refreshToken: string) {
    try {
      const { data, error } = await this.supabase
        .anon()
        .auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) return null;
      return Object.freeze({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async signOutGlobally(accessToken: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .asUser(accessToken)
        .auth.signOut({ scope: "global" });
      if (error) throw new AuthIdentityProviderUnavailableError();
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async updatePassword(authUserId: string, password: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .admin()
        .auth.admin.updateUserById(authUserId, { password });
      return !error;
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

  async enrollMfa(accessToken: string) {
    try {
      const { data, error } = await this.supabase
        .asUser(accessToken)
        .auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `CRA ${new Date().toISOString()}`,
        });
      if (error || !data) return null;
      return Object.freeze({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        uri: data.totp.uri,
      });
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async verifyMfa(accessToken: string, factorId: string, code: string) {
    const client = this.supabase.asUser(accessToken);
    try {
      const { data: challenge, error: challengeError } =
        await client.auth.mfa.challenge({ factorId });
      if (challengeError || !challenge)
        return Object.freeze({ outcome: "challenge_failed" as const });
      const { data, error } = await client.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (error || !data) return Object.freeze({ outcome: "invalid" as const });
      return Object.freeze({
        outcome: "verified" as const,
        tokens: Object.freeze({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        }),
      });
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async listUserMfaFactors(accessToken: string) {
    try {
      const { data, error } = await this.supabase
        .asUser(accessToken)
        .auth.mfa.listFactors();
      if (error || !data) return null;
      return Object.freeze(
        data.totp.map((factor) =>
          Object.freeze({ id: factor.id, status: factor.status }),
        ),
      );
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }

  async unenrollMfa(accessToken: string, factorId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .asUser(accessToken)
        .auth.mfa.unenroll({ factorId });
      return !error;
    } catch {
      throw new AuthIdentityProviderUnavailableError();
    }
  }
}
