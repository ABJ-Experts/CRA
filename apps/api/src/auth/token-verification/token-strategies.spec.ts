import { once } from "node:events";
import { createServer } from "node:http";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";

import { TokenVerifierService } from "../token-verifier.service";
import { Hs256TokenVerifierStrategy } from "./hs256.strategy";
import { JwksTokenVerifierStrategy } from "./jwks.strategy";
import { TokenStrategySelector } from "./token-strategy-selector";

const SUPABASE_URL = "https://project.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const OTHER_ISSUER = "https://attacker.example/auth/v1";
const SECRET = new TextEncoder().encode(
  "a-development-secret-long-enough-for-test-signatures",
);

function createService(supabaseUrl = SUPABASE_URL): TokenVerifierService {
  return new TokenVerifierService(
    new ConfigService({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_JWT_SECRET: new TextDecoder().decode(SECRET),
    }),
  );
}

async function signHs256(
  overrides: Readonly<{
    issuer?: string;
    audience?: string;
    expiresAt?: number;
  }> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = new SignJWT({
    email: "member@cra.test",
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(overrides.issuer ?? ISSUER)
    .setSubject("user-1")
    .setIssuedAt(now)
    .setExpirationTime(overrides.expiresAt ?? now + 300);

  if (overrides.audience) token.setAudience(overrides.audience);

  return token.sign(SECRET);
}

function unsignedToken(header: Readonly<Record<string, unknown>>): string {
  const encode = (value: Readonly<Record<string, unknown>>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode(header)}.${encode({ iss: ISSUER, exp: 4_102_444_800 })}.`;
}

function joseError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

async function startJwksServer(keys: readonly Record<string, unknown>[]) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ keys }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not resolve JWKS test server address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeIdleConnections();
      }),
  };
}

describe("token verification strategies", () => {
  describe("TokenStrategySelector", () => {
    const hs256 = new Hs256TokenVerifierStrategy(SECRET, ISSUER);
    const unavailableKey: JWTVerifyGetKey = () => {
      throw joseError("ERR_JWKS_NO_MATCHING_KEY");
    };
    const jwks = new JwksTokenVerifierStrategy(unavailableKey, ISSUER);
    const selector = new TokenStrategySelector([hs256, jwks]);

    it("selects only the explicitly allowed symmetric and asymmetric algorithms", () => {
      expect(selector.select("HS256")).toBe(hs256);
      expect(selector.select("ES256")).toBe(jwks);
      expect(selector.select("RS256")).toBe(jwks);
    });

    it.each(["none", "HS384", "RS512", "", "hs256"])(
      "rejects unsupported algorithm %s",
      (algorithm) => {
        expect(selector.select(algorithm)).toBeNull();
      },
    );

    it("fails closed when an allowed algorithm has no configured strategy", () => {
      expect(new TokenStrategySelector([hs256]).select("ES256")).toBeNull();
    });
  });

  describe("HS256", () => {
    const strategy = new Hs256TokenVerifierStrategy(SECRET, ISSUER);

    it("verifies a valid token and preserves its claims", async () => {
      const result = await strategy.verify(await signHs256());

      expect(result).toMatchObject({
        ok: true,
        claims: {
          sub: "user-1",
          email: "member@cra.test",
          role: "authenticated",
        },
      });
    });

    it("rejects a token with a bad issuer", async () => {
      await expect(
        strategy.verify(await signHs256({ issuer: OTHER_ISSUER })),
      ).resolves.toEqual({ ok: false, reason: "invalid" });
    });

    it("reports an expired token distinctly", async () => {
      await expect(
        strategy.verify(
          await signHs256({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        ),
      ).resolves.toEqual({ ok: false, reason: "expired" });
    });

    it("does not introduce an audience restriction", async () => {
      await expect(
        strategy.verify(await signHs256({ audience: "custom-client" })),
      ).resolves.toMatchObject({ ok: true });
    });

    it("rejects an asymmetric algorithm before consulting the symmetric key", async () => {
      const { privateKey } = await generateKeyPair("ES256");
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer(ISSUER)
        .setExpirationTime("5m")
        .sign(privateKey);

      await expect(strategy.verify(token)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });
  });

  describe("JWKS", () => {
    it("verifies ES256 tokens with unrestricted audiences and follows key rotation", async () => {
      const first = await generateKeyPair("ES256");
      const second = await generateKeyPair("ES256");
      let keys = new Map<string, KeyLike>([["key-1", first.publicKey]]);
      const rotatingKeySet: JWTVerifyGetKey = (header) => {
        const key = header.kid ? keys.get(header.kid) : undefined;
        if (!key) throw joseError("ERR_JWKS_NO_MATCHING_KEY");
        return key;
      };
      const strategy = new JwksTokenVerifierStrategy(rotatingKeySet, ISSUER);
      const sign = (kid: string, privateKey: KeyLike) =>
        new SignJWT({ role: "authenticated" })
          .setProtectedHeader({ alg: "ES256", kid })
          .setIssuer(ISSUER)
          .setAudience("custom-client")
          .setExpirationTime("5m")
          .sign(privateKey);

      await expect(
        strategy.verify(await sign("key-1", first.privateKey)),
      ).resolves.toMatchObject({ ok: true });

      keys = new Map<string, KeyLike>([["key-2", second.publicKey]]);

      await expect(
        strategy.verify(await sign("key-2", second.privateKey)),
      ).resolves.toMatchObject({ ok: true });
    });

    it("verifies RS256 tokens from the asymmetric key source", async () => {
      const { privateKey, publicKey } = await generateKeyPair("RS256");
      const publicJwk = await exportJWK(publicKey);
      const importedPublicKey = await importJWK(publicJwk, "RS256");
      const getKey: JWTVerifyGetKey = () => importedPublicKey;
      const strategy = new JwksTokenVerifierStrategy(getKey, ISSUER);
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: "rsa-key" })
        .setIssuer(ISSUER)
        .setExpirationTime("5m")
        .sign(privateKey);

      await expect(strategy.verify(token)).resolves.toMatchObject({ ok: true });
    });

    it("reports an unknown key as temporarily unavailable", async () => {
      const reportUnavailable = jest.fn();
      const getKey: JWTVerifyGetKey = () => {
        throw joseError("ERR_JWKS_NO_MATCHING_KEY");
      };
      const strategy = new JwksTokenVerifierStrategy(
        getKey,
        ISSUER,
        reportUnavailable,
      );

      await expect(
        strategy.verify(unsignedToken({ alg: "ES256" })),
      ).resolves.toEqual({ ok: false, reason: "unavailable" });
      expect(reportUnavailable).toHaveBeenCalledWith(
        "ERR_JWKS_NO_MATCHING_KEY",
      );
    });

    it.each(["ERR_JWKS_TIMEOUT", "ERR_JOSE_GENERIC"])(
      "reports JWKS outage %s as temporarily unavailable",
      async (code) => {
        const getKey: JWTVerifyGetKey = () => {
          throw joseError(code);
        };
        const strategy = new JwksTokenVerifierStrategy(getKey, ISSUER);

        await expect(
          strategy.verify(unsignedToken({ alg: "ES256" })),
        ).resolves.toEqual({ ok: false, reason: "unavailable" });
      },
    );

    it("rejects symmetric/asymmetric algorithm confusion", async () => {
      const getKey = jest.fn<
        ReturnType<JWTVerifyGetKey>,
        Parameters<JWTVerifyGetKey>
      >();
      const strategy = new JwksTokenVerifierStrategy(getKey, ISSUER);

      await expect(strategy.verify(await signHs256())).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
      expect(getKey).not.toHaveBeenCalled();
    });

    it.each([
      [OTHER_ISSUER, Math.floor(Date.now() / 1000) + 300, "invalid"],
      [ISSUER, Math.floor(Date.now() / 1000) - 1, "expired"],
    ] as const)(
      "rejects issuer/expiry violations for asymmetric tokens",
      async (issuer, expiresAt, reason) => {
        const { privateKey, publicKey } = await generateKeyPair("ES256");
        const getKey: JWTVerifyGetKey = () => publicKey;
        const strategy = new JwksTokenVerifierStrategy(getKey, ISSUER);
        const token = await new SignJWT({})
          .setProtectedHeader({ alg: "ES256", kid: "key-1" })
          .setIssuer(issuer)
          .setExpirationTime(expiresAt)
          .sign(privateKey);

        await expect(strategy.verify(token)).resolves.toEqual({
          ok: false,
          reason,
        });
      },
    );
  });

  describe("TokenVerifierService", () => {
    it.each([
      ["none", unsignedToken({ alg: "none" })],
      ["missing", unsignedToken({ typ: "JWT" })],
      ["malformed", "not-a-jwt"],
    ])("rejects a %s protected header", async (_case, token) => {
      await expect(createService().verify(token)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });

    it("keeps the public result and verification statistics while delegating", async () => {
      const service = createService();

      await expect(service.verify(await signHs256())).resolves.toMatchObject({
        ok: true,
        claims: { sub: "user-1" },
      });
      expect(service.stats()).toEqual({
        strategy: "HS256",
        jwksVerifications: 0,
      });

      await expect(
        service.verify(
          await signHs256({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        ),
      ).resolves.toEqual({ ok: false, reason: "expired" });
      expect(service.stats()).toEqual({
        strategy: "HS256",
        jwksVerifications: 0,
      });
    });

    it("logs only a secret fingerprint during initialization", () => {
      const log = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);

      createService().onModuleInit();

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\[jwt\] issuer=https:\/\/project\.supabase\.co\/auth\/v1 secret-fingerprint=[a-f0-9]{12}$/,
        ),
      );
      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining(new TextDecoder().decode(SECRET)),
      );
      log.mockRestore();
    });

    it("keeps JWKS statistics and unavailable logging while delegating", async () => {
      const accepted = await generateKeyPair("ES256");
      const unknown = await generateKeyPair("ES256");
      const publicJwk = {
        ...(await exportJWK(accepted.publicKey)),
        alg: "ES256",
        kid: "accepted-key",
        use: "sig",
      };
      const jwksServer = await startJwksServer([publicJwk]);
      const service = createService(jwksServer.url);
      const logError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      const sign = (kid: string, privateKey: KeyLike) =>
        new SignJWT({})
          .setProtectedHeader({ alg: "ES256", kid })
          .setIssuer(`${jwksServer.url}/auth/v1`)
          .setExpirationTime("5m")
          .sign(privateKey);

      try {
        await expect(
          service.verify(await sign("accepted-key", accepted.privateKey)),
        ).resolves.toMatchObject({ ok: true });
        expect(service.stats()).toEqual({
          strategy: "JWKS",
          jwksVerifications: 1,
        });

        await expect(
          service.verify(await sign("unknown-key", unknown.privateKey)),
        ).resolves.toEqual({ ok: false, reason: "unavailable" });
        expect(logError).toHaveBeenCalledWith(
          "[jwt] JWKS unavailable: ERR_JWKS_NO_MATCHING_KEY",
        );
      } finally {
        logError.mockRestore();
        await jwksServer.close();
      }
    });
  });
});
