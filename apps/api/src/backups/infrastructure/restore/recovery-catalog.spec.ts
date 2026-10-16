import { recoveryCatalogMatches } from "./recovery-catalog";
describe("native recovery sequence semantics", () => {
  it("allows PostgreSQL crash-recovery sequence cache advancement without hiding schema changes", () => {
    const source = {
      relations: [{ name: "table" }],
      sequences: [
        {
          schemaname: "public",
          sequencename: "ids",
          increment_by: 1,
          last_value: 10,
          start_value: 1,
        },
      ],
    };
    expect(
      recoveryCatalogMatches(source, {
        ...source,
        sequences: [{ ...source.sequences[0], last_value: 42 }],
      }),
    ).toBe(true);
    expect(
      recoveryCatalogMatches(source, {
        ...source,
        sequences: [{ ...source.sequences[0], last_value: 9 }],
      }),
    ).toBe(false);
    expect(recoveryCatalogMatches(source, { ...source, relations: [] })).toBe(
      false,
    );
  });
  it("checks descending sequences in their declared direction and preserves null/cycling semantics", () => {
    const source = {
      sequences: [
        {
          schemaname: "public",
          sequencename: "ids",
          increment_by: -1,
          last_value: -10,
          cycle: false,
        },
      ],
    };
    expect(
      recoveryCatalogMatches(source, {
        sequences: [{ ...source.sequences[0], last_value: -42 }],
      }),
    ).toBe(true);
    expect(
      recoveryCatalogMatches(source, {
        sequences: [{ ...source.sequences[0], last_value: -9 }],
      }),
    ).toBe(false);
    expect(
      recoveryCatalogMatches(
        { sequences: [{ last_value: null }] },
        { sequences: [{ last_value: 1 }] },
      ),
    ).toBe(false);
    expect(
      recoveryCatalogMatches(
        { sequences: [] },
        { sequences: [{ last_value: 1 }] },
      ),
    ).toBe(false);
    expect(recoveryCatalogMatches(null, {})).toBe(false);
  });
});
