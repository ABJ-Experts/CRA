import {
  ownedRecoveryProbeMembers,
  sameRecoveryOwnership,
} from "./recovery-probe-reconciliation";
import { recoveryOwnershipLabels } from "./recovery-reconciliation";
const name = "cra-backup-restore-33333333-3333-4333-8333-333333333333",
  owner = "cra-backup-probe-44444444-4444-4444-8444-444444444444";
const labels = recoveryOwnershipLabels(
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  name,
  `${name}-abcdef`,
);
describe("abandoned probe ownership", () => {
  it("recognizes complete copied ownership while ignoring unrelated image metadata labels", () => {
    expect(
      sameRecoveryOwnership({ ...labels, "org.image": "pinned" }, labels),
    ).toBe(true);
    expect(sameRecoveryOwnership({}, {})).toBe(false);
  });
  it("collects only exact probe-owned services and runtime containers from the target network", async () => {
    const run = jest.fn((args: readonly string[]) =>
      Promise.resolve(
        args.includes("{{json .Containers}}")
          ? JSON.stringify({
              postgres: { Name: name },
              probe: { Name: `${owner}-runtime-create` },
              auth: { Name: `${owner}-auth` },
            })
          : JSON.stringify({ ...labels, "cra.backup.probe": owner }),
      ),
    );
    expect(
      await ownedRecoveryProbeMembers(
        `${name}-network`,
        name,
        true,
        labels,
        run,
      ),
    ).toEqual([`${owner}-runtime-create`, `${owner}-auth`]);
  });
  it("blocks all cleanup for an unrelated member, malformed ownership, or a foreign target", async () => {
    for (const member of ["unrelated-production", name])
      expect(
        await ownedRecoveryProbeMembers("network", name, false, labels, () =>
          Promise.resolve(JSON.stringify({ member: { Name: member } })),
        ),
      ).toBeNull();
    for (const output of ["[]", "null", '{"member":{}}'])
      expect(
        await ownedRecoveryProbeMembers("network", name, false, labels, () =>
          Promise.resolve(output),
        ),
      ).toBeNull();
  });
  it("rejects probe label mismatch and malformed label objects", async () => {
    for (const label of [
      "null",
      "[]",
      JSON.stringify({ ...labels, "cra.backup.probe": "other" }),
      JSON.stringify({
        ...labels,
        "cra.backup.instance": "other",
        "cra.backup.probe": owner,
      }),
    ])
      expect(
        await ownedRecoveryProbeMembers(
          "network",
          name,
          false,
          labels,
          (args) =>
            Promise.resolve(
              args.includes("{{json .Containers}}")
                ? JSON.stringify({ member: { Name: `${owner}-storage` } })
                : label,
            ),
        ),
      ).toBeNull();
  });
});
