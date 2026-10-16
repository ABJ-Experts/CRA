import { MODULE_METADATA } from "@nestjs/common/constants";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { LicensingModule } from "./licensing.module";
import { LicensingRuntimeModule } from "./licensing-runtime.module";
import { LicensingService } from "./application/licensing.service";
import {
  LicenseUsageService,
  LICENSING_USAGE_APPLICATION,
} from "./application/license-usage.service";
import { SupabaseLicenseUsageRepository } from "./infrastructure/supabase-license-usage.repository";
import { SupabaseService } from "../supabase/supabase.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const observedAt = "2026-10-13T10:00:00.000Z";

describe("licensing usage composition", () => {
  it("mounts usage diagnostics beside the existing licence controller", () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      LicensingModule,
    ) as readonly { name: string }[];
    expect(controllers.map((controller) => controller.name)).toEqual([
      "LicensingController",
      "LicensingUsageController",
    ]);
  });

  it.each([false, true])(
    "resolves the real usage application with configured instance %s",
    async (configured) => {
      const getCurrent = jest.fn().mockResolvedValue({
        version: 0,
        claims: null,
        policy: {
          state: "missing",
          reasons: ["missing"],
          warnings: [],
          effectiveCapabilities: [],
          disabledCapabilities: [],
          customerWritesAllowed: false,
          evidenceExportAllowed: true,
          evaluatedAt: observedAt,
          expiresAt: null,
          graceEndsAt: null,
        },
      });
      const read = jest.fn().mockResolvedValue({
        outcome: "ready",
        organizationId,
        licenseVersion: 0,
        issuanceSequence: null,
        observedAt,
        meterVersion: 1,
        reconciledAt: null,
        components: {
          activeMembers: 1,
          reservedInvitations: 0,
          products: 0,
          storageBytes: 0,
          storageReservedBytes: 0,
          protectedStorageBytes: 0,
        },
        availability: {
          seats: "ready",
          products: "ready",
          storage: "ready",
          protected_storage: "ready",
        },
        reasons: {
          seats: [],
          products: [],
          storage: [],
          protected_storage: [],
        },
      });
      const module = await Test.createTestingModule({
        imports: [LicensingRuntimeModule],
      })
        .overrideProvider(ConfigService)
        .useValue({
          get: (key: string) =>
            key === "LICENSING_INSTANCE_ID" && configured
              ? organizationId
              : undefined,
        })
        .overrideProvider(LicensingService)
        .useValue({ getCurrent })
        .overrideProvider(SupabaseLicenseUsageRepository)
        .useValue({ read })
        .overrideProvider(SupabaseService)
        .useValue({ admin: jest.fn() })
        .compile();
      try {
        const application = module.get<LicenseUsageService>(
          LICENSING_USAGE_APPLICATION,
        );
        expect(application).toBe(module.get(LicenseUsageService));
        const snapshot = await application.getUsage(organizationId, actorId);
        expect(snapshot.organizationId).toBe(organizationId);
        expect(snapshot.license.verified).toBe(false);
        expect(snapshot.license.policyRevision).toBe(0);
        expect(getCurrent).toHaveBeenCalledTimes(configured ? 1 : 0);
        if (configured)
          expect(getCurrent).toHaveBeenCalledWith(organizationId, actorId);
        expect(read).toHaveBeenCalledWith(
          organizationId,
          actorId,
          configured ? 0 : null,
        );
      } finally {
        await module.close();
      }
    },
  );
});
