import { SupabaseOnboardingEvidenceRecorder } from "./supabase-onboarding-evidence-recorder.adapter";

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

function harness(result: RpcResult) {
  const rpc = jest.fn().mockResolvedValue(result);
  const recorder = new SupabaseOnboardingEvidenceRecorder({
    admin: () => ({ rpc }),
  } as never);
  return { recorder, rpc };
}

describe("SupabaseOnboardingEvidenceRecorder", () => {
  it.each([
    ["recordProductCreated", "first_product", "product-1"],
    ["recordSbomCreated", "first_sbom", "sbom-1"],
  ] as const)(
    "%s records post-commit evidence with organization scope first",
    async (method, stage, resourceId) => {
      const { recorder, rpc } = harness({
        data: [{ outcome: "recorded" }],
        error: null,
      });

      await expect(
        recorder[method]("org-1", resourceId, "actor-1"),
      ).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledWith(
        "record_organization_onboarding_evidence_atomic",
        {
          p_organization_id: "org-1",
          p_stage: stage,
          p_resource_id: resourceId,
          p_actor_user_id: "actor-1",
          p_available: true,
        },
      );
    },
  );

  it("records invitation delivery through its durable specialized RPC", async () => {
    const { recorder, rpc } = harness({
      data: [{ outcome: "recorded" }],
      error: null,
    });

    await expect(
      recorder.recordInvitationDelivery("org-1", "invitation-1", "actor-1"),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "record_invitation_delivery_onboarding_atomic",
      {
        p_organization_id: "org-1",
        p_invitation_id: "invitation-1",
        p_actor_user_id: "actor-1",
      },
    );
  });

  it("turns provider errors and malformed outcomes into stable adapter failures", async () => {
    const unavailable = harness({
      data: null,
      error: { message: "connection refused" },
    });
    await expect(
      unavailable.recorder.recordInvitationDelivery(
        "org-1",
        "invite-1",
        "actor-1",
      ),
    ).rejects.toMatchObject({ code: "unavailable" });

    const malformed = harness({
      data: [{ outcome: "unexpected" }],
      error: null,
    });
    await expect(
      malformed.recorder.recordInvitationDelivery(
        "org-1",
        "invite-1",
        "actor-1",
      ),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});
