import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { LicensingRuntimeModule } from "./licensing-runtime.module";
import { LicensingService } from "./application/licensing.service";
import { LicensingStartup } from "./infrastructure/licensing-startup";
import { SupabaseLicensingRepository } from "./infrastructure/supabase-licensing.repository";
import { LocalLicenseVerifier } from "./infrastructure/local-license-verifier";
import { SupabaseService } from "../supabase/supabase.service";

type Loader = () => Promise<LocalLicenseVerifier>;
type TrustProvider = {
  provide: symbol;
  useFactory: (config: ConfigService) => Loader;
  inject: unknown[];
};
function trustProvider(): TrustProvider {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    LicensingRuntimeModule,
  ) as unknown[];
  return providers.find(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      "provide" in value &&
      typeof value.provide === "symbol",
  ) as TrustProvider;
}
const instanceId = "33333333-3333-4333-8333-333333333333";
const orgId = "22222222-2222-4222-8222-222222222222";
function configuration(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}
function repository() {
  return {
    listPolicyTenants: jest
      .fn()
      .mockResolvedValue({ organizationIds: [orgId], nextCursor: null }),
    getWorkerState: jest.fn().mockResolvedValue({
      state: null,
      usage: {
        activeMembers: 0,
        reservedInvitations: 0,
        products: 0,
        storageBytes: 0,
        storageReservedBytes: 0,
        protectedStorageBytes: 0,
      },
      storageAccountingReady: true,
    }),
    checkpointWorker: jest.fn().mockResolvedValue({
      timeHighWaterAt: null,
      clockRollbackDetected: false,
    }),
  };
}

describe("licensing runtime composition", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requires a mounted trust file and caches a concurrent public-key load until restart", async () => {
    const verifier = new LocalLicenseVerifier({
      issuer: "cra",
      keys: [{ kid: "public", kty: "OKP", crv: "Ed25519", x: "A".repeat(43) }],
    });
    const read = jest
      .spyOn(LocalLicenseVerifier, "fromFile")
      .mockResolvedValue(verifier);
    const load = trustProvider().useFactory(
      configuration({ LICENSING_TRUST_FILE: "/run/trust.json" }),
    );
    const first = load();
    const second = load();
    expect(first).toBe(second);
    await expect(first).resolves.toBe(verifier);
    await expect(load()).resolves.toBe(verifier);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/run/trust.json");
    await expect(trustProvider().useFactory(configuration())()).rejects.toThrow(
      "trust_unavailable",
    );
  });

  it("does not silently reload failed trust or replace it after startup", async () => {
    const error = new Error("malformed mounted trust");
    const read = jest
      .spyOn(LocalLicenseVerifier, "fromFile")
      .mockRejectedValue(error);
    const load = trustProvider().useFactory(
      configuration({ LICENSING_TRUST_FILE: "/run/trust.json" }),
    );
    await expect(load()).rejects.toBe(error);
    await expect(load()).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, '{"products":false,"evidence":true}'])(
    "resolves the real service and awaited startup barrier with configuration %s",
    async (features) => {
      const repo = repository();
      const verifier = new LocalLicenseVerifier({
        issuer: "cra",
        keys: [
          { kid: "public", kty: "OKP", crv: "Ed25519", x: "A".repeat(43) },
        ],
      });
      const read = jest
        .spyOn(LocalLicenseVerifier, "fromFile")
        .mockResolvedValue(verifier);
      const module = await Test.createTestingModule({
        imports: [LicensingRuntimeModule],
      })
        .overrideProvider(ConfigService)
        .useValue(
          configuration({
            LICENSING_INSTANCE_ID: instanceId,
            LICENSING_TRUST_FILE: "/run/trust.json",
            LICENSING_LOCAL_FEATURES_JSON: features,
            ...(features ? { LICENSING_POLICY_REVISION: 2 } : {}),
          }),
        )
        .overrideProvider(SupabaseLicensingRepository)
        .useValue(repo)
        .overrideProvider(SupabaseService)
        .useValue({ admin: jest.fn() })
        .compile();
      try {
        expect(module.get(LicensingService)).toBeInstanceOf(LicensingService);
        await module.get(LicensingStartup).onApplicationBootstrap();
        expect(repo.listPolicyTenants).toHaveBeenCalledWith(100, null);
        expect(repo.getWorkerState).toHaveBeenCalledWith(orgId);
        expect(repo.checkpointWorker).toHaveBeenCalledWith(
          orgId,
          expect.any(String),
        );
        expect(read).toHaveBeenCalledTimes(1);
        expect(
          (await module.get(LicensingService).getWorkerPolicy(orgId)).state,
        ).toBe("missing");
      } finally {
        await module.close();
      }
    },
  );

  it.each(['{"unknown":true}', '{"products":"true"}', "not json"])(
    "rejects malformed deployment feature configuration before serving: %s",
    async (features) => {
      await expect(
        Test.createTestingModule({ imports: [LicensingRuntimeModule] })
          .overrideProvider(ConfigService)
          .useValue(configuration({ LICENSING_LOCAL_FEATURES_JSON: features }))
          .overrideProvider(SupabaseLicensingRepository)
          .useValue(repository())
          .overrideProvider(SupabaseService)
          .useValue({ admin: jest.fn() })
          .compile(),
      ).rejects.toThrow();
    },
  );
});
