import {
  auditCanonicalHash,
  auditRowFailures,
} from "./audit-chain-row-verification";
const canonical = '{"n":9007199254740993,"s":"é"}';
const previous = "0".repeat(64);
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  chain_sequence: "1",
  chain_version: 1,
  previous_hash: previous,
  canonical_content: canonical,
  recomputed_canonical_content: canonical,
  content_hash: "",
};
describe("audit row verification", () => {
  it("uses exact UTF8 bytes", () => {
    const hash = auditCanonicalHash(previous, canonical);
    expect(hash).not.toBe(
      auditCanonicalHash(previous, JSON.stringify(JSON.parse(canonical))),
    );
    expect(auditRowFailures({ ...row, content_hash: hash })).toEqual([]);
  });
  it("reports independent failures", () =>
    expect(
      auditRowFailures({
        ...row,
        chain_version: 2,
        recomputed_canonical_content: "{}",
      }),
    ).toEqual(["unsupported_version", "canonical_mismatch", "hash_mismatch"]));
});
