import {
  initializeAuditRange,
  inspectAuditRangeBatch,
  auditRangeResult,
} from "./audit-range-kernel";
import { auditCanonicalHash } from "../audit-chain-row-verification";
const genesis = "0".repeat(64);
const row = (sequence: string, previous = genesis) => ({
  id: "11111111-1111-4111-8111-111111111111",
  chain_sequence: sequence,
  chain_version: 1,
  previous_hash: previous,
  canonical_content: "{}",
  recomputed_canonical_content: "{}",
  content_hash: auditCanonicalHash(previous, "{}"),
});
const job = {
  fromSequence: "1",
  toSequence: "3",
  head: { sequence: "3", hash: genesis, eventId: null },
  predecessor: null,
};
describe("range kernel", () => {
  it("compresses a missing interval and retains independent corrupt row checks", () => {
    const state = inspectAuditRangeBatch(
      job,
      initializeAuditRange(job),
      [{ ...row("3"), content_hash: genesis }],
      true,
    );
    expect(state.breaks.map((b) => b.category)).toEqual([
      "missing_sequence_interval",
      "hash_mismatch",
      "head_mismatch",
    ]);
    expect(state.breaks[0]).toMatchObject({
      fromSequence: "1",
      toSequence: "2",
    });
    expect(state.verifiedPrefixTo).toBeNull();
  });
  it("continues with stored hashes to avoid cascaded false links", () => {
    const first = { ...row("1"), recomputed_canonical_content: "wrong" };
    const second = row("2", first.content_hash);
    const state = inspectAuditRangeBatch(
      { ...job, toSequence: "2", head: null },
      initializeAuditRange(job),
      [first, second],
      true,
    );
    expect(state.breaks).toHaveLength(1);
    expect(state.checkedCount).toBe("2");
  });
  it("reports trailing gaps only when provider is exhausted", () => {
    const partial = inspectAuditRangeBatch(
      { ...job, head: null },
      initializeAuditRange(job),
      [row("1")],
      false,
    );
    expect(partial.breaks).toEqual([]);
    expect(
      inspectAuditRangeBatch({ ...job, head: null }, partial, [], true)
        .breaks[0],
    ).toMatchObject({ fromSequence: "2", toSequence: "3" });
  });
  it("caps diagnostics", () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({
      ...row(String(i + 1)),
      chain_version: 9,
    }));
    const state = inspectAuditRangeBatch(
      { ...job, toSequence: "150", head: null },
      initializeAuditRange(job),
      rows,
      true,
    );
    expect(state.breaks).toHaveLength(100);
    expect(state.sampleSequences.length).toBeLessThanOrEqual(100);
    expect(
      auditRangeResult(
        {
          ...job,
          toSequence: "150",
          head: null,
          datasetContext: "unknown",
          legacyCount: "0",
          priorCheckpointStatus: "not_supplied",
        },
        state,
        new Date(),
      ).inspectionComplete,
    ).toBe(false);
  });
});
describe("range diagnostic boundaries", () => {
  it("verifies genesis and frozen head", () => {
    const first = row("1");
    const bounds = {
      ...job,
      toSequence: "1",
      head: { sequence: "1", hash: first.content_hash, eventId: first.id },
    };
    const state = inspectAuditRangeBatch(
      bounds,
      initializeAuditRange(bounds),
      [first],
      true,
    );
    expect(
      auditRangeResult(
        {
          ...bounds,
          datasetContext: "live",
          legacyCount: "0",
          priorCheckpointStatus: "matched",
        },
        state,
        new Date(),
      ).outcome,
    ).toBe("consistent");
  });
  it("validates a partial predecessor", () => {
    const predecessor = row("1"),
      second = row("2", predecessor.content_hash);
    const bounds = {
      ...job,
      fromSequence: "2",
      toSequence: "2",
      head: null,
      predecessor,
    };
    expect(
      inspectAuditRangeBatch(
        bounds,
        initializeAuditRange(bounds),
        [second],
        true,
      ).breaks,
    ).toEqual([]);
    expect(
      initializeAuditRange({ ...bounds, predecessor: null }).breaks[0]
        ?.category,
    ).toBe("predecessor_failure");
    expect(
      initializeAuditRange({
        ...bounds,
        predecessor: { ...predecessor, chain_version: 2 },
      }).breaks[0]?.category,
    ).toBe("predecessor_failure");
  });
  it("reports duplicate/reordered and out-of-bound rows", () => {
    const bounds = { ...job, head: null };
    let state = inspectAuditRangeBatch(
      bounds,
      initializeAuditRange(bounds),
      [row("1"), row("1"), row("3"), row("1")],
      false,
    );
    expect(state.breaks.map((b) => b.category)).toEqual(
      expect.arrayContaining([
        "duplicate_sequence",
        "reordered_rows",
        "missing_sequence_interval",
      ]),
    );
    state = inspectAuditRangeBatch(bounds, state, [row("4")], false);
    expect(state.breaks.at(-1)?.category).toBe("frozen_boundary_mismatch");
  });
  it("reports previous links without mutating the input", () => {
    const bounds = { ...job, toSequence: "1", head: null };
    const initial = initializeAuditRange(bounds);
    const state = inspectAuditRangeBatch(
      bounds,
      initial,
      [row("1", "1".repeat(64))],
      true,
    );
    expect(state.breaks[0]?.category).toBe("previous_link_mismatch");
    expect(initial.breaks).toEqual([]);
  });
  it("handles missing predecessor, legacy and saved checkpoints distinctly", () => {
    const bounds = {
      ...job,
      toSequence: "0",
      head: null,
      datasetContext: "restored" as const,
      legacyCount: "3",
      priorCheckpointStatus: "ahead" as const,
    };
    const state = inspectAuditRangeBatch(
      bounds,
      initializeAuditRange(bounds),
      [],
      true,
    );
    expect(auditRangeResult(bounds, state, new Date()).outcome).toBe(
      "checkpoint_unavailable",
    );
    expect(
      auditRangeResult(
        { ...bounds, priorCheckpointStatus: "not_supplied" },
        state,
        new Date(),
      ).outcome,
    ).toBe("legacy_unchained");
    expect(
      auditRangeResult(
        {
          ...bounds,
          toSequence: "1",
          legacyCount: "0",
          priorCheckpointStatus: "mismatch",
          head: {
            sequence: "1",
            hash: row("1").content_hash,
            eventId: row("1").id,
          },
        },
        inspectAuditRangeBatch(
          { ...bounds, toSequence: "1" },
          initializeAuditRange({ ...bounds, toSequence: "1" }),
          [row("1")],
          true,
        ),
        new Date(),
      ).outcome,
    ).toBe("integrity_break");
  });
});
it("never reports provider locations outside the authorized frozen range", () => {
  const bounds = { ...job, fromSequence: "2", head: null };
  const state = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [row("1")],
    false,
  );
  expect(state.breaks.map((b) => b.fromSequence)).not.toContain("1");
});
it("does not call an absent frozen head consistent", () => {
  const bounds = {
    ...job,
    toSequence: "1",
    head: null,
    datasetContext: "unknown" as const,
    legacyCount: "0",
    priorCheckpointStatus: "not_supplied" as const,
  };
  const state = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [row("1")],
    true,
  );
  expect(auditRangeResult(bounds, state, new Date()).outcome).toBe(
    "checkpoint_unavailable",
  );
});
it("uses exact checkpoint location and recalculates completeness at break cap", () => {
  const bounds = {
    ...job,
    head: { sequence: "3", hash: genesis, eventId: null },
    requestedToSequence: null,
    datasetContext: "unknown" as const,
    legacyCount: "0",
    priorCheckpointStatus: "mismatch" as const,
    priorCheckpoint: { sequence: "2", hash: genesis, eventId: null },
  };
  const state = {
    ...initializeAuditRange(bounds),
    exhausted: true,
    breaks: Array.from({ length: 99 }, () => ({
      category: "hash_mismatch" as const,
      fromSequence: "1",
      toSequence: "1",
    })),
  };
  const result = auditRangeResult(bounds, state, new Date());
  expect(result.breaks.at(-1)).toMatchObject({
    category: "prior_checkpoint_mismatch",
    fromSequence: "2",
  });
  expect(result.inspectionComplete).toBe(false);
  expect(result.requestedRange.to).toBeNull();
});
it("compares a partial selected boundary against the original frozen anchor", () => {
  const first = row("1"),
    bounds = {
      ...job,
      toSequence: "1",
      boundary: { sequence: "1", hash: genesis, eventId: first.id },
    };
  const state = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [first],
    true,
  );
  expect(state.breaks).toEqual([
    {
      category: "frozen_boundary_mismatch",
      fromSequence: "1",
      toSequence: "1",
    },
  ]);
  expect(
    inspectAuditRangeBatch(
      { ...bounds, boundary: { ...bounds.boundary, hash: first.content_hash } },
      initializeAuditRange(bounds),
      [first],
      true,
    ).breaks,
  ).toEqual([]);
});
it.each([
  { hash: genesis, eventId: "11111111-1111-4111-8111-111111111111" },
  { hash: "a".repeat(64), eventId: null },
])(
  "marks invalid genesis checkpoint unavailable without sequence zero disclosure",
  (head) => {
    const bounds = {
      ...job,
      toSequence: "0",
      head: { sequence: "0", ...head },
      datasetContext: "unknown" as const,
      legacyCount: "0",
      priorCheckpointStatus: "not_supplied" as const,
    };
    const state = inspectAuditRangeBatch(
      bounds,
      initializeAuditRange(bounds),
      [],
      true,
    );
    const result = auditRangeResult(bounds, state, new Date());
    expect(result.outcome).toBe("checkpoint_unavailable");
    expect(result.breaks).toEqual([]);
    expect(result.firstAffectedSequence).toBeNull();
  },
);
it("reports genuine genesis empty and legacy separately", () => {
  const bounds = {
    ...job,
    toSequence: "0",
    head: { sequence: "0", hash: genesis, eventId: null },
    datasetContext: "unknown" as const,
    legacyCount: "0",
    priorCheckpointStatus: "not_supplied" as const,
  };
  const state = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [],
    true,
  );
  expect(auditRangeResult(bounds, state, new Date()).outcome).toBe("empty");
  expect(
    auditRangeResult({ ...bounds, legacyCount: "2" }, state, new Date())
      .outcome,
  ).toBe("legacy_unchained");
});
it("reports unsupported frozen chain version", () => {
  const bounds = {
    ...job,
    head: { sequence: "3", hash: genesis, eventId: null, chainVersion: 2 },
  };
  expect(initializeAuditRange(bounds).breaks[0]?.category).toBe(
    "unsupported_version",
  );
});
it("reports a frozen head behind retained rows instead of consistent", () => {
  const first = row("1"),
    second = row("2", first.content_hash);
  const bounds = {
    ...job,
    toSequence: "2",
    head: { sequence: "1", hash: first.content_hash, eventId: first.id },
    boundary: { sequence: "2", hash: second.content_hash, eventId: second.id },
    datasetContext: "unknown" as const,
    legacyCount: "0",
    priorCheckpointStatus: "not_supplied" as const,
  };
  const state = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [first, second],
    true,
  );
  expect(auditRangeResult(bounds, state, new Date()).outcome).toBe(
    "integrity_break",
  );
  expect(state.breaks).toContainEqual({
    category: "head_mismatch",
    fromSequence: "2",
    toSequence: "2",
  });
});
it("reports head-behind break once and clamps its interval to a partial authorized range", () => {
  const bounds = {
    ...job,
    fromSequence: "3",
    toSequence: "3",
    head: { sequence: "0", hash: genesis, eventId: null },
    predecessor: row("2"),
  };
  const first = inspectAuditRangeBatch(
    bounds,
    initializeAuditRange(bounds),
    [],
    false,
  );
  const second = inspectAuditRangeBatch(
    bounds,
    first,
    [row("3", bounds.predecessor.content_hash)],
    true,
  );
  expect(
    second.breaks.filter((item) => item.category === "head_mismatch"),
  ).toEqual([
    { category: "head_mismatch", fromSequence: "3", toSequence: "3" },
  ]);
});
