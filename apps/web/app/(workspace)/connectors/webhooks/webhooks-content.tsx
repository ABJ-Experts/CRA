"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
} from "@repo/contracts/connectors/types";
import { useSession } from "../../../_providers/session-provider";
import { useMocksReady } from "../../../_providers/providers";
import { webhooksApi } from "../../../_features/connectors/webhooks.api";
import {
  useWebhookCommand,
  useWebhookQueries,
} from "../../../_features/connectors/webhooks.queries";
import {
  PageHeading,
  SectionCard,
} from "../../../dashboard/_components/dashboard-chrome";
import { WebhookForm, webhookInputClass } from "./webhook-form";
import { WebhookDeliveryPanel } from "./webhook-deliveries";

function Pager({
  page,
  pageCount,
  change,
  label,
}: {
  page: number;
  pageCount: number;
  change: (page: number) => void;
  label: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-wrap items-center gap-3 text-caption-1-regular text-fg",
      )}
    >
      <Button
        type="button"
        variant="outline"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Previous
      </Button>
      <span>
        Page {page} of {pageCount}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={page >= pageCount}
        onClick={() => change(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
function QueryError({ retry }: { retry: () => unknown }) {
  return (
    <div role="alert" className={cn("space-y-2")}>
      <p className={cn("text-subhead-regular text-danger")}>
        Unable to load current data. Check your connection and permissions, then
        retry.
      </p>
      <Button type="button" variant="outline" onClick={() => void retry()}>
        Retry loading
      </Button>
    </div>
  );
}

export function WebhooksContent() {
  const { session } = useSession();
  return (
    <WebhooksWorkspace key={session?.organization?.id ?? "no-organization"} />
  );
}
function WebhooksWorkspace() {
  const { session, permissions, role, isLoading } = useSession();
  const mocksReady = useMocksReady();
  const live = mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const organizationId = session?.organization?.id;
  const canView = permissions.can_view_connectors === true;
  const canEdit = permissions.can_edit_connectors === true;
  const canCreate = permissions.can_create_connectors === true;
  const canSecret = canEdit && role === "owner";
  const [endpointId, selectEndpoint] = useState("");
  const [deliveryId, selectDelivery] = useState("");
  const [creating, setCreating] = useState(false);
  const [endpointPage, setEndpointPage] = useState(1);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [attemptPage, setAttemptPage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [formDirty, setFormDirty] = useState(false);
  const [formRevision, setFormRevision] = useState(0);
  const [secret, setSecret] = useState("");
  const [overlap, setOverlap] = useState(3600);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const command = useWebhookCommand();
  const commandKeys = useRef<Readonly<Record<string, string>>>({});
  const queries = useWebhookQueries(
    endpointId,
    deliveryId,
    endpointPage,
    deliveryPage,
    attemptPage,
    live && Boolean(organizationId) && canView,
    productPage,
  );
  const endpoint = queries.endpoint.data?.endpoint;
  function discardDraft() {
    return (
      !(formDirty || secret || reason) ||
      window.confirm("Discard unsaved webhook changes?")
    );
  }
  function openEndpoint(id: string, saved = false) {
    if (!saved && (endpointId !== id || creating) && !discardDraft()) return;
    setFormDirty(false);
    selectEndpoint(id);
    selectDelivery("");
    setDeliveryPage(1);
    setAttemptPage(1);
    setCreating(false);
    setSecret("");
    setReason("");
    setMessage(null);
  }
  async function save(
    input: CreateWebhookEndpointInput | UpdateWebhookEndpointInput,
  ) {
    const result = await command.run(() => {
      if ("expectedVersion" in input) {
        if (!endpoint)
          throw new Error("Reload the endpoint before saving configuration.");
        return webhooksApi.update(endpoint.id, input);
      }
      return webhooksApi.create(input);
    });
    openEndpoint(result.endpoint.id, true);
    setFormRevision((value) => value + 1);
  }
  async function act(
    action: "enable" | "disable" | "test" | "rotate" | "revoke",
  ) {
    if (!endpoint) return;
    setMessage(null);
    const key = `${endpoint.id}:${endpoint.version}:${action}`;
    commandKeys.current = {
      ...commandKeys.current,
      [key]: commandKeys.current[key] ?? crypto.randomUUID(),
    };
    const metadata = {
      expectedVersion: endpoint.version,
      idempotencyKey: commandKeys.current[key]!,
    };
    try {
      await command.run<unknown>(() => {
        switch (action) {
          case "enable":
            return webhooksApi.enable(endpoint.id, metadata);
          case "disable":
            return webhooksApi.disable(endpoint.id, { ...metadata, reason });
          case "test":
            return webhooksApi.test(endpoint.id, metadata);
          case "rotate":
            return webhooksApi.rotateSecret(endpoint.id, {
              ...metadata,
              secretValue: secret,
              overlapSeconds: overlap,
            });
          case "revoke":
            return webhooksApi.revokeSecret(endpoint.id, {
              ...metadata,
              reason,
            });
        }
      });
      commandKeys.current = {};
      if (action === "rotate") setSecret("");
      setMessage(
        action === "test"
          ? "Signed test delivery queued. Inspect delivery history for its result."
          : "Endpoint action completed.",
      );
    } catch {
      setMessage(
        "Action outcome is unavailable. Reload current data and check permissions, configuration and versions before retrying.",
      );
    }
  }
  const eventTypes =
    queries.catalogue.data?.eventTypes.map((item) => item.eventType) ?? [];
  const products = queries.products.data?.products.rows ?? [];
  return (
    <div className={cn("flex flex-col gap-6 px-6 py-6 lg:px-[30px]")}>
      <PageHeading
        title="Outbound webhooks"
        subtitle="Signed resource events, controlled receivers and auditable delivery attempts."
        actions={
          <Link
            className={cn(
              "text-subhead-regular text-fg underline underline-offset-4",
            )}
            href="/connectors"
          >
            Integration hub
          </Link>
        }
      />
      {!live ? (
        <SectionCard>
          <p className={cn("text-subhead-regular text-fg-muted")}>
            Outbound webhooks require the live backend.
          </p>
        </SectionCard>
      ) : isLoading ? (
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Loading workspace…
        </p>
      ) : !organizationId ? (
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Select an organization before managing webhooks.
        </p>
      ) : !canView ? (
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          You do not have permission to view webhooks.
        </p>
      ) : (
        <>
          <SectionCard title="Receivers">
            <div
              className={cn(
                "mb-4 flex flex-wrap items-center justify-between gap-3",
              )}
            >
              <p className={cn("text-subhead-regular text-fg-muted")}>
                Selected products only. No evidence/report bodies or automatic
                regulatory submissions.
              </p>
              {canCreate && (
                <Button
                  type="button"
                  disabled={command.pending}
                  onClick={() => {
                    if (!discardDraft()) return;
                    setFormDirty(false);
                    setCreating(!creating);
                    selectEndpoint("");
                    setSecret("");
                  }}
                >
                  {creating ? "Close create form" : "Add webhook endpoint"}
                </Button>
              )}
            </div>
            {queries.endpoints.isPending ? (
              <p
                role="status"
                className={cn("text-subhead-regular text-fg-muted")}
              >
                Loading receivers…
              </p>
            ) : queries.endpoints.isError ? (
              <QueryError retry={queries.endpoints.refetch} />
            ) : (
              <>
                <div
                  role="region"
                  aria-label="Webhook receivers, scroll horizontally"
                  tabIndex={0}
                  className={cn(
                    "overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <table
                    className={cn(
                      "w-full min-w-[48rem] text-left text-caption-1-regular text-fg",
                    )}
                  >
                    <caption className={cn("sr-only")}>
                      Configured webhook receivers
                    </caption>
                    <thead>
                      <tr>
                        {[
                          "Receiver",
                          "State",
                          "Subscription",
                          "Last delivered",
                          "Safe category",
                          "Details",
                        ].map((heading) => (
                          <th
                            key={heading}
                            scope="col"
                            className={cn("border-b border-border px-2 py-3")}
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {queries.endpoints.data?.endpoints.rows.map((item) => (
                        <tr key={item.id}>
                          <td className={cn("px-2 py-3")}>
                            <p>{item.displayName}</p>
                            <p className={cn("break-all text-fg-muted")}>
                              {item.url}
                            </p>
                          </td>
                          <td className={cn("px-2 py-3")}>
                            {item.status.replaceAll("_", " ")}
                          </td>
                          <td className={cn("px-2 py-3")}>
                            {item.productIds.length} products ·{" "}
                            {item.eventTypes.length} events
                          </td>
                          <td className={cn("px-2 py-3")}>
                            {item.lastDeliveredAt
                              ? new Date(item.lastDeliveredAt).toLocaleString()
                              : "Never"}
                          </td>
                          <td className={cn("px-2 py-3")}>
                            {item.lastFailureCategory ?? "None"}
                          </td>
                          <td className={cn("px-2 py-3")}>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={command.pending}
                              aria-label={`Open webhook ${item.displayName}`}
                              onClick={() => openEndpoint(item.id)}
                            >
                              Open
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {queries.endpoints.data?.endpoints.rows.length === 0 && (
                  <p className={cn("py-4 text-subhead-regular text-fg-muted")}>
                    No endpoints configured. Add a disabled endpoint, select
                    products and events, then submit a signing secret and test
                    the receiver.
                  </p>
                )}
                <Pager
                  label="Receiver pages"
                  page={endpointPage}
                  pageCount={queries.endpoints.data?.endpoints.pageCount ?? 1}
                  change={setEndpointPage}
                />
              </>
            )}
          </SectionCard>
          {(creating || endpointId) && (
            <SectionCard
              title={creating ? "Create receiver" : "Receiver configuration"}
            >
              {!creating && queries.endpoint.isPending ? (
                <p
                  role="status"
                  className={cn("text-subhead-regular text-fg-muted")}
                >
                  Loading receiver…
                </p>
              ) : !creating && queries.endpoint.isError ? (
                <QueryError retry={queries.endpoint.refetch} />
              ) : (
                <>
                  {queries.catalogue.isError ? (
                    <QueryError retry={queries.catalogue.refetch} />
                  ) : queries.products.isError ? (
                    <QueryError retry={queries.products.refetch} />
                  ) : canEdit || (creating && canCreate) ? (
                    <>
                      <WebhookForm
                        key={`${endpointId}:${formRevision}`}
                        endpoint={creating ? undefined : endpoint}
                        products={products}
                        eventTypes={eventTypes}
                        canSubmitSecret={canSecret}
                        pending={command.pending}
                        onSave={save}
                        onDirtyChange={setFormDirty}
                      />
                      <div className={cn("mt-4")}>
                        <Pager
                          label="Product selection pages"
                          page={productPage}
                          pageCount={
                            queries.products.data?.products.pageCount ?? 1
                          }
                          change={setProductPage}
                        />
                      </div>
                    </>
                  ) : (
                    <p className={cn("text-subhead-regular text-fg-muted")}>
                      Receiver: {endpoint?.url}. Editing requires connector-edit
                      permission.
                    </p>
                  )}
                  {endpoint && !creating && (
                    <div
                      className={cn(
                        "mt-6 space-y-4 border-t border-border pt-4",
                      )}
                    >
                      <h3 className={cn("text-headline-semibold text-fg")}>
                        Connection and signing
                      </h3>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={command.pending}
                        onClick={() => {
                          void queries.endpoint.refetch();
                          void queries.deliveries.refetch();
                        }}
                      >
                        Reload current receiver
                      </Button>
                      <p
                        className={cn(
                          "break-all text-caption-1-regular text-fg",
                        )}
                      >
                        Version {endpoint.version} · Scope{" "}
                        {endpoint.scopeRevision} · Destination{" "}
                        {endpoint.destinationRevision}. Signing key:{" "}
                        {endpoint.signingKeyId ?? "Not configured"}. Previous
                        key overlap:{" "}
                        {endpoint.previousKeyExpiresAt
                          ? new Date(
                              endpoint.previousKeyExpiresAt,
                            ).toLocaleString()
                          : "None"}
                        .
                      </p>
                      {canEdit && (
                        <>
                          <div className={cn("flex flex-wrap gap-2")}>
                            <Button
                              type="button"
                              variant="outline"
                              loading={command.pending}
                              disabled={!endpoint.hasSecret}
                              onClick={() => void act("test")}
                            >
                              Send signed test
                            </Button>
                            {!endpoint.enabled && (
                              <Button
                                type="button"
                                loading={command.pending}
                                disabled={!endpoint.hasSecret}
                                onClick={() => void act("enable")}
                              >
                                Enable endpoint
                              </Button>
                            )}
                          </div>
                          <label
                            className={cn(
                              "grid gap-2 text-subhead-regular text-fg",
                            )}
                          >
                            Change reason
                            <textarea
                              maxLength={500}
                              disabled={command.pending}
                              className={cn(webhookInputClass)}
                              value={reason}
                              onChange={(event) => {
                                commandKeys.current = {};
                                setReason(event.target.value);
                              }}
                            />
                          </label>
                          <div className={cn("flex flex-wrap gap-2")}>
                            {endpoint.enabled && (
                              <Button
                                type="button"
                                variant="outline"
                                loading={command.pending}
                                disabled={!reason.trim()}
                                onClick={() => void act("disable")}
                              >
                                Disable and cancel pending
                              </Button>
                            )}
                            {canSecret && (
                              <Button
                                type="button"
                                variant="outline"
                                loading={command.pending}
                                disabled={!endpoint.hasSecret || !reason.trim()}
                                onClick={() => void act("revoke")}
                              >
                                Revoke signing secret
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                      {canSecret && (
                        <div className={cn("grid gap-3 sm:grid-cols-2")}>
                          <label
                            className={cn(
                              "grid gap-2 text-subhead-regular text-fg",
                            )}
                          >
                            New signing secret (write-only base64)
                            <input
                              type="password"
                              disabled={command.pending}
                              autoComplete="new-password"
                              className={cn(webhookInputClass)}
                              value={secret}
                              onChange={(event) => {
                                commandKeys.current = {};
                                setSecret(event.target.value);
                              }}
                            />
                          </label>
                          <label
                            className={cn(
                              "grid gap-2 text-subhead-regular text-fg",
                            )}
                          >
                            Old/new overlap (seconds)
                            <input
                              type="number"
                              disabled={command.pending}
                              min={0}
                              max={86400}
                              className={cn(webhookInputClass)}
                              value={overlap}
                              onChange={(event) => {
                                commandKeys.current = {};
                                setOverlap(Number(event.target.value));
                              }}
                            />
                          </label>
                          <Button
                            type="button"
                            loading={command.pending}
                            disabled={!secret}
                            onClick={() => void act("rotate")}
                          >
                            {endpoint.hasSecret
                              ? "Rotate signing secret"
                              : "Submit signing secret"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {message && (
                    <p
                      role="alert"
                      className={cn("mt-4 text-subhead-regular text-fg")}
                    >
                      {message}
                    </p>
                  )}
                </>
              )}
            </SectionCard>
          )}
          {endpoint && !creating && (
            <SectionCard title="Delivery history">
              {queries.deliveries.isPending ? (
                <p
                  role="status"
                  className={cn("text-subhead-regular text-fg-muted")}
                >
                  Loading deliveries…
                </p>
              ) : queries.deliveries.isError ? (
                <QueryError retry={queries.deliveries.refetch} />
              ) : (
                <>
                  <div
                    role="region"
                    aria-label="Webhook deliveries, scroll horizontally"
                    tabIndex={0}
                    className={cn(
                      "overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <table
                      className={cn(
                        "w-full min-w-[48rem] text-left text-caption-1-regular text-fg",
                      )}
                    >
                      <caption className={cn("sr-only")}>
                        Webhook deliveries
                      </caption>
                      <thead>
                        <tr>
                          {[
                            "Event",
                            "Occurred",
                            "State",
                            "Attempts",
                            "Next attempt",
                            "Safe category",
                            "Details",
                          ].map((heading) => (
                            <th
                              key={heading}
                              scope="col"
                              className={cn("border-b border-border px-2 py-3")}
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queries.deliveries.data?.deliveries.rows.map(
                          (delivery) => (
                            <tr key={delivery.id}>
                              <td className={cn("break-all px-2 py-3")}>
                                {delivery.eventType}
                              </td>
                              <td className={cn("px-2 py-3")}>
                                {new Date(delivery.occurredAt).toLocaleString()}
                              </td>
                              <td className={cn("px-2 py-3")}>
                                {delivery.status}
                              </td>
                              <td className={cn("px-2 py-3 tabular-nums")}>
                                {delivery.attemptCount}
                              </td>
                              <td className={cn("px-2 py-3")}>
                                {delivery.nextAttemptAt
                                  ? new Date(
                                      delivery.nextAttemptAt,
                                    ).toLocaleString()
                                  : "None"}
                              </td>
                              <td className={cn("px-2 py-3")}>
                                {delivery.lastFailureCategory ?? "None"}
                              </td>
                              <td className={cn("px-2 py-3")}>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={command.pending}
                                  aria-label={`Inspect delivery ${delivery.deliveryId}`}
                                  onClick={() => {
                                    selectDelivery(delivery.id);
                                    setAttemptPage(1);
                                  }}
                                >
                                  Inspect
                                </Button>
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                  {queries.deliveries.data?.deliveries.rows.length === 0 && (
                    <p
                      className={cn("py-4 text-subhead-regular text-fg-muted")}
                    >
                      No deliveries yet. Send a signed test or enable the
                      endpoint for new subscribed events.
                    </p>
                  )}
                  <Pager
                    label="Delivery pages"
                    page={deliveryPage}
                    pageCount={
                      queries.deliveries.data?.deliveries.pageCount ?? 1
                    }
                    change={setDeliveryPage}
                  />
                </>
              )}
              {deliveryId && (
                <div className={cn("mt-6 border-t border-border pt-4")}>
                  {queries.detail.isPending ? (
                    <p
                      role="status"
                      className={cn("text-subhead-regular text-fg-muted")}
                    >
                      Loading attempts…
                    </p>
                  ) : queries.detail.isError ? (
                    <QueryError retry={queries.detail.refetch} />
                  ) : (
                    queries.detail.data && (
                      <>
                        <WebhookDeliveryPanel
                          key={deliveryId}
                          detail={queries.detail.data.detail}
                          endpoint={endpoint}
                          canEdit={canEdit}
                          pending={command.pending}
                          run={command.run}
                          onReplayed={(id) => {
                            selectDelivery(id);
                            setAttemptPage(1);
                          }}
                        />
                        <Pager
                          label="Attempt pages"
                          page={attemptPage}
                          pageCount={
                            queries.detail.data.detail.attempts.pageCount
                          }
                          change={setAttemptPage}
                        />
                      </>
                    )
                  )}
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
