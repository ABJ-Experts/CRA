import { assertStageOutsideSourceMounts } from "./restore-configuration";
describe("restore source-volume exclusion", () => {
  it("rejects source staging, parent and child paths without adopting any existing volume", async () => {
    for (const path of ["/source/data", "/source/data/staging", "/source"])
      await expect(
        assertStageOutsideSourceMounts(path, ["db"], () =>
          Promise.resolve(JSON.stringify([{ Source: "/source/data" }])),
        ),
      ).rejects.toThrow("unsafe_recovery_mount");
  });
  it("accepts exclusively provisioned separate staging and deduplicates source inspections", async () => {
    const inspect = jest.fn(() =>
      Promise.resolve(JSON.stringify([{ Source: "/source/data" }])),
    );
    await expect(
      assertStageOutsideSourceMounts(
        "/separate/staging",
        ["db", "db"],
        inspect,
      ),
    ).resolves.toBeUndefined();
    expect(inspect).toHaveBeenCalledWith(["db"]);
  });
  it("fails closed for malformed mount inventories", async () => {
    for (const data of ["{}", "[{}]", "[null]"])
      await expect(
        assertStageOutsideSourceMounts("/stage", ["db"], () =>
          Promise.resolve(data),
        ),
      ).rejects.toThrow("unsafe_recovery_mount");
  });
});
