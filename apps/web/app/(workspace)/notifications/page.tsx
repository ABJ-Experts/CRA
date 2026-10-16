import { notificationFeedQuerySchema } from "@repo/contracts/notifications";

import { NotificationCentre } from "../../_features/notifications/notification-centre";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export default async function NotificationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const params = await searchParams;
  const parsed = notificationFeedQuerySchema.safeParse({
    view: "events",
    batchId: params.batchId,
    eventClass: params.eventClass,
    windowStart: params.windowStart,
  });
  const initialFilter = parsed.success
    ? {
        batchId: parsed.data.batchId,
        eventClass: parsed.data.eventClass,
        windowStart: parsed.data.windowStart,
      }
    : undefined;
  return (
    <NotificationCentre
      key={parsed.success ? JSON.stringify(initialFilter) : "invalid"}
      initialFilter={initialFilter}
      invalidFilter={!parsed.success}
    />
  );
}
