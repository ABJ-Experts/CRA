import { buildLicenseUsageCounters } from "./usage-diagnostics";
import type {
  LicenseUsageComponents,
  LicenseUsageCounter,
  LicenseUsageCounterId,
} from "@repo/contracts/licensing";

const components: LicenseUsageComponents = {
  activeMembers: 3,
  reservedInvitations: 1,
  products: 5,
  storageBytes: 60,
  storageReservedBytes: 20,
  protectedStorageBytes: 1000,
};
const availability = {
  seats: "ready",
  products: "ready",
  storage: "ready",
  protected_storage: "ready",
} as const;
const reasons = { seats: [], products: [], storage: [], protected_storage: [] };
const input = {
  components,
  availability,
  reasons,
  limits: { activeMembers: 10, products: 10, storageBytes: 100 },
  verified: true,
};

function getCounter(rows: LicenseUsageCounter[], id: LicenseUsageCounterId) {
  const counter = rows.find((row) => row.id === id);
  if (!counter) throw new Error(`Expected usage counter ${id}`);
  return counter;
}

describe("usage diagnostics", () => {
  it("builds exact component sums and immutable definitions without resets", () => {
    const original = JSON.stringify(input);
    const rows = buildLicenseUsageCounters(input);
    expect(rows.map((row) => [row.id, row.value, row.state])).toEqual([
      ["seats", 4, "normal"],
      ["products", 5, "normal"],
      ["storage", 80, "near_limit"],
      ["protected_storage", 1000, "normal"],
    ]);
    expect(getCounter(rows, "seats").components).toEqual([
      { key: "activeMembers", value: 3 },
      { key: "reservedInvitations", value: 1 },
    ]);
    expect(
      rows.every(
        (row) =>
          row.period.kind === "current_state" &&
          row.period.resetRule === "source_changes_only" &&
          row.period.nextResetAt === null,
      ),
    ).toBe(true);
    expect(getCounter(rows, "protected_storage").limit).toEqual({
      kind: "exempt",
      value: null,
    });
    expect(JSON.stringify(input)).toEqual(original);
  });

  it.each([
    [0, 0, "at_limit"],
    [1, 0, "over_limit"],
    [0, 1, "normal"],
    [7, 10, "normal"],
    [8, 10, "near_limit"],
    [10, 10, "at_limit"],
    [11, 10, "over_limit"],
    [7205759403792792, 9007199254740991, "normal"],
    [7205759403792793, 9007199254740991, "near_limit"],
  ])("classifies %i/%i exactly as %s", (used, cap, state) => {
    const rows = buildLicenseUsageCounters({
      ...input,
      components: { ...components, products: used },
      limits: { ...input.limits, products: cap },
    });
    expect(getCounter(rows, "products").state).toBe(state);
  });

  it("distinguishes verified unlimited from unverified limits", () => {
    const rows = buildLicenseUsageCounters({
      ...input,
      limits: { activeMembers: null, products: null, storageBytes: null },
    });
    expect(
      rows
        .slice(0, 3)
        .every(
          (row) => row.limit.kind === "unlimited" && row.state === "normal",
        ),
    ).toBe(true);
    for (const patch of [{ verified: false }, { limits: null }]) {
      const unknown = buildLicenseUsageCounters({ ...input, ...patch });
      expect(
        unknown
          .slice(0, 3)
          .every(
            (row) =>
              row.limit.kind === "unverified" && row.state === "unavailable",
          ),
      ).toBe(true);
      expect(getCounter(unknown, "seats").value).toBe(4);
      expect(getCounter(unknown, "protected_storage").limit.kind).toBe(
        "exempt",
      );
    }
  });

  it("keeps unavailable counters independent and preserves bounded reason codes", () => {
    const rows = buildLicenseUsageCounters({
      ...input,
      availability: { ...availability, storage: "unavailable" },
      reasons: { ...reasons, storage: ["missing_size"] },
    });
    expect(getCounter(rows, "storage")).toMatchObject({
      value: null,
      availability: "unavailable",
      state: "unavailable",
      reasons: ["missing_size"],
    });
    expect(getCounter(rows, "seats").availability).toBe("ready");
    expect(getCounter(rows, "protected_storage").state).toBe("normal");
  });

  it.each([null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "reports unknown/invalid source %s as unavailable",
    (value) => {
      const rows = buildLicenseUsageCounters({
        ...input,
        components: { ...components, products: value },
      });
      expect(getCounter(rows, "products")).toMatchObject({
        value: null,
        components: [{ key: "products", value: null }],
        availability: "unavailable",
        state: "unavailable",
      });
      expect(getCounter(rows, "products").reasons).toContain(
        "invalid_component",
      );
    },
  );

  it("reports unsafe component sums without fabricating a low value", () => {
    const rows = buildLicenseUsageCounters({
      ...input,
      components: {
        ...components,
        activeMembers: Number.MAX_SAFE_INTEGER,
        reservedInvitations: 1,
      },
    });
    expect(getCounter(rows, "seats")).toMatchObject({
      value: null,
      availability: "unavailable",
      state: "unavailable",
    });
    expect(getCounter(rows, "seats").reasons).toContain("unsafe_component_sum");
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "treats invalid cap %s as unverified",
    (cap) => {
      const rows = buildLicenseUsageCounters({
        ...input,
        limits: { ...input.limits, products: cap },
      });
      expect(getCounter(rows, "products")).toMatchObject({
        limit: { kind: "unverified", value: null },
        state: "unavailable",
      });
      expect(getCounter(rows, "products").reasons).toContain("invalid_limit");
    },
  );
});
