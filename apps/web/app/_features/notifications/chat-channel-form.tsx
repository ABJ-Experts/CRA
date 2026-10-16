"use client";

import type {
  ChatChannel,
  ChatChannelMode,
  ChatDestinationInput,
  ChatEventClass,
} from "@repo/contracts/notifications";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { cn } from "@repo/ui/cn";
import { Input } from "@repo/ui/input";
import { useState, type FormEvent } from "react";

import { useChatProductsQuery } from "./notifications.queries";

const modes: readonly (readonly [ChatChannelMode, string])[] = [
  ["slack_webhook", "Slack incoming webhook"],
  ["slack_bot", "Slack bot"],
  ["teams_workflow_webhook", "Microsoft Teams Workflow webhook"],
  ["teams_bot_proactive", "Microsoft Teams proactive bot"],
];
const eventClasses: readonly (readonly [ChatEventClass, string])[] = [
  ["high_severity_alert", "High-severity alerts"],
  ["countdown_warning", "Countdown warnings"],
  ["approval_prompt", "Approval prompts"],
];
export type ChatChannelDraft = Readonly<{
  displayName: string;
  mode: ChatChannelMode;
  eventClasses: readonly ChatEventClass[];
  productIds: readonly string[];
  includeOrganizationWide: boolean;
  webhookUrl: string;
  botToken: string;
  channelId: string;
  tenantId: string;
  appId: string;
  clientSecret: string;
  serviceUrl: string;
  conversationId: string;
}>;

export function emptyDraft(): ChatChannelDraft {
  return {
    displayName: "",
    mode: "slack_webhook",
    eventClasses: ["high_severity_alert"],
    productIds: [],
    includeOrganizationWide: false,
    webhookUrl: "",
    botToken: "",
    channelId: "",
    tenantId: "",
    appId: "",
    clientSecret: "",
    serviceUrl: "",
    conversationId: "",
  };
}

export function destination(draft: ChatChannelDraft): ChatDestinationInput {
  switch (draft.mode) {
    case "slack_webhook":
    case "teams_workflow_webhook":
      return { mode: draft.mode, webhookUrl: draft.webhookUrl.trim() };
    case "slack_bot":
      return {
        mode: draft.mode,
        botToken: draft.botToken.trim(),
        channelId: draft.channelId.trim(),
      };
    case "teams_bot_proactive":
      return {
        mode: draft.mode,
        tenantId: draft.tenantId.trim(),
        appId: draft.appId.trim(),
        clientSecret: draft.clientSecret.trim(),
        serviceUrl: draft.serviceUrl.trim(),
        conversationId: draft.conversationId.trim(),
      };
  }
}

export function hasDestinationInput(draft: ChatChannelDraft): boolean {
  switch (draft.mode) {
    case "slack_webhook":
    case "teams_workflow_webhook":
      return draft.webhookUrl.trim() !== "";
    case "slack_bot":
      return draft.botToken.trim() !== "" || draft.channelId.trim() !== "";
    case "teams_bot_proactive":
      return [
        draft.tenantId,
        draft.appId,
        draft.clientSecret,
        draft.serviceUrl,
        draft.conversationId,
      ].some((value) => value.trim() !== "");
  }
}

export function chatModeLabel(mode: ChatChannelMode): string {
  return modes.find(([value]) => value === mode)?.[1] ?? mode;
}

export function ChatChannelForm({
  draft,
  selectedChannel,
  pending,
  updateDraft,
  onDestinationChanged,
  onSubmit,
  onCancel,
}: Readonly<{
  draft: ChatChannelDraft;
  selectedChannel: ChatChannel | undefined;
  pending: boolean;
  updateDraft: <K extends keyof ChatChannelDraft>(
    key: K,
    value: ChatChannelDraft[K],
  ) => void;
  onDestinationChanged: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}>) {
  const [search, setSearch] = useState("");
  const products = useChatProductsQuery(search.trim());
  return (
    <form
      className={cn("grid gap-3 rounded-xl border border-border bg-canvas p-3")}
      onSubmit={onSubmit}
    >
      <h4 className={cn("text-caption-1-semibold text-fg")}>
        {selectedChannel
          ? `Edit ${selectedChannel.displayName}`
          : "Add a chat channel"}
      </h4>
      <div className={cn("grid gap-3 sm:grid-cols-2")}>
        <Input
          label="Channel name"
          value={draft.displayName}
          onChange={(event) => updateDraft("displayName", event.target.value)}
          required
          maxLength={120}
          disabled={pending}
        />
        <label
          className={cn("grid gap-1 text-caption-1-semibold text-fg-muted")}
        >
          Delivery mode
          <select
            className={cn(
              "h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
            )}
            value={draft.mode}
            onChange={(event) =>
              updateDraft("mode", event.target.value as ChatChannelMode)
            }
            disabled={pending}
          >
            {modes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={cn("text-caption-1-regular text-fg-muted")}>
        {draft.mode === "slack_webhook"
          ? "Create an incoming webhook in the customer-installed Slack app. Its URL is bound to one channel."
          : draft.mode === "slack_bot"
            ? "Install the Slack app with chat:write and add the bot to the chosen channel before testing."
            : draft.mode === "teams_workflow_webhook"
              ? 'Create a Teams Workflow using "When a Teams webhook request is received" with the Anyone trigger, and assign a co-owner.'
              : "Install the proactive Teams bot in the target conversation first. Public-cloud Bot Framework endpoints are supported."}
      </p>
      {draft.mode === "slack_webhook" ||
      draft.mode === "teams_workflow_webhook" ? (
        <Input
          label="Webhook URL"
          type="password"
          autoComplete="off"
          value={draft.webhookUrl}
          onChange={(event) => {
            updateDraft("webhookUrl", event.target.value);
            onDestinationChanged();
          }}
          helperText={
            selectedChannel
              ? "Leave blank to keep the existing secret URL."
              : "Stored encrypted. The URL is never shown again."
          }
          disabled={pending}
        />
      ) : null}
      {draft.mode === "slack_bot" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2")}>
          <Input
            label="Slack bot token"
            type="password"
            autoComplete="off"
            value={draft.botToken}
            onChange={(event) => {
              updateDraft("botToken", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
          <Input
            label="Slack channel ID"
            value={draft.channelId}
            onChange={(event) => {
              updateDraft("channelId", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
        </div>
      ) : null}
      {draft.mode === "teams_bot_proactive" ? (
        <div className={cn("grid gap-3 sm:grid-cols-2")}>
          <Input
            label="Microsoft tenant ID"
            value={draft.tenantId}
            onChange={(event) => {
              updateDraft("tenantId", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
          <Input
            label="Bot application ID"
            value={draft.appId}
            onChange={(event) => {
              updateDraft("appId", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
          <Input
            label="Bot client secret"
            type="password"
            autoComplete="off"
            value={draft.clientSecret}
            onChange={(event) => {
              updateDraft("clientSecret", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
          <Input
            label="Bot service URL"
            value={draft.serviceUrl}
            onChange={(event) => {
              updateDraft("serviceUrl", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
          <Input
            label="Conversation ID"
            value={draft.conversationId}
            onChange={(event) => {
              updateDraft("conversationId", event.target.value);
              onDestinationChanged();
            }}
            disabled={pending}
          />
        </div>
      ) : null}
      <fieldset className={cn("grid gap-2")}>
        <legend className={cn("text-caption-1-semibold text-fg")}>
          Permitted event classes
        </legend>
        {eventClasses.map(([value, label]) => (
          <Checkbox
            key={value}
            label={label}
            checked={draft.eventClasses.includes(value)}
            onCheckedChange={(checked) =>
              updateDraft(
                "eventClasses",
                checked === true
                  ? [...draft.eventClasses, value]
                  : draft.eventClasses.filter((item) => item !== value),
              )
            }
            disabled={pending}
          />
        ))}
      </fieldset>
      <fieldset className={cn("grid gap-2")}>
        <legend className={cn("text-caption-1-semibold text-fg")}>
          Permitted products
        </legend>
        <Input
          label="Search products"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          helperText="Choose each product this channel may receive alerts about."
          disabled={pending}
        />
        {products.isLoading ? (
          <p
            role="status"
            className={cn("text-caption-1-regular text-fg-muted")}
          >
            Loading products…
          </p>
        ) : null}
        {products.isError ? (
          <p className={cn("text-caption-1-regular text-danger")}>
            Products are unavailable. Retry the search before saving.
          </p>
        ) : null}
        {(products.data?.products.rows ?? []).map((product) => (
          <Checkbox
            key={product.id}
            label={`${product.name} · ${product.internalCode}`}
            checked={draft.productIds.includes(product.id)}
            onCheckedChange={(checked) =>
              updateDraft(
                "productIds",
                checked === true
                  ? [...draft.productIds, product.id]
                  : draft.productIds.filter((id) => id !== product.id),
              )
            }
            disabled={pending}
          />
        ))}
        {draft.productIds.length > 0 ? (
          <div className={cn("flex flex-wrap items-center gap-2")}>
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Selected products: {draft.productIds.length}
            </p>
            {draft.productIds.map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  updateDraft(
                    "productIds",
                    draft.productIds.filter((current) => current !== id),
                  )
                }
              >
                Remove{" "}
                {products.data?.products.rows.find(
                  (product) => product.id === id,
                )?.name ?? id}
              </Button>
            ))}
          </div>
        ) : null}
        <Checkbox
          label="Include organization-wide deadline alerts"
          description="Only source events without a product scope, such as organization-wide M6 deadlines."
          checked={draft.includeOrganizationWide}
          onCheckedChange={(checked) =>
            updateDraft("includeOrganizationWide", checked === true)
          }
          disabled={pending}
        />
      </fieldset>
      <div
        className={cn("rounded-xl border border-border bg-surface-subtle p-3")}
      >
        <p className={cn("text-caption-1-semibold text-fg")}>
          Test message disclosure preview
        </p>
        <pre
          className={cn(
            "mt-2 whitespace-pre-wrap break-words text-caption-1-regular text-fg",
          )}
        >{`CRA Sentinel test notification\nChannel: ${draft.displayName.trim() || "<channel name>"}\nConfirmation code: <six-digit code>\nNo record data is included.`}</pre>
        <p className={cn("mt-3 text-caption-1-semibold text-fg")}>
          Live alert disclosure example
        </p>
        <pre
          className={cn(
            "mt-2 whitespace-pre-wrap break-words text-caption-1-regular text-fg",
          )}
        >
          {
            "CRA Sentinel\nHigh-severity alert · High\nEvent time: <UTC event time>\nOpen in CRA: <trusted application link>"
          }
        </pre>
        <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
          Event class, severity, time, and link vary per alert. No source
          titles, findings, drafts, or evidence are included. The link requires
          sign-in; approval is always completed in the application.
        </p>
      </div>
      <div className={cn("flex flex-wrap gap-2")}>
        <Button type="submit" size="sm" disabled={pending}>
          {selectedChannel ? "Save chat channel" : "Create chat channel"}
        </Button>
        {selectedChannel ? (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </form>
  );
}
