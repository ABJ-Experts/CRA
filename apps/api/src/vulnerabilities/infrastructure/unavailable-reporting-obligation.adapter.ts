import { Injectable } from "@nestjs/common";

import type { ReportingObligationPort } from "../application/reporting-obligation.port";

/** Safe default until M6 publishes its obligation-creation adapter. */
@Injectable()
export class UnavailableReportingObligationAdapter implements ReportingObligationPort {
  openOrLink(
    _input: Parameters<ReportingObligationPort["openOrLink"]>[0],
  ): Promise<Readonly<{ outcome: "downstream_unavailable" }>> {
    void _input;
    return Promise.resolve(
      Object.freeze({ outcome: "downstream_unavailable" }),
    );
  }
}
