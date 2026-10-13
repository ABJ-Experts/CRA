import { SbomIngestWorker } from "../../sboms/worker/sbom-ingest-worker";
import { SbomQualityWorker } from "../../sboms/worker/sbom-quality-worker";
import { SbomDiffWorker } from "../../sboms/worker/sbom-diff-worker";

const workerId = "11111111-1111-4111-8111-111111111111";
const denied = "22222222-2222-4222-8222-222222222222";
const licensed = "33333333-3333-4333-8333-333333333333";

describe.each([
  ["ingest", SbomIngestWorker, "dueOrganizationIds", "claim"],
  [
    "quality",
    SbomQualityWorker,
    "dueQualityOrganizationIds",
    "claimQualityReport",
  ],
  ["diff", SbomDiffWorker, "dueDiffOrganizationIds", "claimDiffReport"],
] as const)(
  "%s licence claim admission",
  (_name, Worker, dueMethod, claimMethod) => {
    it("skips denied tenants before any lease or retry and reaches the licensed tenant", async () => {
      const queue = {
        [dueMethod]: jest.fn().mockResolvedValue([denied, licensed]),
        [claimMethod]: jest
          .fn()
          .mockResolvedValue({ outcome: "none_available" }),
      };
      const licensing = {
        canClaim: jest.fn((orgId: string) =>
          Promise.resolve(orgId === licensed),
        ),
      };
      const worker = new Worker({
        workerId,
        leaseSeconds: 60,
        queue,
        licensing,
        storage: {},
      } as never);
      await worker.runOnce();
      expect(queue[claimMethod]).toHaveBeenCalledTimes(1);
      expect(queue[claimMethod]).toHaveBeenCalledWith(
        licensed,
        expect.any(Object),
      );
      expect(licensing.canClaim).toHaveBeenCalledWith(denied, "sboms");
    });
    it("provider failure neither grants a claim nor consumes an attempt", async () => {
      const queue = {
        [dueMethod]: jest.fn().mockResolvedValue([denied]),
        [claimMethod]: jest.fn(),
      };
      const licensing = {
        canClaim: jest.fn().mockRejectedValue(new Error("unavailable")),
      };
      const worker = new Worker({
        workerId,
        leaseSeconds: 60,
        queue,
        licensing,
        storage: {},
      } as never);
      await expect(worker.runOnce()).rejects.toThrow("unavailable");
      expect(queue[claimMethod]).not.toHaveBeenCalled();
    });
  },
);
