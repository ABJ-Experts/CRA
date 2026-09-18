export const REPORTING_DEADLINE_MONITOR_HEALTH_READER = Symbol(
  "REPORTING_DEADLINE_MONITOR_HEALTH_READER",
);

/** Read-only operational state; it contains no organization or user data. */
export interface ReportingDeadlineMonitorHealthReader {
  isReady(): Promise<boolean>;
}

export class ReportingDeadlineMonitorHealthUseCases {
  constructor(private readonly reader: ReportingDeadlineMonitorHealthReader) {}

  async isReady(): Promise<boolean> {
    return this.reader.isReady();
  }
}
