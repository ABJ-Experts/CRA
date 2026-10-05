import { describe, expect, it } from "vitest";

import NotificationsPage from "./page";

describe("NotificationsPage", () => {
  it("passes only parsed batch scope from a deep link", async () => {
    const view = await NotificationsPage({
      searchParams: Promise.resolve({
        batchId: "11111111-1111-4111-8111-111111111111",
      }),
    });
    expect(view.props.initialFilter).toEqual({
      batchId: "11111111-1111-4111-8111-111111111111",
      eventClass: undefined,
      windowStart: undefined,
    });
    expect(view.props.invalidFilter).toBe(false);
  });

  it("does not pass malformed or mixed tenant supplied scope into the feed", async () => {
    const view = await NotificationsPage({
      searchParams: Promise.resolve({
        batchId: "../other",
        eventClass: "finding_sla_breached",
      }),
    });
    expect(view.props.initialFilter).toBeUndefined();
    expect(view.props.invalidFilter).toBe(true);
  });

  it("accepts a paired event class and UTC window from a grouped summary", async () => {
    const view = await NotificationsPage({
      searchParams: Promise.resolve({
        eventClass: "finding_sla_breached",
        windowStart: "2026-10-05T11:00:00.000Z",
      }),
    });
    expect(view.props.initialFilter).toEqual({
      batchId: undefined,
      eventClass: "finding_sla_breached",
      windowStart: "2026-10-05T11:00:00.000Z",
    });
    expect(view.props.invalidFilter).toBe(false);
  });

  it("rejects repeated filter parameters rather than silently dropping the scope", async () => {
    const view = await NotificationsPage({
      searchParams: Promise.resolve({
        batchId: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      }),
    });
    expect(view.props.initialFilter).toBeUndefined();
    expect(view.props.invalidFilter).toBe(true);
  });
});
