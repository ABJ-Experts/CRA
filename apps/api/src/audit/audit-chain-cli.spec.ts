import { parseAuditChainArguments } from "./audit-chain-cli";
const organizationId = "11111111-1111-4111-8111-111111111111";
describe("audit operator arguments", () => {
  it("requires an explicit tenant and parses bounded options", () => {
    expect(
      parseAuditChainArguments([
        "--organization",
        organizationId,
        "--from",
        "9007199254740993",
        "--to",
        "9007199254740994",
        "--page-size",
        "4",
        "--max-events",
        "10",
      ]),
    ).toMatchObject({
      organizationId,
      fromSequence: "9007199254740993",
      pageSize: 4,
      maxEvents: 10,
    });
  });
  it.each(
    [
      [],
      ["--organization"],
      ["--other", "x"],
      ["--organization", "--from"],
      ["--organization", organizationId, "--organization", organizationId],
      ["--organization", organizationId, "--from", "2", "--to", "1"],
      ["--organization", organizationId, "--max-events", "0"],
    ].map((args) => ({ args })),
  )("rejects invalid flags $args", ({ args }) => {
    expect(() => parseAuditChainArguments(args)).toThrow();
  });
});
