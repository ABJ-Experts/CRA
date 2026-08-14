/** The database and all callers use one bounded traversal contract. */
export const PRODUCT_RELATIONSHIP_MAX_DEPTH = 64;

export type ProductRelationshipGraphEdge = Readonly<{
  id: string;
  parentProductId: string;
  componentProductId: string;
}>;

export type CanonicalRelationshipPath = Readonly<{
  productPathIds: readonly string[];
  relationshipPathIds: readonly string[];
}>;

export type ProductComponentLinkDecision =
  | Readonly<{
      outcome: "allowed";
      candidateDepth: number;
      productPathIds: readonly string[];
      relationshipPathIds: readonly string[];
    }>
  | Readonly<{
      outcome: "cycle_detected";
      candidateDepth: number;
      productPathIds: readonly string[];
      relationshipPathIds: readonly string[];
    }>
  | Readonly<{
      outcome: "depth_exceeded";
      candidateDepth: number;
      productPathIds: readonly string[];
      relationshipPathIds: readonly string[];
    }>;

/**
 * Makes every walk independent of database return order. Product identifiers
 * precede relationship IDs so two equivalent graphs produce the same paths.
 */
export function sortProductRelationshipEdges(
  edges: readonly ProductRelationshipGraphEdge[],
): readonly ProductRelationshipGraphEdge[] {
  return Object.freeze(
    [...edges].sort((left, right) => {
      const parent = left.parentProductId.localeCompare(right.parentProductId);
      if (parent !== 0) return parent;
      const component = left.componentProductId.localeCompare(
        right.componentProductId,
      );
      if (component !== 0) return component;
      return left.id.localeCompare(right.id);
    }),
  );
}

/**
 * Finds the canonical shortest directed path. The product-node visited set
 * means malformed historic cycles cannot make a read unbounded.
 */
export function findCanonicalRelationshipPath(
  input: Readonly<{
    edges: readonly ProductRelationshipGraphEdge[];
    fromProductId: string;
    toProductId: string;
    maxDepth?: number;
  }>,
): CanonicalRelationshipPath | null {
  const maxDepth = input.maxDepth ?? PRODUCT_RELATIONSHIP_MAX_DEPTH;
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error("maxDepth must be a non-negative integer");
  }
  if (input.fromProductId === input.toProductId) {
    return freezePath([input.fromProductId], []);
  }

  const adjacency = adjacencyFor(input.edges);
  const queue: CanonicalRelationshipPath[] = [
    freezePath([input.fromProductId], []),
  ];
  const visited = new Set<string>([input.fromProductId]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const currentProductId = current.productPathIds.at(-1)!;
    if (current.relationshipPathIds.length >= maxDepth) continue;

    for (const edge of adjacency.get(currentProductId) ?? []) {
      if (visited.has(edge.componentProductId)) continue;
      const next = freezePath(
        [...current.productPathIds, edge.componentProductId],
        [...current.relationshipPathIds, edge.id],
      );
      if (edge.componentProductId === input.toProductId) return next;
      visited.add(edge.componentProductId);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Returns the largest number of directed component edges in the graph.
 * Existing corrupt cycles are deliberately reported as an unbounded depth so
 * a caller cannot accidentally accept an additional relationship.
 */
export function calculateLongestRelationshipDepth(
  edges: readonly ProductRelationshipGraphEdge[],
): number {
  const adjacency = adjacencyFor(edges);
  const productIds = new Set<string>();
  const indegrees = new Map<string, number>();
  for (const edge of edges) {
    productIds.add(edge.parentProductId);
    productIds.add(edge.componentProductId);
    indegrees.set(
      edge.componentProductId,
      (indegrees.get(edge.componentProductId) ?? 0) + 1,
    );
    indegrees.set(
      edge.parentProductId,
      indegrees.get(edge.parentProductId) ?? 0,
    );
  }
  // Start every component, not only roots. A disconnected corrupt cycle can
  // coexist with a valid rooted tree and must still block a new write.
  const starts = [...productIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthFrom = (productId: string): number => {
    const known = memo.get(productId);
    if (known !== undefined) return known;
    if (visiting.has(productId)) return Number.POSITIVE_INFINITY;
    visiting.add(productId);
    const depth = (adjacency.get(productId) ?? []).reduce(
      (maximum, edge) =>
        Math.max(maximum, 1 + depthFrom(edge.componentProductId)),
      0,
    );
    visiting.delete(productId);
    memo.set(productId, depth);
    return depth;
  };
  return starts.reduce(
    (maximum, productId) => Math.max(maximum, depthFrom(productId)),
    0,
  );
}

/**
 * Performs only graph policy. Persistence locks, tenant checks, audit facts,
 * and graph-version conflicts remain at the repository transaction boundary.
 */
export function evaluateProductComponentLink(
  input: Readonly<{
    edges: readonly ProductRelationshipGraphEdge[];
    parentProductId: string;
    componentProductId: string;
  }>,
): ProductComponentLinkDecision {
  if (input.parentProductId === input.componentProductId) {
    return freezeDecision({
      outcome: "cycle_detected",
      candidateDepth: 1,
      productPathIds: [input.parentProductId, input.componentProductId],
      relationshipPathIds: [],
    });
  }

  const reversePath = findCanonicalRelationshipPath({
    edges: input.edges,
    fromProductId: input.componentProductId,
    toProductId: input.parentProductId,
  });
  if (reversePath) {
    return freezeDecision({
      outcome: "cycle_detected",
      candidateDepth: reversePath.relationshipPathIds.length + 1,
      productPathIds: [...reversePath.productPathIds, input.componentProductId],
      relationshipPathIds: reversePath.relationshipPathIds,
    });
  }

  const candidateEdge: ProductRelationshipGraphEdge = Object.freeze({
    id: "__candidate__",
    parentProductId: input.parentProductId,
    componentProductId: input.componentProductId,
  });
  const candidateDepth = calculateLongestRelationshipDepth([
    ...input.edges,
    candidateEdge,
  ]);
  if (candidateDepth > PRODUCT_RELATIONSHIP_MAX_DEPTH) {
    return freezeDecision({
      outcome: "depth_exceeded",
      candidateDepth,
      productPathIds: [],
      relationshipPathIds: [],
    });
  }
  return freezeDecision({
    outcome: "allowed",
    candidateDepth,
    productPathIds: [],
    relationshipPathIds: [],
  });
}

function adjacencyFor(
  edges: readonly ProductRelationshipGraphEdge[],
): ReadonlyMap<string, readonly ProductRelationshipGraphEdge[]> {
  const grouped = new Map<string, ProductRelationshipGraphEdge[]>();
  for (const edge of sortProductRelationshipEdges(edges)) {
    const current = grouped.get(edge.parentProductId) ?? [];
    grouped.set(edge.parentProductId, [...current, edge]);
  }
  return new Map(
    [...grouped.entries()].map(([productId, entries]) => [
      productId,
      Object.freeze(entries),
    ]),
  );
}

function freezePath(
  productPathIds: readonly string[],
  relationshipPathIds: readonly string[],
): CanonicalRelationshipPath {
  return Object.freeze({
    productPathIds: Object.freeze([...productPathIds]),
    relationshipPathIds: Object.freeze([...relationshipPathIds]),
  });
}

function freezeDecision(
  decision: ProductComponentLinkDecision,
): ProductComponentLinkDecision {
  return Object.freeze({
    ...decision,
    productPathIds: Object.freeze([...decision.productPathIds]),
    relationshipPathIds: Object.freeze([...decision.relationshipPathIds]),
  });
}
