"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useAgentStatusQuery,
  useIssueAgentEnrollment,
  useRevokeAgent,
} from "../../_features/connectors/agents.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function statusError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to view this agent.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This connector or agent is unavailable.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the agent service. The last known state may be stale.";
  return "Agent status could not be loaded.";
}

function actionError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to manage this agent.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The agent changed in another session. Refresh status before trying again.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The service could not be reached. Refresh status before retrying this action.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  return "The agent action failed. Refresh status before trying again.";
}

function connectionLabel(status: string, lastContactAt: string | null): string {
  if (status === "revoked") return "Revoked";
  if (status === "pending" || lastContactAt === null)
    return "Awaiting first contact";
  return Date.now() - Date.parse(lastContactAt) > 5 * 60_000
    ? "Offline — no contact in five minutes"
    : "Connected recently";
}

/** Agent status and the one-time owner enrollment action. No credential is cached. */
export function ConnectorAgentSection({
  connectorId,
  isOwner,
}: {
  connectorId: string;
  isOwner: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<(string | null)[]>([]);
  const status = useAgentStatusQuery(connectorId, cursor);
  const issue = useIssueAgentEnrollment(connectorId);
  const revoke = useRevokeAgent(connectorId);
  const [token, setToken] = useState<{
    value: string;
    expiresAt: string;
  } | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    tone: "error" | "info";
  } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const tokenRef = useRef<HTMLParagraphElement>(null);
  const issueRef = useRef<HTMLButtonElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const accessLost =
    status.isError &&
    status.error instanceof ApiClientError &&
    (status.error.status === 403 || status.error.status === 404);

  useEffect(() => {
    if (accessLost) {
      setToken(null);
      setConfirmRevoke(false);
    }
  }, [accessLost]);

  useEffect(() => {
    if (token) tokenRef.current?.focus();
  }, [token]);

  useEffect(() => {
    if (confirmRevoke) confirmRef.current?.focus();
  }, [confirmRevoke]);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  useEffect(() => {
    if (!token) return;
    const delay = Math.max(0, Date.parse(token.expiresAt) - Date.now());
    const timeout = window.setTimeout(() => setToken(null), delay);
    return () => window.clearTimeout(timeout);
  }, [token]);

  async function issueToken() {
    setMessage(null);
    try {
      const result = await issue.mutateAsync({
        idempotencyKey: crypto.randomUUID(),
      });
      setToken({ value: result.token, expiresAt: result.expiresAt });
    } catch (error) {
      setMessage({ text: actionError(error), tone: "error" });
    }
  }

  async function revokeAgent(agentId: string) {
    setMessage(null);
    try {
      await revoke.mutateAsync({
        agentId,
        input: { idempotencyKey: crypto.randomUUID() },
      });
      setConfirmRevoke(false);
      setToken(null);
      setMessage({
        text: "Agent revoked. Its certificate and signing key can no longer submit frames.",
        tone: "info",
      });
    } catch (error) {
      setMessage({ text: actionError(error), tone: "error" });
    }
  }

  const agent = accessLost ? null : (status.data?.agent ?? null);
  return (
    <SectionCard title="On-premises agent">
      <div className={cn("space-y-5 text-subhead-regular text-fg")}>
        <p className="text-fg-muted">
          This agent reads approved internal sources and initiates outbound
          connections to CRA. Internal source credentials remain on its host.
        </p>
        {status.isPending ? <p role="status">Loading agent status…</p> : null}
        {status.isError ? (
          <div role="alert" className="space-y-2">
            <p className="text-danger">{statusError(status.error)}</p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void status.refetch()}
            >
              Retry status
            </Button>
          </div>
        ) : null}
        {!status.isPending && !status.isError && !agent ? (
          <p>No agent is enrolled for this connector.</p>
        ) : null}
        {agent ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["State", connectionLabel(agent.status, agent.lastContactAt)],
                ["Last contact", formatDate(agent.lastContactAt)],
                ["Version", agent.version ?? "Not reported"],
                [
                  "Capabilities",
                  agent.capabilities.length
                    ? agent.capabilities.join(", ")
                    : "Not reported",
                ],
                [
                  "Backlog",
                  `${agent.backlogCount.toLocaleString()} items · ${agent.backlogBytes.toLocaleString()} bytes`,
                ],
                ["Safe error", agent.lastErrorCode ?? "None"],
              ].map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <dt className="text-caption-1-regular text-fg-muted">
                    {label}
                  </dt>
                  <dd className="break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {isOwner && agent.status !== "revoked" ? (
              <div className="flex flex-wrap items-center gap-3">
                {!confirmRevoke ? (
                  <Button
                    ref={revokeRef}
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => setConfirmRevoke(true)}
                  >
                    Revoke agent
                  </Button>
                ) : (
                  <>
                    <p>Revoke this agent immediately?</p>
                    <Button
                      ref={confirmRef}
                      type="button"
                      variant="outline"
                      tone="grey"
                      loading={revoke.isPending}
                      loadingLabel="Revoking agent"
                      onClick={() => void revokeAgent(agent.id)}
                    >
                      Confirm revoke
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => {
                        setConfirmRevoke(false);
                        window.setTimeout(() => revokeRef.current?.focus(), 0);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            {agent.status === "revoked" ? (
              <div className="space-y-2 rounded-xl border border-border bg-canvas p-4">
                <p className="font-medium">
                  This agent cannot be enrolled again on this connector.
                </p>
                <p className="text-fg-muted">
                  Recovery requires a new on-premises connector. Before
                  enrolling a replacement, review the source checkpoint and
                  retained queue against staged and committed pages with an
                  owner. Preserve the old agent evidence until reconciliation is
                  complete.
                </p>
                <Link
                  href="/connectors"
                  className="inline-block underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500"
                >
                  Open connector registry
                </Link>
              </div>
            ) : null}
          </>
        ) : null}
        {isOwner && !status.isPending && !status.isError && agent === null ? (
          <div className="space-y-3">
            <Button
              ref={issueRef}
              type="button"
              loading={issue.isPending}
              loadingLabel="Issuing enrollment"
              onClick={() => void issueToken()}
            >
              Issue enrollment token
            </Button>
            <p className="text-caption-1-regular text-fg-muted">
              Enrollment expires after 15 minutes. Save the token on the agent
              host; it appears here only once.
            </p>
          </div>
        ) : null}
        {token ? (
          <div className="space-y-2 rounded-xl border border-border bg-canvas p-4">
            <p ref={tokenRef} tabIndex={-1} className="font-medium">
              One-time enrollment token
            </p>
            <code className="block break-all select-all text-caption-1-regular">
              {token.value}
            </code>
            <p className="text-caption-1-regular text-fg-muted">
              Expires {formatDate(token.expiresAt)}.
            </p>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => {
                setToken(null);
                issueRef.current?.focus();
              }}
            >
              Hide enrollment token
            </Button>
          </div>
        ) : null}
        {message ? (
          <p
            ref={messageRef}
            tabIndex={-1}
            role={message.tone === "error" ? "alert" : "status"}
            className={message.tone === "error" ? "text-danger" : "text-fg"}
          >
            {message.text}
          </p>
        ) : null}
        {!accessLost && status.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-headline-semibold">Staged pages</h3>
              <a
                href="#connector-sync-runs"
                className="underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-active-500"
              >
                Review sync runs
              </a>
            </div>
            {status.data.batches.rows.length === 0 ? (
              <p className="text-fg-muted">No pages have been staged.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-caption-1-regular">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="p-2">
                        Sequence
                      </th>
                      <th scope="col" className="p-2">
                        State
                      </th>
                      <th scope="col" className="p-2">
                        Records
                      </th>
                      <th scope="col" className="p-2">
                        Received
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.data.batches.rows.map((batch) => (
                      <tr key={batch.id} className="border-b border-border">
                        <td className="p-2 tabular-nums">{batch.sequence}</td>
                        <td className="p-2">{batch.status}</td>
                        <td className="p-2 tabular-nums">
                          {batch.recordCount}
                        </td>
                        <td className="p-2">{formatDate(batch.receivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {previousCursors.length ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => {
                    setCursor(previousCursors.at(-1) ?? null);
                    setPreviousCursors((items) => items.slice(0, -1));
                  }}
                >
                  Newer pages
                </Button>
              ) : null}
              {status.data.batches.nextCursor ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => {
                    setPreviousCursors((items) => [...items, cursor]);
                    setCursor(status.data!.batches.nextCursor);
                  }}
                >
                  Older pages
                </Button>
              ) : null}
              <p className="text-caption-1-regular text-fg-muted">
                Up to 20 pages per view.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
