import {
  PRODUCT_RELATIONSHIP_MAX_DEPTH,
  calculateLongestRelationshipDepth,
  evaluateProductComponentLink,
  findCanonicalRelationshipPath,
  sortProductRelationshipEdges,
} from "./product-relationship-graph-policy";
import fc from "fast-check";

const edges = [
  { id: "edge-c", parentProductId: "root", componentProductId: "right" },
  { id: "edge-a", parentProductId: "root", componentProductId: "left" },
  { id: "edge-b", parentProductId: "left", componentProductId: "leaf" },
] as const;

describe("product relationship graph policy", () => {
  it("uses a fixed maximum traversal depth", () => {
    expect(PRODUCT_RELATIONSHIP_MAX_DEPTH).toBe(64);
  });

  it("orders adjacency and chooses paths canonically", () => {
    expect(sortProductRelationshipEdges(edges).map((edge) => edge.id)).toEqual([
      "edge-b",
      "edge-a",
      "edge-c",
    ]);
    expect(
      findCanonicalRelationshipPath({
        edges,
        fromProductId: "root",
        toProductId: "leaf",
      }),
    ).toEqual({
      productPathIds: ["root", "left", "leaf"],
      relationshipPathIds: ["edge-a", "edge-b"],
    });
  });

  it("rejects direct and indirect cycles with a canonical existing path", () => {
    expect(
      evaluateProductComponentLink({
        edges: [edges[0]],
        parentProductId: "right",
        componentProductId: "root",
      }),
    ).toEqual({
      outcome: "cycle_detected",
      candidateDepth: 2,
      productPathIds: ["root", "right", "root"],
      relationshipPathIds: ["edge-c"],
    });
    expect(
      evaluateProductComponentLink({
        edges,
        parentProductId: "leaf",
        componentProductId: "root",
      }),
    ).toEqual({
      outcome: "cycle_detected",
      candidateDepth: 3,
      productPathIds: ["root", "left", "leaf", "root"],
      relationshipPathIds: ["edge-a", "edge-b"],
    });
  });

  it("rejects an edge that would exceed the 64-level bound", () => {
    const chain = Array.from(
      { length: PRODUCT_RELATIONSHIP_MAX_DEPTH },
      (_, index) => ({
        id: `edge-${String(index).padStart(2, "0")}`,
        parentProductId: `p-${index}`,
        componentProductId: `p-${index + 1}`,
      }),
    );

    expect(calculateLongestRelationshipDepth(chain)).toBe(
      PRODUCT_RELATIONSHIP_MAX_DEPTH,
    );
    expect(
      evaluateProductComponentLink({
        edges: chain,
        parentProductId: "p-64",
        componentProductId: "p-65",
      }),
    ).toEqual({
      outcome: "depth_exceeded",
      candidateDepth: PRODUCT_RELATIONSHIP_MAX_DEPTH + 1,
      productPathIds: [],
      relationshipPathIds: [],
    });
  });

  it("treats a disconnected historic cycle as unbounded", () => {
    expect(
      calculateLongestRelationshipDepth([
        {
          id: "root-leaf",
          parentProductId: "root",
          componentProductId: "leaf",
        },
        { id: "a-b", parentProductId: "a", componentProductId: "b" },
        { id: "b-a", parentProductId: "b", componentProductId: "a" },
      ]),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("accepts an acyclic link and exposes the resulting maximum depth", () => {
    expect(
      evaluateProductComponentLink({
        edges,
        parentProductId: "right",
        componentProductId: "tail",
      }),
    ).toEqual({
      outcome: "allowed",
      candidateDepth: 2,
      productPathIds: [],
      relationshipPathIds: [],
    });
  });

  it("keeps generated acyclic graphs bounded and every resolved path simple", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 190 }),
        (productCount, selectedPairs) => {
          const possibleEdges = Array.from(
            { length: productCount },
            (_, parentIndex) =>
              Array.from(
                { length: productCount - parentIndex - 1 },
                (_, offset) => ({
                  parentProductId: `p-${parentIndex}`,
                  componentProductId: `p-${parentIndex + offset + 1}`,
                }),
              ),
          ).flat();
          const generatedEdges = possibleEdges.flatMap((edge, index) =>
            selectedPairs[index % selectedPairs.length]
              ? [{ ...edge, id: `edge-${index}` }]
              : [],
          );

          expect(
            calculateLongestRelationshipDepth(generatedEdges),
          ).toBeLessThanOrEqual(productCount - 1);
          const path = findCanonicalRelationshipPath({
            edges: generatedEdges,
            fromProductId: "p-0",
            toProductId: `p-${productCount - 1}`,
          });
          if (path) {
            expect(new Set(path.productPathIds).size).toBe(
              path.productPathIds.length,
            );
            expect(path.relationshipPathIds.length).toBeLessThanOrEqual(
              PRODUCT_RELATIONSHIP_MAX_DEPTH,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects every generated back-edge into a directed component chain", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: PRODUCT_RELATIONSHIP_MAX_DEPTH }),
        (depth) => {
          const chain = Array.from({ length: depth }, (_, index) => ({
            id: `edge-${index}`,
            parentProductId: `p-${index}`,
            componentProductId: `p-${index + 1}`,
          }));
          const decision = evaluateProductComponentLink({
            edges: chain,
            parentProductId: `p-${depth}`,
            componentProductId: "p-0",
          });

          expect(decision.outcome).toBe("cycle_detected");
          expect(decision.productPathIds.at(0)).toBe("p-0");
          expect(decision.productPathIds.at(-1)).toBe("p-0");
          expect(new Set(decision.productPathIds.slice(0, -1)).size).toBe(
            decision.productPathIds.length - 1,
          );
        },
      ),
      { numRuns: 64 },
    );
  });
});
