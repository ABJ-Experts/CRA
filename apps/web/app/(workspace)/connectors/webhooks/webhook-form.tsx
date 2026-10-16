"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  createWebhookEndpointInputSchema,
  updateWebhookEndpointInputSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  WebhookEndpoint,
  WebhookEventType,
} from "@repo/contracts/connectors/types";

export const webhookInputClass =
  "min-h-10 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
export function WebhookForm({
  endpoint,
  products,
  eventTypes,
  canSubmitSecret,
  pending,
  onSave,
  onDirtyChange,
}: {
  endpoint?: WebhookEndpoint;
  products: readonly { id: string; name: string }[];
  eventTypes: readonly WebhookEventType[];
  canSubmitSecret: boolean;
  pending: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (
    input: CreateWebhookEndpointInput | UpdateWebhookEndpointInput,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({
    displayName: endpoint?.displayName ?? "",
    url: endpoint?.url ?? "",
    eventTypes: endpoint?.eventTypes ?? [],
    productIds: endpoint?.productIds ?? [],
    retryPolicy: endpoint?.retryPolicy ?? {
      maxAttempts: 6,
      baseDelaySeconds: 5,
      maxDelaySeconds: 300,
    },
  }));
  const savedDraft = useRef(JSON.stringify(draft));
  const [expectedVersion, setExpectedVersion] = useState(
    endpoint?.version ?? 0,
  );
  const [secret, setSecret] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    onDirtyChange?.(
      JSON.stringify(draft) !== savedDraft.current || secret !== "",
    );
  }, [draft, secret, onDirtyChange]);
  function changeDraft(value: typeof draft) {
    idempotencyKey.current = null;
    setDraft(value);
  }
  const [message, setMessage] = useState<string | null>(null);
  const changed =
    endpoint !== undefined && endpoint.version !== expectedVersion;
  function toggle(
    key: "eventTypes" | "productIds",
    value: string,
    checked: boolean,
  ) {
    idempotencyKey.current = null;
    setDraft((current) => ({
      ...current,
      [key]: checked
        ? [...current[key], value]
        : current[key].filter((item) => item !== value),
    }));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const parsed = endpoint
      ? updateWebhookEndpointInputSchema.safeParse({
          ...draft,
          expectedVersion,
          idempotencyKey: idempotencyKey.current,
        })
      : createWebhookEndpointInputSchema.safeParse({
          ...draft,
          ...(secret ? { secretValue: secret } : {}),
          idempotencyKey: idempotencyKey.current,
        });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the endpoint configuration.",
      );
      return;
    }
    try {
      await onSave(parsed.data);
      savedDraft.current = JSON.stringify(draft);
      onDirtyChange?.(false);
      setSecret("");
      idempotencyKey.current = null;
      setMessage("Configuration saved. New endpoints start disabled.");
    } catch {
      setMessage(
        "Configuration outcome is unavailable. Reload current data and review before retrying; your non-secret draft is preserved.",
      );
    }
  }
  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      className={cn("grid gap-4 sm:grid-cols-2")}
    >
      <fieldset disabled={pending} className={cn("contents")}>
        <legend className={cn("sr-only")}>Webhook configuration</legend>
        <label className={cn("grid gap-2 text-subhead-regular text-fg")}>
          Display name
          <input
            required
            maxLength={120}
            className={cn(webhookInputClass)}
            value={draft.displayName}
            onChange={(event) =>
              changeDraft({ ...draft, displayName: event.target.value })
            }
          />
        </label>
        <label className={cn("grid gap-2 text-subhead-regular text-fg")}>
          HTTPS destination
          <input
            required
            type="url"
            className={cn(webhookInputClass)}
            value={draft.url}
            onChange={(event) =>
              changeDraft({ ...draft, url: event.target.value })
            }
          />
        </label>
        <p className={cn("text-caption-1-regular text-fg-muted sm:col-span-2")}>
          New endpoints start disabled. Approved public HTTPS hosts only; no
          redirects or on-prem routing. Payloads contain minimal resource links.
        </p>
        <fieldset
          className={cn("space-y-2 rounded-xl border border-border p-3")}
        >
          <legend className={cn("px-1 text-subhead-semibold text-fg")}>
            Event subscriptions
          </legend>
          {eventTypes.map((type) => (
            <label
              key={type}
              className={cn(
                "flex items-start gap-2 break-all text-caption-1-regular text-fg",
              )}
            >
              <input
                type="checkbox"
                checked={draft.eventTypes.includes(type)}
                onChange={(event) =>
                  toggle("eventTypes", type, event.target.checked)
                }
              />
              {type}
            </label>
          ))}
          {eventTypes.length === 0 && (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Load the event catalogue before saving.
            </p>
          )}
        </fieldset>
        <fieldset
          className={cn("space-y-2 rounded-xl border border-border p-3")}
        >
          <legend className={cn("px-1 text-subhead-semibold text-fg")}>
            Selected products ({draft.productIds.length}/100)
          </legend>
          {products.map((product) => (
            <label
              key={product.id}
              className={cn(
                "flex items-start gap-2 text-caption-1-regular text-fg",
              )}
            >
              <input
                type="checkbox"
                checked={draft.productIds.includes(product.id)}
                disabled={
                  !draft.productIds.includes(product.id) &&
                  draft.productIds.length >= 100
                }
                onChange={(event) =>
                  toggle("productIds", product.id, event.target.checked)
                }
              />
              {product.name}
            </label>
          ))}
          {products.length === 0 && (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              No available products on this page.
            </p>
          )}
          {draft.productIds
            .filter((id) => !products.some((product) => product.id === id))
            .map((id) => (
              <label
                key={id}
                className={cn(
                  "flex items-start gap-2 break-all text-caption-1-regular text-fg",
                )}
              >
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggle("productIds", id, false)}
                />
                Selected product {id}
              </label>
            ))}
        </fieldset>
        <fieldset className={cn("grid gap-3 sm:col-span-2 sm:grid-cols-3")}>
          <legend className={cn("mb-2 text-subhead-semibold text-fg")}>
            Retry limits
          </legend>
          {(
            ["maxAttempts", "baseDelaySeconds", "maxDelaySeconds"] as const
          ).map((key) => (
            <label
              key={key}
              className={cn("grid gap-2 text-caption-1-regular text-fg")}
            >
              {key === "maxAttempts"
                ? "Maximum attempts"
                : key === "baseDelaySeconds"
                  ? "Initial delay (seconds)"
                  : "Maximum delay (seconds)"}
              <input
                type="number"
                min={1}
                className={cn(webhookInputClass)}
                value={draft.retryPolicy[key]}
                onChange={(event) =>
                  changeDraft({
                    ...draft,
                    retryPolicy: {
                      ...draft.retryPolicy,
                      [key]: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
        </fieldset>
        {!endpoint && canSubmitSecret && (
          <label
            className={cn(
              "grid gap-2 text-subhead-regular text-fg sm:col-span-2",
            )}
          >
            Signing secret (optional; write-only base64)
            <input
              type="password"
              autoComplete="new-password"
              className={cn(webhookInputClass)}
              value={secret}
              onChange={(event) => {
                idempotencyKey.current = null;
                setSecret(event.target.value);
              }}
            />
            <span className={cn("text-caption-1-regular text-fg-muted")}>
              Supply 32 random bytes encoded as base64. The stored secret is
              never returned.
            </span>
          </label>
        )}
        {changed && (
          <div
            role="alert"
            className={cn(
              "space-y-2 text-subhead-regular text-danger sm:col-span-2",
            )}
          >
            <p>Configuration changed on the server. Your draft is preserved.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                idempotencyKey.current = null;
                setExpectedVersion(endpoint.version);
              }}
            >
              Reapply draft against version {endpoint.version}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                changeDraft({
                  displayName: endpoint.displayName,
                  url: endpoint.url,
                  eventTypes: endpoint.eventTypes,
                  productIds: endpoint.productIds,
                  retryPolicy: endpoint.retryPolicy,
                });
                setExpectedVersion(endpoint.version);
              }}
            >
              Discard draft and load current
            </Button>
          </div>
        )}
        {message && (
          <p
            role="alert"
            className={cn("text-subhead-regular text-fg sm:col-span-2")}
          >
            {message}
          </p>
        )}
        <div className={cn("sm:col-span-2")}>
          <Button
            type="submit"
            disabled={changed}
            loading={pending}
            loadingLabel="Saving endpoint"
          >
            {endpoint ? "Save configuration" : "Create disabled endpoint"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
