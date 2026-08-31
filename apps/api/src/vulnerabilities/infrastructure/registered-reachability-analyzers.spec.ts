import { ZodError } from "zod";

import { parseRegisteredReachabilityAnalyzers } from "./registered-reachability-analyzers";

describe("parseRegisteredReachabilityAnalyzers", () => {
  it("fails closed to no registered analyzers when deployment config is absent", () => {
    expect(parseRegisteredReachabilityAnalyzers(undefined)).toEqual([]);
    expect(parseRegisteredReachabilityAnalyzers(" ")).toEqual([]);
  });

  it("parses exact adapter/version/capability registrations", () => {
    expect(
      parseRegisteredReachabilityAnalyzers(
        JSON.stringify([
          {
            adapterId: "acme-reachability",
            version: "2.4.0",
            ecosystem: "npm",
            buildFormat: "node_modules",
          },
        ]),
      ),
    ).toEqual([
      {
        adapterId: "acme-reachability",
        version: "2.4.0",
        ecosystem: "npm",
        buildFormat: "node_modules",
      },
    ]);
  });

  it("rejects malformed or duplicate registrations at process startup", () => {
    expect(() => parseRegisteredReachabilityAnalyzers("not-json")).toThrow(
      ZodError,
    );
    expect(() =>
      parseRegisteredReachabilityAnalyzers(
        JSON.stringify([
          {
            adapterId: "acme-reachability",
            version: "2.4.0",
            ecosystem: "npm",
            buildFormat: "node_modules",
          },
          {
            adapterId: "acme-reachability",
            version: "2.4.0",
            ecosystem: "npm",
            buildFormat: "node_modules",
          },
        ]),
      ),
    ).toThrow(ZodError);
  });
});
