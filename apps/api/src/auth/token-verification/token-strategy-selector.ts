import type { TokenVerifierStrategy } from "./token-verifier.strategy";

const ALLOWED_ALGORITHMS = new Set(["HS256", "ES256", "RS256"]);

export class TokenStrategySelector {
  private readonly strategies: readonly TokenVerifierStrategy[];

  constructor(strategies: readonly TokenVerifierStrategy[]) {
    this.strategies = [...strategies];
  }

  select(algorithm: string): TokenVerifierStrategy | null {
    if (!ALLOWED_ALGORITHMS.has(algorithm)) return null;

    return (
      this.strategies.find((strategy) => strategy.supports(algorithm)) ?? null
    );
  }
}
