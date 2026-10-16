export type PortfolioEndpoint = "products" | "concentration" | "detail";
export interface PortfolioReadPort {
  read(
    orgId: string,
    input: Readonly<{
      actorId: string;
      endpoint: PortfolioEndpoint;
      filters: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<unknown>;
}
export class PortfolioScopeChangedError extends Error {}
