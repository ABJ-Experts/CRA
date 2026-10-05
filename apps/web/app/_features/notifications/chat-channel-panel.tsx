"use client";

import {
  createChatChannelInputSchema,
  updateChatChannelInputSchema,
  type ChatChannel,
  type ChatDelivery,
  type ChatDeliveryStatus,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";
import { ZodError } from "zod";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  ChatChannelForm,
  chatModeLabel,
  destination,
  emptyDraft,
  hasDestinationInput,
  type ChatChannelDraft,
} from "./chat-channel-form";
import {
  useChatChannelsQuery,
  useChatDeliveriesQuery,
  useConfirmChatChannelMutation,
  useCreateChatChannelMutation,
  useRetryChatDeliveryMutation,
  useSetChatChannelEnabledMutation,
  useTestChatChannelMutation,
  useUpdateChatChannelMutation,
} from "./notifications.queries";

const statuses: readonly (readonly [ChatDeliveryStatus | "", string])[] = [
  ["", "All delivery states"],
  ["queued", "Queued"],
  ["attempted", "Attempted"],
  ["failed", "Failed"],
  ["exhausted", "Exhausted"],
  ["provider_accepted", "Provider accepted"],
  ["uncertain", "Uncertain"],
  ["cancelled", "Cancelled"],
];

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return (
      error.issues[0]?.message ?? "Check the channel fields and try again."
    );
  }
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "Your permission to manage chat alerts has changed.";
    if (error.status === 409)
      return "This channel or delivery changed. Your draft is still here; refresh before trying again.";
    if (error.kind === "network")
      return "You are offline. Your draft is still here; retry when connected.";
    if (error.kind === "invalid_request") return error.message;
  }
  return "Chat alerts are temporarily unavailable. Please retry.";
}

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
}

function title(value: string): string {
  return value.replaceAll("_", " ");
}

function DeliveryRow({
  row,
  canManage,
  pending,
  onRetry,
}: Readonly<{
  row: ChatDelivery;
  canManage: boolean;
  pending: boolean;
  onRetry: (row: ChatDelivery) => Promise<boolean>;
}>) {
  const [confirmUncertainRetry, setConfirmUncertainRetry] = useState(false);
  const [retrySubmitted, setRetrySubmitted] = useState(false);

  async function submitRetry() {
    setRetrySubmitted(true);
    if (!(await onRetry(row))) setRetrySubmitted(false);
  }
  return (
    <li className={cn("rounded-xl border border-border bg-canvas p-3")}>
      <div className={cn("flex flex-wrap items-start justify-between gap-2")}>
        <div>
          <p className={cn("text-caption-1-semibold text-fg")}>
            {title(row.eventClass)} · {title(row.sourceType)}
          </p>
          <p
            className={cn(
              "mt-1 break-all text-caption-1-regular text-fg-muted",
            )}
          >
            Delivery {row.id}
          </p>
        </div>
        <Tag
          variant="dot"
          tone={
            row.status === "exhausted" || row.status === "failed"
              ? "red"
              : row.status === "uncertain"
                ? "orange"
                : "blue"
          }
        >
          {title(row.status)}
        </Tag>
      </div>
      <dl
        className={cn("mt-3 grid gap-2 text-caption-1-regular sm:grid-cols-3")}
      >
        <div>
          <dt className={cn("text-fg-muted")}>Attempts</dt>
          <dd className={cn("text-fg")}>{row.attemptCount}</dd>
        </div>
        <div>
          <dt className={cn("text-fg-muted")}>Last attempt</dt>
          <dd className={cn("text-fg")}>{formatDate(row.lastAttemptAt)}</dd>
        </div>
        <div>
          <dt className={cn("text-fg-muted")}>Next attempt</dt>
          <dd className={cn("text-fg")}>{formatDate(row.nextAttemptAt)}</dd>
        </div>
      </dl>
      {row.safeErrorCode ? (
        <p className={cn("mt-2 text-caption-1-regular text-danger")}>
          Delivery issue: {title(row.safeErrorCode)}
        </p>
      ) : null}
      {row.status === "uncertain" ? (
        <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
          The vendor may have accepted this message. Review the destination
          before taking further action.
        </p>
      ) : null}
      {canManage && row.status === "uncertain" && confirmUncertainRetry ? (
        <div className={cn("mt-3 grid gap-2")}>
          <p className={cn("text-caption-1-regular text-danger")}>
            Retrying may duplicate a message the vendor already accepted. Check
            the destination before confirming.
          </p>
          <div className={cn("flex flex-wrap gap-2")}>
            <Button
              type="button"
              size="sm"
              disabled={pending || retrySubmitted}
              onClick={() => void submitRetry()}
            >
              Confirm retry delivery {row.id}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmUncertainRetry(false)}
            >
              Cancel retry
            </Button>
          </div>
        </div>
      ) : null}
      {canManage &&
      (row.status === "exhausted" ||
        (row.status === "uncertain" && !confirmUncertainRetry)) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn("mt-3")}
          disabled={pending || retrySubmitted}
          onClick={() =>
            row.status === "uncertain"
              ? setConfirmUncertainRetry(true)
              : void submitRetry()
          }
        >
          {row.status === "uncertain" ? "Review retry" : "Retry delivery"}{" "}
          {row.id}
        </Button>
      ) : null}
    </li>
  );
}

export function ChatChannelPanel({
  canManage,
  canViewAudit,
}: Readonly<{ canManage: boolean; canViewAudit: boolean }>) {
  const channels = useChatChannelsQuery(canManage);
  const create = useCreateChatChannelMutation();
  const update = useUpdateChatChannelMutation();
  const test = useTestChatChannelMutation();
  const confirm = useConfirmChatChannelMutation();
  const enable = useSetChatChannelEnabledMutation();
  const retry = useRetryChatDeliveryMutation();
  const [draft, setDraft] = useState<ChatChannelDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [destinationDirty, setDestinationDirty] = useState(false);
  const [status, setStatus] = useState<ChatDeliveryStatus | "">("");
  const [cursorTrail, setCursorTrail] = useState<
    readonly (string | undefined)[]
  >([undefined]);
  const cursor = cursorTrail.at(-1);
  const [challenge, setChallenge] = useState<
    | Readonly<{ channelId: string; testId: string; expiresAt: string }>
    | undefined
  >();
  const [confirmationCode, setConfirmationCode] = useState("");
  const [overrides, setOverrides] = useState<
    Readonly<Record<string, ChatChannel>>
  >({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deliveries = useChatDeliveriesQuery(
    { status: status || undefined, cursor, limit: 25 },
    canViewAudit,
  );
  const fetchedChannels = channels.data?.channels ?? [];
  const channelRows = [
    ...fetchedChannels.map((channel) => {
      const override = overrides[channel.id];
      return override && override.version > channel.version
        ? override
        : channel;
    }),
    ...Object.values(overrides).filter(
      (channel) =>
        !fetchedChannels.some((current) => current.id === channel.id),
    ),
  ];
  const selectedChannel = channelRows.find(
    (channel) => channel.id === editingId,
  );
  const pending =
    create.isPending ||
    update.isPending ||
    test.isPending ||
    confirm.isPending ||
    enable.isPending;

  function clearFeedback() {
    setFeedback(null);
    setError(null);
  }

  function editChannel(channel: ChatChannel) {
    setEditingId(channel.id);
    setDestinationDirty(false);
    setDraft({
      ...emptyDraft(),
      displayName: channel.displayName,
      mode: channel.mode,
      eventClasses: channel.eventClasses,
      productIds: channel.productIds,
      includeOrganizationWide: channel.includeOrganizationWide,
    });
    clearFeedback();
  }

  async function saveChannel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    if (!canManage) return;
    const common = {
      displayName: draft.displayName.trim(),
      eventClasses: [...draft.eventClasses],
      productIds: [...draft.productIds],
      includeOrganizationWide: draft.includeOrganizationWide,
      idempotencyKey: crypto.randomUUID(),
    };
    if (editingId && !selectedChannel) {
      setError(
        "This channel is no longer available. Refresh channels before saving.",
      );
      return;
    }
    try {
      if (selectedChannel) {
        const input = updateChatChannelInputSchema.parse({
          ...common,
          expectedVersion: selectedChannel.version,
          destination:
            (destinationDirty && hasDestinationInput(draft)) ||
            draft.mode !== selectedChannel.mode
              ? destination(draft)
              : undefined,
        });
        const result = await update.mutateAsync({
          channelId: selectedChannel.id,
          input,
        });
        setOverrides((current) => ({
          ...current,
          [result.channel.id]: result.channel,
        }));
        setEditingId(null);
        setDraft(emptyDraft());
        setDestinationDirty(false);
        if (challenge?.channelId === result.channel.id) {
          setChallenge(undefined);
          setConfirmationCode("");
        }
        setFeedback(
          "Chat channel saved. Send a new synthetic test and confirm the code before enabling.",
        );
      } else {
        const input = createChatChannelInputSchema.parse({
          ...common,
          destination: destination(draft),
        });
        const result = await create.mutateAsync(input);
        setOverrides((current) => ({
          ...current,
          [result.channel.id]: result.channel,
        }));
        setDraft(emptyDraft());
        setDestinationDirty(false);
        setFeedback(
          "Chat channel created. Send a synthetic test and confirm the code before enabling.",
        );
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function testChannel(channel: ChatChannel) {
    clearFeedback();
    try {
      const result = await test.mutateAsync({
        channelId: channel.id,
        input: {
          expectedVersion: channel.version,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setChallenge({
        channelId: channel.id,
        testId: result.testId,
        expiresAt: result.expiresAt,
      });
      setConfirmationCode("");
      const refreshed = await channels.refetch();
      const refreshedChannel = (
        refreshed.isError ? undefined : refreshed.data
      )?.channels.find((current) => current.id === channel.id);
      if (refreshedChannel) {
        setOverrides((current) => ({
          ...current,
          [refreshedChannel.id]: refreshedChannel,
        }));
      }
      setFeedback(
        "A synthetic test was accepted. Read its six-digit code in the destination and enter it here.",
      );
      if (!refreshedChannel) {
        setError(
          "The test was sent, but channel state could not be refreshed. Keep the code and retry confirmation when the connection returns.",
        );
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function confirmChannel(channel: ChatChannel) {
    clearFeedback();
    if (!challenge || challenge.channelId !== channel.id) return;
    try {
      const refreshed = await channels.refetch();
      const current = (
        refreshed.isError ? undefined : refreshed.data
      )?.channels.find((candidate) => candidate.id === channel.id);
      if (!current) {
        setError(
          "Could not refresh the channel before confirmation. Keep the code and retry.",
        );
        return;
      }
      const result = await confirm.mutateAsync({
        channelId: channel.id,
        input: {
          expectedVersion: current.version,
          idempotencyKey: crypto.randomUUID(),
          testId: challenge.testId,
          code: confirmationCode.trim(),
        },
      });
      setOverrides((current) => ({
        ...current,
        [result.channel.id]: result.channel,
      }));
      setChallenge(undefined);
      setConfirmationCode("");
      setFeedback("Destination confirmed. You can now enable this channel.");
    } catch (cause) {
      setError(
        cause instanceof ApiClientError &&
          (cause.status === 400 || cause.status === 422)
          ? "The confirmation code is invalid or expired. Check the destination and try again."
          : errorMessage(cause),
      );
    }
  }

  async function toggleChannel(channel: ChatChannel) {
    clearFeedback();
    try {
      const result = await enable.mutateAsync({
        channelId: channel.id,
        input: {
          expectedVersion: channel.version,
          idempotencyKey: crypto.randomUUID(),
          enabled: !channel.enabled,
        },
      });
      setOverrides((current) => ({
        ...current,
        [result.channel.id]: result.channel,
      }));
      setFeedback(
        result.channel.enabled
          ? "Chat channel enabled."
          : "Chat channel disabled.",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function retryDelivery(row: ChatDelivery): Promise<boolean> {
    clearFeedback();
    try {
      await retry.mutateAsync({
        deliveryId: row.id,
        input: {
          expectedVersion: row.version,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      setFeedback("Chat delivery retry queued.");
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    }
  }

  function updateDraft<K extends keyof ChatChannelDraft>(
    key: K,
    value: ChatChannelDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearFeedback();
  }
  return (
    <section
      className={cn("grid gap-4 border-t border-border pt-5")}
      aria-labelledby="chat-alerts-heading"
    >
      <div>
        <h3
          id="chat-alerts-heading"
          className={cn("text-subhead-semibold text-fg")}
        >
          Chat alerts
        </h3>
        <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
          Slack and Microsoft Teams add a channel for urgent alerts. Critical
          email and in-app notices remain active if chat delivery fails.
        </p>
      </div>
      {!canManage ? (
        <p
          className={cn(
            "rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted",
          )}
        >
          Only organization administrators with edit permission can configure
          chat channels.
        </p>
      ) : (
        <>
          <ChatChannelForm
            draft={draft}
            selectedChannel={selectedChannel}
            pending={pending}
            updateDraft={updateDraft}
            onDestinationChanged={() => setDestinationDirty(true)}
            onSubmit={saveChannel}
            onCancel={() => {
              setEditingId(null);
              setDraft(emptyDraft());
              setDestinationDirty(false);
              clearFeedback();
            }}
          />
          {channels.isLoading ? (
            <p
              role="status"
              className={cn("text-caption-1-regular text-fg-muted")}
            >
              Loading chat channels…
            </p>
          ) : null}
          {channels.isError ? (
            <div
              aria-live="polite"
              className={cn("flex flex-wrap items-center gap-2")}
            >
              <p className={cn("text-caption-1-regular text-danger")}>
                {errorMessage(channels.error)}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void channels.refetch()}
              >
                Retry channels
              </Button>
            </div>
          ) : null}
          {!channels.isLoading &&
          !channels.isError &&
          channelRows.length === 0 ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              No chat channels configured.
            </p>
          ) : null}
          {channelRows.length > 0 ? (
            <ul className={cn("grid gap-2")} aria-label="Chat channels">
              {channelRows.map((channel) => (
                <li
                  key={channel.id}
                  className={cn(
                    "rounded-xl border border-border bg-canvas p-3",
                  )}
                >
                  <div
                    className={cn(
                      "flex flex-wrap items-start justify-between gap-2",
                    )}
                  >
                    <div>
                      <p className={cn("text-caption-1-semibold text-fg")}>
                        {channel.displayName}
                      </p>
                      <p className={cn("text-caption-1-regular text-fg-muted")}>
                        {chatModeLabel(channel.mode)} ·{" "}
                        {channel.productIds.length} products
                        {channel.includeOrganizationWide
                          ? " · organization-wide deadlines"
                          : ""}
                      </p>
                    </div>
                    <Tag
                      variant="dot"
                      tone={
                        channel.enabled
                          ? "green"
                          : channel.verified
                            ? "blue"
                            : "orange"
                      }
                    >
                      {channel.enabled
                        ? "Enabled"
                        : channel.verified
                          ? "Verified, disabled"
                          : "Needs test"}
                    </Tag>
                  </div>
                  <p
                    className={cn("mt-2 text-caption-1-regular text-fg-muted")}
                  >
                    Events: {channel.eventClasses.map(title).join(", ")}
                  </p>
                  {channel.safeErrorCode ? (
                    <p
                      role="alert"
                      className={cn("mt-2 text-caption-1-regular text-danger")}
                    >
                      {channel.safeErrorCode === "route_admin_revoked"
                        ? "Route disabled because its configuring admin lost access. Retest and confirm before enabling."
                        : `Route unavailable: ${title(channel.safeErrorCode)}. Review and retest before enabling.`}
                    </p>
                  ) : null}
                  <div className={cn("mt-3 flex flex-wrap gap-2")}>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => editChannel(channel)}
                    >
                      Edit {channel.displayName}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || editingId === channel.id}
                      onClick={() => void testChannel(channel)}
                    >
                      Send test to {channel.displayName}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        pending ||
                        editingId === channel.id ||
                        (!channel.verified && !channel.enabled)
                      }
                      onClick={() => void toggleChannel(channel)}
                    >
                      {channel.enabled
                        ? `Disable ${channel.displayName}`
                        : `Enable ${channel.displayName}`}
                    </Button>
                  </div>
                  {challenge?.channelId === channel.id ? (
                    <div
                      className={cn(
                        "mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end",
                      )}
                    >
                      <Input
                        label={`Confirmation code for ${channel.displayName}`}
                        value={confirmationCode}
                        onChange={(event) =>
                          setConfirmationCode(event.target.value)
                        }
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        helperText={`Check the synthetic test message. Code expires ${formatDate(challenge.expiresAt)}.`}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={pending || !/^\d{6}$/.test(confirmationCode)}
                        onClick={() => void confirmChannel(channel)}
                      >
                        Confirm {channel.displayName}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {canViewAudit ? (
        <div
          className={cn(
            "grid gap-3 rounded-xl border border-border bg-surface-subtle p-3",
          )}
        >
          <h4 className={cn("text-caption-1-semibold text-fg")}>
            Chat delivery history
          </h4>
          <label className={cn("grid gap-1 text-caption-1-regular text-fg")}>
            Delivery state
            <select
              className={cn(
                "h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
              )}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as ChatDeliveryStatus | "");
                setCursorTrail([undefined]);
              }}
            >
              {statuses.map(([value, label]) => (
                <option key={value || "all"} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {deliveries.isLoading ? (
            <p
              role="status"
              className={cn("text-caption-1-regular text-fg-muted")}
            >
              Loading chat deliveries…
            </p>
          ) : null}
          {deliveries.isError ? (
            <div
              aria-live="polite"
              className={cn("flex flex-wrap items-center gap-2")}
            >
              <p className={cn("text-caption-1-regular text-danger")}>
                {errorMessage(deliveries.error)}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void deliveries.refetch()}
              >
                Retry chat history
              </Button>
            </div>
          ) : null}
          {!deliveries.isLoading &&
          !deliveries.isError &&
          (deliveries.data?.rows.length ?? 0) === 0 ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              No chat deliveries match this state.
            </p>
          ) : null}
          {(deliveries.data?.rows.length ?? 0) > 0 ? (
            <ul className={cn("grid gap-2")} aria-label="Chat deliveries">
              {deliveries.data?.rows.map((row) => (
                <DeliveryRow
                  key={row.id}
                  row={row}
                  canManage={canManage}
                  pending={retry.isPending}
                  onRetry={retryDelivery}
                />
              ))}
            </ul>
          ) : null}
          <div className={cn("flex flex-wrap gap-2")}>
            {cursorTrail.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deliveries.isLoading}
                onClick={() =>
                  setCursorTrail((current) => current.slice(0, -1))
                }
              >
                Previous page
              </Button>
            ) : null}
            {deliveries.data?.nextCursor ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={deliveries.isLoading}
                onClick={() =>
                  setCursorTrail((current) => [
                    ...current,
                    deliveries.data?.nextCursor ?? undefined,
                  ])
                }
              >
                Next page
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p
          className={cn(
            "rounded-xl border border-border bg-surface-subtle p-3 text-caption-1-regular text-fg-muted",
          )}
        >
          You do not have permission to view chat delivery history.
        </p>
      )}
      {error ? (
        <p role="alert" className={cn("text-caption-1-regular text-danger")}>
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p role="status" className={cn("text-caption-1-regular text-fg-muted")}>
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
