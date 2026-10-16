import { walOrdinal, walEndLsn, assertWalSequence } from "./wal-sequence";
describe("PostgreSQL WAL continuity", () => {
  it("handles segment/log rollover without treating it as a gap", () => {
    expect(walOrdinal("0000000100000000000000FF")).toBe(255n);
    expect(walOrdinal("000000010000000100000000")).toBe(256n);
    expect(walEndLsn("0000000100000000000000FF")).toBe("1/0");
    expect(() =>
      assertWalSequence([
        "0000000100000000000000FF",
        "000000010000000100000000",
      ]),
    ).not.toThrow();
  });
  it("rejects malformed files, missing segments and changed timelines", () => {
    expect(() => walOrdinal("../../wal")).toThrow("wal_gap");
    expect(() => walOrdinal("000000010000000000000100")).toThrow("wal_gap");
    expect(() =>
      assertWalSequence([
        "000000010000000000000001",
        "000000010000000000000003",
      ]),
    ).toThrow("wal_gap");
    expect(() =>
      assertWalSequence([
        "000000010000000000000001",
        "000000020000000000000002",
      ]),
    ).toThrow("wal_gap");
  });
});
