/**
 * M4 owns the alert-to-reporting handoff, not a report or obligation record.
 * M6 will replace the unavailable adapter with an implementation that either
 * links an existing obligation or opens a draft after this request has been
 * independently authorised.
 */
export interface ReportingObligationPort {
  openOrLink(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      alertId: string;
      idempotencyKey: string;
    }>,
  ): Promise<
    | Readonly<{ outcome: "linked"; obligationId: string; status: string }>
    | Readonly<{ outcome: "downstream_unavailable" }>
  >;
}

export const REPORTING_OBLIGATION_PORT = Symbol("REPORTING_OBLIGATION_PORT");
