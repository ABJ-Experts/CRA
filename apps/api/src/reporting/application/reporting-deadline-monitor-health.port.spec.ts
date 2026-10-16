import { ReportingDeadlineMonitorHealthUseCases } from "./reporting-deadline-monitor-health.port";
it("forwards cancellation without replacing coarse M6 readiness", async () => {
  const isReady = jest.fn().mockResolvedValue(true);
  const usecase = new ReportingDeadlineMonitorHealthUseCases({ isReady });
  const signal = new AbortController().signal;
  await expect(usecase.isReady(signal)).resolves.toBe(true);
  expect(isReady).toHaveBeenCalledWith(signal);
  await expect(usecase.isReady()).resolves.toBe(true);
});
