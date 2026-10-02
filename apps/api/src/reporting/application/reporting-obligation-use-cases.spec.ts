import { ReportingObligationInvalidStateError } from "./reporting-obligation.port";
import { ReportingObligationUseCases } from "./reporting-obligation-use-cases";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const stageId = "44444444-4444-4444-8444-444444444444";

describe("ReportingObligationUseCases", () => {
  it("fails closed when a crafted real filing targets a rehearsal", async () => {
    const repository = {
      detail: jest
        .fn()
        .mockResolvedValue({ obligation: { isRehearsal: true } }),
    };
    const evidence = { recordStageExternalFiling: jest.fn() };
    const subject = new ReportingObligationUseCases(
      repository as never,
      {} as never,
      evidence as never,
    );

    await expect(
      subject.recordStageExternalFiling(organizationId, {
        actorId,
        sessionId: "session",
        obligationId,
        stageId,
        fields: {} as never,
        receipt: {} as never,
      }),
    ).rejects.toBeInstanceOf(ReportingObligationInvalidStateError);
    expect(evidence.recordStageExternalFiling).not.toHaveBeenCalled();
  });
});
