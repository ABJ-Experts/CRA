import { Test } from "@nestjs/testing";
import { BackupsModule } from "./backups.module";
import { SupabaseService } from "../supabase/supabase.service";
import { BackupAssuranceUseCases } from "./application/backup-assurance.use-cases";

it("wires customer assurance through its scoped source adapter without executor authority", async () => {
  const assurance = {
    status: "unavailable",
    lastAttempt: null,
    lastCapture: null,
    lastVerification: null,
    lastVerifiedRestoreAt: null,
    recoverablePointAt: null,
    verificationDueAt: null,
    residency: null,
    sourceAt: null,
    observedAt: "2026-10-15T00:00:00.000Z",
    reasons: ["not_configured"],
  };
  const rpc = jest.fn().mockResolvedValue({
    data: {
      outcome: "ok",
      assurance,
      history: { items: [], nextCursor: null },
    },
    error: null,
  });
  const module = await Test.createTestingModule({ imports: [BackupsModule] })
    .overrideProvider(SupabaseService)
    .useValue({ admin: () => ({ rpc }) })
    .compile();
  try {
    expect(
      await module
        .get(BackupAssuranceUseCases)
        .summary(
          "20000000-0000-4000-8000-000000000001",
          "30000000-0000-4000-8000-000000000001",
        ),
    ).toEqual(assurance);
    expect(rpc).toHaveBeenCalledWith("m15_05_backup_assurance", {
      p_organization_id: "20000000-0000-4000-8000-000000000001",
      p_actor_user_id: "30000000-0000-4000-8000-000000000001",
      p_limit: 25,
    });
  } finally {
    await module.close();
  }
});
