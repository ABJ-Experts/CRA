"use client";

import type {
  NotificationCategory,
  NotificationDelivery,
  NotificationDeliveryCursor,
  NotificationDeliveryStatus,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { Tag, type TagProps } from "@repo/ui/tag";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSession } from "../../_providers/session-provider";
import {
  useNotificationCriticalRouteQuery,
  useNotificationDeliveriesQuery,
  useRetryNotificationDeliveryMutation,
  useUpdateNotificationCriticalRouteMutation,
} from "./notifications.queries";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const statuses: readonly (readonly [
  NotificationDeliveryStatus | "",
  string,
])[] = [
  ["", "All delivery states"],
  ["queued", "Queued"],
  ["attempted", "Attempted"],
  ["failed", "Failed"],
  ["exhausted", "Exhausted"],
  ["provider_accepted", "Provider accepted"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
];
const categories: readonly (readonly [NotificationCategory | "", string])[] = [
  ["", "All categories"],
  ["finding_triage", "Finding triage"],
  ["evidence", "Evidence expiry"],
  ["supplier_owner", "Supplier owner requests"],
  ["support_period", "Support period"],
  ["reporting_deadline", "Reporting deadline"],
];

type DeliveryPage = Readonly<{
  scopeKey: string;
  cursor: NotificationDeliveryCursor | null;
  rows: readonly NotificationDelivery[];
}>;

type ScopedCursor = Readonly<{
  scopeKey: string;
  value: NotificationDeliveryCursor | null;
}>;

function title(value: string): string {
  return value.replaceAll("_", " ");
}

function date(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
}

function tone(status: NotificationDeliveryStatus): TagProps["tone"] {
  if (status === "failed" || status === "exhausted") return "red";
  if (status === "queued" || status === "attempted") return "orange";
  if (status === "delivered") return "green";
  return "blue";
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have permission to manage notification delivery.";
    if (error.status === 409)
      return "The notification route or delivery changed. Your draft is still here.";
    if (error.kind === "network")
      return "You are offline. Retry when the connection is restored.";
  }
  return "Notification delivery is temporarily unavailable.";
}

function DeliveryRow({
  delivery,
  canManage,
  onRetry,
  pending,
}: Readonly<{
  delivery: NotificationDelivery;
  canManage: boolean;
  onRetry: (delivery: NotificationDelivery) => void;
  pending: boolean;
}>) {
  return (
    <li className="rounded-xl border border-border bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption-1-semibold text-fg">
            {title(delivery.category)} · {title(delivery.sourceType)}
          </p>
          <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
            Delivery {delivery.deliveryRef}
          </p>
        </div>
        <Tag variant="dot" tone={tone(delivery.status)}>
          {title(delivery.status)}
        </Tag>
      </div>
      <dl className="mt-3 grid gap-2 text-caption-1-regular sm:grid-cols-3">
        <div>
          <dt className="text-fg-muted">Attempts</dt>
          <dd className="text-fg">{delivery.attemptCount}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Last attempt</dt>
          <dd className="text-fg">{date(delivery.lastAttemptAt)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Next attempt</dt>
          <dd className="text-fg">{date(delivery.nextAttemptAt)}</dd>
        </div>
      </dl>
      {delivery.safeErrorCode ? (
        <p className="mt-2 text-caption-1-regular text-danger">
          Delivery issue: {title(delivery.safeErrorCode)}
        </p>
      ) : null}
      {canManage && delivery.status === "exhausted" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={pending}
          onClick={() => onRetry(delivery)}
          aria-label={`Retry delivery ${delivery.deliveryRef}`}
        >
          Retry delivery
        </Button>
      ) : null}
    </li>
  );
}

export function NotificationAdminPanel({
  canManage,
}: Readonly<{ canManage: boolean }>) {
  const [status, setStatus] = useState<NotificationDeliveryStatus | "">(
    "failed",
  );
  const [category, setCategory] = useState<NotificationCategory | "">("");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [deliveryRecipientUserId, setDeliveryRecipientUserId] = useState("");
  const normalizedDeliveryRecipientUserId = deliveryRecipientUserId.trim();
  const deliveryRecipientValid =
    !normalizedDeliveryRecipientUserId ||
    uuidPattern.test(normalizedDeliveryRecipientUserId);
  const { session, permissions } = useSession();
  const canViewDeliveries = permissions.can_view_audit === true;
  const scopeKey = `${session?.organization?.id ?? "none"}:${canViewDeliveries}:${status}:${category}:${deliveryRecipientUserId}`;
  const [deliveryCursor, setDeliveryCursor] = useState<ScopedCursor | null>(
    null,
  );
  const [deliveryNextCursor, setDeliveryNextCursor] =
    useState<ScopedCursor | null>(null);
  const [deliveryPages, setDeliveryPages] = useState<readonly DeliveryPage[]>(
    [],
  );
  const activeCursor =
    deliveryCursor?.scopeKey === scopeKey ? deliveryCursor.value : null;
  const activeNextCursor =
    deliveryNextCursor?.scopeKey === scopeKey ? deliveryNextCursor.value : null;
  const routeEnabled = uuidPattern.test(recipientUserId);
  const route = useNotificationCriticalRouteQuery(
    routeEnabled ? recipientUserId : null,
    canManage,
  );
  const deliveries = useNotificationDeliveriesQuery(
    {
      status: status || undefined,
      category: category || undefined,
      recipientUserId:
        deliveryRecipientValid && normalizedDeliveryRecipientUserId
          ? normalizedDeliveryRecipientUserId
          : undefined,
      cursor: activeCursor ?? undefined,
      limit: 25,
    },
    canViewDeliveries && deliveryRecipientValid,
  );
  const updateRoute = useUpdateNotificationCriticalRouteMutation();
  const retry = useRetryNotificationDeliveryMutation();
  const [alternateUserId, setAlternateUserId] = useState("");
  const [routeDirty, setRouteDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routeDirty && route.data?.route) {
      setAlternateUserId(route.data.route.alternateUserId ?? "");
    }
  }, [route.data, routeDirty]);

  useEffect(() => {
    setDeliveryCursor(null);
    setDeliveryNextCursor(null);
    setDeliveryPages([]);
  }, [scopeKey]);

  useEffect(() => {
    if (
      !canViewDeliveries ||
      !deliveryRecipientValid ||
      !deliveries.data ||
      deliveries.isError
    )
      return;

    const currentCursor = activeCursor;
    const page = {
      scopeKey,
      cursor: currentCursor,
      rows: deliveries.data.rows,
    };
    setDeliveryNextCursor({ scopeKey, value: deliveries.data.nextCursor });
    setDeliveryPages((current) => {
      const existingIndex = current.findIndex(
        (candidate) =>
          candidate.scopeKey === scopeKey && candidate.cursor === currentCursor,
      );
      if (existingIndex === -1) return [...current, page];

      return current.map((candidate, index) =>
        index === existingIndex ? page : candidate,
      );
    });
  }, [
    activeCursor,
    deliveries.data,
    deliveries.isError,
    canViewDeliveries,
    deliveryRecipientValid,
    scopeKey,
  ]);

  const currentRoute = route.data?.route;
  const visibleRows = useMemo(() => {
    if (!canViewDeliveries || !deliveryRecipientValid) return [];
    const seen = new Set<string>();
    const rows: NotificationDelivery[] = [];
    for (const page of deliveryPages) {
      if (page.scopeKey !== scopeKey) continue;
      for (const delivery of page.rows) {
        if (seen.has(delivery.deliveryRef)) continue;
        seen.add(delivery.deliveryRef);
        rows.push(delivery);
      }
    }
    return rows;
  }, [canViewDeliveries, deliveryPages, deliveryRecipientValid, scopeKey]);

  async function saveRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!canManage) return;
    if (!routeEnabled || !currentRoute) {
      setError("Enter a valid accountable recipient user ID before saving.");
      return;
    }
    const normalizedAlternate = alternateUserId.trim();
    if (normalizedAlternate && !uuidPattern.test(normalizedAlternate)) {
      setError("Fallback recipient user ID must be a valid user identifier.");
      return;
    }
    try {
      const result = await updateRoute.mutateAsync({
        userId: recipientUserId,
        input: {
          expectedVersion: currentRoute.version,
          idempotencyKey: crypto.randomUUID(),
          alternateUserId: normalizedAlternate || null,
        },
      });
      setAlternateUserId(result.route.alternateUserId ?? "");
      setRouteDirty(false);
      setMessage("Critical route saved.");
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  async function retryDelivery(delivery: NotificationDelivery) {
    setMessage(null);
    setError(null);
    try {
      await retry.mutateAsync({
        deliveryRef: delivery.deliveryRef,
        input: {
          expectedVersion: delivery.version,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setMessage("Delivery retry queued.");
    } catch (cause) {
      setError(messageFor(cause));
    }
  }

  return (
    <section
      className="grid gap-5"
      aria-labelledby="notification-admin-heading"
    >
      <div>
        <h3
          id="notification-admin-heading"
          className="text-subhead-semibold text-fg"
        >
          Notification delivery
        </h3>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Critical regulatory alerts remain immediate. Alternate routes add a
          fallback recipient; they do not remove the accountable user.
        </p>
      </div>
      {!canManage ? (
        <p className="rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted">
          Only organization administrators with edit permission can change
          critical routes or retry deliveries.
        </p>
      ) : null}
      <form
        className="grid gap-3 rounded-xl border border-border bg-canvas p-3"
        onSubmit={saveRoute}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <Input
            label="Accountable recipient user ID"
            value={recipientUserId}
            onChange={(event) => {
              setRecipientUserId(event.target.value.trim());
              setRouteDirty(false);
              setMessage(null);
              setError(null);
            }}
            disabled={!canManage || updateRoute.isPending}
          />
          <Input
            label="Fallback recipient user ID"
            value={alternateUserId}
            onChange={(event) => {
              setAlternateUserId(event.target.value.trim());
              setRouteDirty(true);
              setMessage(null);
              setError(null);
            }}
            disabled={!canManage || !routeEnabled || updateRoute.isPending}
            helperText="Leave blank to clear the fallback recipient."
          />
        </div>
        {routeEnabled && route.isLoading ? (
          <p role="status" className="text-caption-1-regular text-fg-muted">
            Loading critical route…
          </p>
        ) : null}
        {routeEnabled && route.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-danger"
          >
            <p className="text-caption-1-regular">{messageFor(route.error)}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void route.refetch()}
            >
              Retry critical route
            </Button>
          </div>
        ) : null}
        {canManage ? (
          <div>
            <Button
              type="submit"
              size="sm"
              loading={updateRoute.isPending}
              disabled={!routeDirty || updateRoute.isPending}
            >
              Save critical route
            </Button>
          </div>
        ) : null}
      </form>
      <div
        className={cn(
          "grid gap-3 rounded-xl border border-border bg-surface-subtle p-3",
          !canViewDeliveries && "hidden",
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-caption-1-regular text-fg">
            Delivery status
            <select
              className="h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as typeof status)
              }
            >
              {statuses.map(([value, label]) => (
                <option key={`${value || "all"}-${label}`} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-caption-1-regular text-fg">
            Category
            <select
              className="h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as typeof category)
              }
            >
              {categories.map(([value, label]) => (
                <option key={`${value || "all"}-${label}`} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Input
          label="Delivery recipient user ID"
          value={deliveryRecipientUserId}
          onChange={(event) => setDeliveryRecipientUserId(event.target.value)}
          helperText="Filter by accountable or effective recipient. Leave blank for all recipients."
          error={
            deliveryRecipientValid
              ? undefined
              : "Enter a valid recipient user ID to filter delivery history."
          }
        />
        {deliveryRecipientValid && deliveries.isLoading ? (
          <p role="status" className="text-caption-1-regular text-fg-muted">
            Loading notification deliveries…
          </p>
        ) : null}
        {deliveryRecipientValid && deliveries.isError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-danger"
          >
            <p className="text-caption-1-regular">
              {messageFor(deliveries.error)}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void deliveries.refetch()}
            >
              Retry delivery history
            </Button>
          </div>
        ) : null}
        {deliveryRecipientValid &&
        !deliveries.isLoading &&
        !deliveries.isError &&
        visibleRows.length === 0 ? (
          <p className="text-caption-1-regular text-fg-muted">
            No notification deliveries match these filters.
          </p>
        ) : null}
        {visibleRows.length > 0 ? (
          <ul className="grid gap-2" aria-label="Notification deliveries">
            {visibleRows.map((delivery) => (
              <DeliveryRow
                key={delivery.deliveryRef}
                delivery={delivery}
                canManage={canManage}
                pending={retry.isPending}
                onRetry={(row) => void retryDelivery(row)}
              />
            ))}
          </ul>
        ) : null}
        {deliveryRecipientValid && !deliveries.isError && activeNextCursor ? (
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={deliveries.isLoading}
              onClick={() =>
                setDeliveryCursor({ scopeKey, value: activeNextCursor })
              }
            >
              Load more
            </Button>
          </div>
        ) : null}
      </div>
      {!canViewDeliveries ? (
        <p className="rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted">
          You do not have permission to view notification delivery history.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-caption-1-regular text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          {message}
        </p>
      ) : null}
    </section>
  );
}
