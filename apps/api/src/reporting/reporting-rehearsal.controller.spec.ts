import type { RequestUser } from "../auth/auth.types";
import type { ReportingObligationUseCases } from "./application/reporting-obligation-use-cases";
import { ReportingRehearsalController } from "./reporting-rehearsal.controller";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const key = "44444444-4444-4444-8444-444444444444";
const user = { id: actorId, organizationId } as RequestUser;

describe("ReportingRehearsalController", () => {
  it("scopes synthetic creation and replay to the verified tenant", async () => {
    const createRehearsal = jest.fn().mockResolvedValue({ obligation: {} });
    const replayRehearsal = jest.fn().mockResolvedValue({ obligation: {} });
    const useCases = {
      createRehearsal,
      replayRehearsal,
    } as unknown as ReportingObligationUseCases;
    const controller = new ReportingRehearsalController(useCases);

    await controller.create(
      {
        type: "severe_incident",
        awarenessAt: "2026-09-11T10:00:00Z",
        awarenessBasis: "Synthetic exercise.",
        idempotencyKey: key,
      },
      user,
    );
    await controller.replay(
      { obligationId },
      {
        reason: "Repeat the isolated exercise.",
        expectedVersion: 1,
        idempotencyKey: key,
      },
      user,
    );

    expect(createRehearsal).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId }),
    );
    expect(replayRehearsal).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId, obligationId }),
    );
  });
});
