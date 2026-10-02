"use client";

import { notificationFeedDestinationResponseSchema } from "@repo/contracts/notifications";
import type {
  NotificationCategory,
  NotificationFeedCursor,
  NotificationFeedItem,
  NotificationFeedReadFilter,
  NotificationFeedRef,
  NotificationFeedSeverity,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import { sessionKeys } from "../session/session.keys";
import { PageHeading } from "../../dashboard/_components/dashboard-chrome";
import { notificationsApi } from "./notifications.api";
import {
  useMarkNotificationReadMutation,
  useNotificationFeedQuery,
} from "./notifications.queries";

const categories: readonly (readonly [NotificationCategory | "", string])[] = [
  ["", "All categories"],
  ["finding_triage", "Finding triage"],
  ["evidence", "Evidence"],
  ["supplier_owner", "Supplier owner"],
  ["support_period", "Support period"],
  ["reporting_deadline", "Reporting deadline"],
];
const severities: readonly (readonly [
  NotificationFeedSeverity | "",
  string,
])[] = [
  ["", "All severities"],
  ["info", "Information"],
  ["warning", "Warning"],
  ["high", "High"],
  ["critical", "Critical"],
];
const fieldClass =
  "h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function feedErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have access to notifications in this organization.";
    if (error.kind === "network")
      return "Notifications are offline. Other work remains available; retry when connected.";
  }
  return "Notifications are temporarily unavailable. Retry to see current work.";
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have access to these notifications.";
    if (error.status === 404) return "Notification is no longer available.";
    if (error.status === 409)
      return "Notifications changed in another tab. Your selection is still here; refresh and retry.";
    if (error.kind === "network")
      return "Notifications are offline. Your selection is still here; retry when connected.";
  }
  return "This notification action could not finish. Retry after refreshing the feed.";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The server resolves destinations; parse again immediately before navigation. */
function safeDestination(value: unknown): string | null {
  const parsed = notificationFeedDestinationResponseSchema.safeParse(value);
  return parsed.success && parsed.data.state === "available"
    ? parsed.data.url
    : null;
}

export function NotificationCentre() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = useSession();
  const scopeKey = `${session?.organization?.id ?? "none"}:${session?.user.id ?? "none"}`;
  const lastScope = useRef(scopeKey);
  const actionAlertRef = useRef<HTMLDivElement | null>(null);
  const scopeChanged = lastScope.current !== scopeKey;
  const [category, setCategory] = useState<NotificationCategory | "">("");
  const [severity, setSeverity] = useState<NotificationFeedSeverity | "">("");
  const [read, setRead] = useState<NotificationFeedReadFilter>("all");
  const [cursors, setCursors] = useState<
    readonly (NotificationFeedCursor | undefined)[]
  >([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<NotificationFeedRef>>(
    new Set(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [opening, setOpening] = useState<NotificationFeedRef | null>(null);
  const markRead = useMarkNotificationReadMutation();

  useEffect(() => {
    if (lastScope.current === scopeKey) return;
    lastScope.current = scopeKey;
    setCursors([undefined]);
    setPageIndex(0);
    setSelected(new Set());
    setMessage(null);
    setActionError(null);
  }, [scopeKey]);

  useEffect(() => {
    if (actionError) actionAlertRef.current?.focus();
  }, [actionError]);

  const query = useMemo(
    () => ({
      category: category || undefined,
      severity: severity || undefined,
      read,
      cursor: cursors[pageIndex],
      limit: 25,
    }),
    [category, severity, read, cursors, pageIndex],
  );
  const feed = useNotificationFeedQuery(
    query,
    Boolean(
      session?.organization?.id &&
      session?.user.id &&
      !sessionLoading &&
      !sessionError,
    ),
  );
  const items =
    sessionLoading || sessionError || scopeChanged || feed.isError
      ? []
      : (feed.data?.items ?? []);
  const unreadSelected = items.filter(
    (item) => selected.has(item.ref) && !item.read,
  );

  function resetPage() {
    setCursors([undefined]);
    setPageIndex(0);
    setSelected(new Set());
    setMessage(null);
    setActionError(null);
  }

  function select(ref: NotificationFeedRef, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked && next.size < 50) next.add(ref);
      if (!checked) next.delete(ref);
      return next;
    });
  }

  async function mark(items: readonly NotificationFeedItem[]) {
    if (items.length === 0 || items.length > 50) return;
    setActionError(null);
    setMessage(null);
    const requestedScope = scopeKey;
    try {
      await markRead.mutateAsync({
        items: items.map((item) => ({
          ref: item.ref,
          expectedFingerprint: item.fingerprint,
        })),
        idempotencyKey: crypto.randomUUID(),
      });
      if (lastScope.current !== requestedScope) return;
      setSelected(new Set());
      setMessage(
        `${items.length} notification${items.length === 1 ? "" : "s"} marked as read.`,
      );
    } catch (error) {
      if (lastScope.current === requestedScope)
        setActionError(actionErrorMessage(error));
    }
  }

  async function open(item: NotificationFeedItem) {
    setActionError(null);
    setMessage(null);
    setOpening(item.ref);
    const requestedScope = scopeKey;
    try {
      const destination = await notificationsApi.destination(item.ref);
      if (lastScope.current !== requestedScope) return;
      const url = safeDestination(destination);
      if (!url) {
        setActionError("Notification is no longer available.");
        return;
      }
      router.push(url);
    } catch (error) {
      if (lastScope.current === requestedScope)
        setActionError(actionErrorMessage(error));
    } finally {
      setOpening(null);
    }
  }

  const statusMessage = sessionError
    ? "Could not verify notification access. Retry your session before viewing this feed."
    : feed.isError
      ? feedErrorMessage(feed.error)
      : actionError;
  const hasPrevious = pageIndex > 0;
  const nextCursor = feed.data?.nextCursor;

  return (
    <div className="space-y-5 px-6 pb-10 lg:px-[30px]">
      <PageHeading
        title="Notifications"
        subtitle="Recent source events and delivery issues that you can access."
        actions={
          <Link
            className="text-subhead-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            href="/account"
          >
            Notification preferences
          </Link>
        }
      />
      <section
        aria-label="Notification filters"
        className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:grid-cols-3"
      >
        <label className="space-y-1 text-caption-1-regular text-fg">
          Category
          <select
            className={cn(fieldClass)}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as NotificationCategory | "");
              resetPage();
            }}
          >
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption-1-regular text-fg">
          Severity
          <select
            className={cn(fieldClass)}
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value as NotificationFeedSeverity | "");
              resetPage();
            }}
          >
            {severities.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption-1-regular text-fg">
          Read state
          <select
            className={cn(fieldClass)}
            value={read}
            onChange={(event) => {
              setRead(event.target.value as NotificationFeedReadFilter);
              resetPage();
            }}
          >
            <option value="all">All notifications</option>
            <option value="unread">Unread only</option>
            <option value="read">Read only</option>
          </select>
        </label>
      </section>

      {sessionLoading || feed.isLoading || scopeChanged ? (
        <p
          role="status"
          className="rounded-xl border border-border p-5 text-caption-1-regular text-fg-muted"
        >
          Loading notifications…
        </p>
      ) : null}
      {!session?.organization?.id && !sessionLoading ? (
        <p
          role="status"
          className="rounded-xl border border-border p-5 text-caption-1-regular text-fg-muted"
        >
          Select an organization to view notifications.
        </p>
      ) : null}
      {statusMessage ? (
        <div
          ref={actionAlertRef}
          tabIndex={-1}
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-danger bg-canvas p-4 text-caption-1-regular text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span>{statusMessage}</span>
          {sessionError ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void queryClient.invalidateQueries({
                  queryKey: sessionKeys.all,
                })
              }
            >
              Retry session
            </Button>
          ) : feed.isError ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void feed.refetch()}
            >
              Retry notifications
            </Button>
          ) : null}
        </div>
      ) : null}
      {message && !feed.isError ? (
        <p
          role="status"
          aria-live="polite"
          className="text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}

      {feed.data &&
      items.length === 0 &&
      !feed.isError &&
      !sessionLoading &&
      !scopeChanged ? (
        <div className="rounded-xl border border-border bg-canvas p-8 text-center">
          <h2 className="text-subhead-semibold text-fg">
            {read === "unread" ? "You're all caught up" : "No notifications"}
          </h2>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            {read === "unread"
              ? "No unread notifications match these filters."
              : "Source events appear here when they need your attention."}
          </p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <section aria-label="Notification feed" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p
              role="status"
              aria-live="polite"
              className="text-caption-1-regular text-fg-muted"
            >
              {items.length} notification{items.length === 1 ? "" : "s"} on this
              page.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={unreadSelected.length === 0 || markRead.isPending}
              onClick={() => void mark(unreadSelected)}
            >
              Mark selected as read
            </Button>
          </div>
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.ref}
                className={cn(
                  "rounded-xl border border-border bg-canvas p-4",
                  !item.read && "border-primary",
                )}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    checked={selected.has(item.ref)}
                    onChange={(event) => select(item.ref, event.target.checked)}
                    aria-label={`Select ${item.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-subhead-semibold text-fg">
                        {item.title}
                      </h2>
                      <span className="rounded-full border border-border px-2 py-0.5 text-caption-2-semibold text-fg">
                        {item.read ? "Read" : "Unread"}
                      </span>
                      <span className="text-caption-1-regular text-fg-muted">
                        {item.severity === "info"
                          ? "Information"
                          : item.severity[0]?.toUpperCase() +
                            item.severity.slice(1)}
                      </span>
                      {item.noticeKind === "failure" ? (
                        <span className="text-caption-1-semibold text-danger">
                          Delivery issue
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-caption-1-regular text-fg-muted">
                      {item.summary}
                    </p>
                    <p className="mt-2 text-caption-2-regular text-fg-subtle">
                      {formatDate(item.occurredAt)}
                    </p>
                    {item.sourceState === "unavailable" ? (
                      <p className="mt-2 text-caption-1-regular text-fg-muted">
                        Source unavailable
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.sourceState === "available" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={opening === item.ref}
                          onClick={() => void open(item)}
                          aria-label={`Open ${item.title}`}
                        >
                          Open source
                        </Button>
                      ) : null}
                      {!item.read ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markRead.isPending}
                          onClick={() => void mark([item])}
                          aria-label={`Mark ${item.title} as read`}
                        >
                          Mark as read
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <nav
            aria-label="Notification pages"
            className="flex items-center justify-between gap-3 text-caption-1-regular text-fg-muted"
          >
            <span>Page {pageIndex + 1}</span>
            <div className="flex gap-2">
              {hasPrevious ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPageIndex((value) => value - 1);
                    setSelected(new Set());
                  }}
                >
                  Previous page
                </Button>
              ) : null}
              {nextCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={feed.isFetching}
                  onClick={() => {
                    setCursors((current) => [
                      ...current.slice(0, pageIndex + 1),
                      nextCursor,
                    ]);
                    setPageIndex((value) => value + 1);
                    setSelected(new Set());
                  }}
                >
                  Next page
                </Button>
              ) : null}
            </div>
          </nav>
        </section>
      ) : null}
    </div>
  );
}
