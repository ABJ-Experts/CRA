"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type {
  SiemConfig,
  SiemCredential,
  SiemDestination,
} from "@repo/contracts/audit/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useSession } from "../../../_providers/session-provider";
import { useMocksReady } from "../../../_providers/providers";
import {
  PageHeading,
  SectionCard,
} from "../../../dashboard/_components/dashboard-chrome";
import { auditSiemGateway } from "./siem.api";
import { useSiemCommand, useSiemQueries } from "./siem.queries";
import { SiemConfigForm, siemControlClass } from "./siem-config-form";
import { SiemCredentials } from "./siem-credentials";
import { SiemHistory } from "./siem-history";
export function SiemContent() {
  const { session } = useSession();
  return <SiemWorkspace key={session?.organization?.id ?? "none"} />;
}
function SiemWorkspace() {
  const { session, permissions, role, isLoading, isError } = useSession(),
    mocksReady = useMocksReady();
  const orgId = session?.organization?.id ?? "none",
    canView =
      permissions.can_view_audit === true &&
      permissions.can_view_connectors === true,
    canEdit =
      canView &&
      permissions.can_export_audit === true &&
      permissions.can_edit_connectors === true,
    canCreate =
      canView &&
      permissions.can_export_audit === true &&
      permissions.can_create_connectors === true;
  const live = mocksReady && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const [selectedId, setSelectedId] = useState(""),
    [creating, setCreating] = useState(false),
    [cursor, setCursor] = useState<string | undefined>(),
    [pages, setPages] = useState<(string | undefined)[]>([]),
    [message, setMessage] = useState("");
  const [formRevision, setFormRevision] = useState(0);
  const identities = useRef<Record<string, string>>({});
  const creationId = useRef(crypto.randomUUID());
  const queries = useSiemQueries(
      orgId,
      selectedId,
      cursor,
      live && canView && orgId !== "none",
    ),
    command = useSiemCommand();
  const selected = queries.list.data?.items.find(
    (item) => item.id === selectedId,
  );
  function requestId(key: string) {
    return (
      identities.current[key] ??
      (identities.current = {
        ...identities.current,
        [key]: crypto.randomUUID(),
      })[key]!
    );
  }
  async function execute<T>(
    key: string,
    action: (requestId: string) => Promise<T>,
  ) {
    const result = await command.run(async () => {
      const result = await action(requestId(key));
      await queries.list.refetch();
      return result;
    });
    if (result !== undefined) {
      identities.current = Object.fromEntries(
        Object.entries(identities.current).filter(([entry]) => entry !== key),
      );
      setMessage(
        "SIEM action completed. Current authorization remains required before delivery.",
      );
    }
    return result;
  }
  function save(config: SiemConfig, reason: string, draftVersion?: number) {
    const version = draftVersion ?? selected?.version;
    const key = JSON.stringify({ config, reason, version });
    void execute(key, (id) =>
      selected && !creating
        ? auditSiemGateway.update(selected.id, {
            ...config,
            requestId: id,
            expectedVersion: version!,
            reason,
            backlogPolicy: "cancel_pending_start_future",
          })
        : auditSiemGateway.create({
            ...config,
            requestId: id,
            destinationId: creationId.current,
          }),
    ).then((result) => {
      if (result) {
        setSelectedId(result.id);
        setCreating(false);
        setFormRevision((revision) => revision + 1);
        creationId.current = crypto.randomUUID();
      }
    });
  }
  function operate(
    destination: SiemDestination,
    operation: "enable" | "disable" | "credentials/revoke",
  ) {
    void execute(
      `${destination.id}:${destination.version}:${operation}`,
      (requestId) =>
        auditSiemGateway.operation(destination.id, operation, {
          requestId,
          expectedVersion: destination.version,
        }),
    );
  }
  async function credentials(credential: SiemCredential) {
    if (!selected) return;
    return command.run(async () => {
      const result = await auditSiemGateway.credential(selected.id, {
        requestId: crypto.randomUUID(),
        expectedVersion: selected.version,
        credential,
      });
      await queries.list.refetch();
      return result;
    });
  }
  const heading = (
    <>
      <PageHeading
        title="SIEM forwarding"
        subtitle="Forward selected structural audit facts to approved collectors."
      />
      <Link
        className={cn(
          "text-subhead-regular text-active-500 underline underline-offset-4",
        )}
        href="/audit"
      >
        Back to audit explorer
      </Link>
    </>
  );
  if (isLoading)
    return (
      <div className={cn("space-y-6")}>
        {heading}
        <p role="status">Loading SIEM permissions…</p>
      </div>
    );
  if (isError)
    return (
      <div>
        {heading}
        <p role="alert">
          Permissions are unavailable. Reload your session to retry.
        </p>
      </div>
    );
  if (!canView)
    return (
      <div>
        {heading}
        <p role="alert">Audit and connector read permissions are required.</p>
      </div>
    );
  if (!live)
    return (
      <div>
        {heading}
        <p role="status">
          SIEM forwarding requires the development backend. Mock mode cannot
          forward audit evidence.
        </p>
      </div>
    );
  return (
    <div className={cn("space-y-6")}>
      {heading}
      <p className={cn("max-w-prose text-caption-1-regular text-fg-muted")}>
        Future tenant events only. Security/platform events and forwarding
        receipts are excluded. Forwarding does not change audit records or
        regulatory decisions.
      </p>
      <p className={cn("text-caption-1-regular text-fg-muted")}>
        Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
      </p>
      {command.error ? (
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          {command.error} Your public draft is preserved. For conflicts, refresh
          status before retrying.
        </p>
      ) : null}
      <p role="status" aria-live="polite">
        {command.pending ? "SIEM action in progress…" : message}
      </p>
      <SectionCard title="Destinations">
        {queries.list.isLoading ? (
          <p role="status">Loading destinations…</p>
        ) : queries.list.isError ? (
          <>
            <p role="alert">Destination status is unavailable.</p>
            <Button
              variant="outline"
              onClick={() => void queries.list.refetch()}
            >
              Retry destinations
            </Button>
          </>
        ) : (
          <>
            <label className={cn("block space-y-2 text-caption-1-semibold")}>
              Current destination
              <select
                aria-label="Current destination"
                className={cn(siemControlClass)}
                value={selectedId}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setCreating(false);
                  setCursor(undefined);
                  setPages([]);
                  setMessage("");
                }}
              >
                <option value="">Select a destination</option>
                {queries.list.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} — {item.state}
                  </option>
                ))}
              </select>
            </label>
            {queries.list.data?.items.length === 0 ? (
              <p role="status">No SIEM destinations configured.</p>
            ) : null}
          </>
        )}
        {canCreate ? (
          <Button
            className={cn("mt-4")}
            variant="outline"
            onClick={() => {
              setCreating(true);
              setSelectedId("");
              creationId.current = crypto.randomUUID();
            }}
          >
            New destination
          </Button>
        ) : null}
      </SectionCard>
      {creating && canCreate ? (
        <SectionCard title="New destination">
          <SiemConfigForm
            pending={command.pending}
            catalogue={queries.catalogue.data}
            onSave={save}
          />
        </SectionCard>
      ) : null}
      {selected && !creating ? (
        <>
          <SectionCard title="Forwarding status">
            <p>
              {selected.state} / credentials {selected.credentialState}
            </p>
            <p className={cn("break-all text-caption-1-regular")}>
              Authority user: {selected.authorityUserId ?? "Not assigned"}
            </p>
            <p>
              Pending {selected.health.pendingCount}; failed{" "}
              {selected.health.failedCount}
            </p>
            <p>
              Oldest pending:{" "}
              {selected.health.oldestPendingAt
                ? new Date(selected.health.oldestPendingAt).toLocaleString()
                : "None"}
            </p>
            <p>
              Last HTTPS accepted:{" "}
              {selected.health.lastAcceptedAt
                ? new Date(selected.health.lastAcceptedAt).toLocaleString()
                : "None"}
            </p>
            {selected.health.safeFailureCode ? (
              <p role="status">
                {selected.health.safeFailureCode.replaceAll("_", " ")}
              </p>
            ) : null}
            {selected.state === "paused" ? (
              <p role="alert">
                Delivery is paused. Check authority, source permissions and
                deployment health before explicit enablement/takeover.
              </p>
            ) : null}
            {canEdit ? (
              <div className={cn("mt-4 flex flex-wrap gap-3")}>
                <Button
                  disabled={command.pending}
                  variant="outline"
                  onClick={() =>
                    void execute(
                      `${selected.id}:${selected.version}:test`,
                      (requestId) =>
                        auditSiemGateway.test(selected.id, {
                          requestId,
                          expectedVersion: selected.version,
                        }),
                    ).then((result) => {
                      if (result)
                        setMessage(
                          result.state === "sent_unacknowledged"
                            ? "Test sent unacknowledged; collector receipt is not confirmed."
                            : result.state === "accepted"
                              ? "Collector accepted the test; future delivery still requires enablement."
                              : `Test failed: ${result.safeFailureCode ?? "unavailable"}`,
                        );
                    })
                  }
                >
                  Test collector
                </Button>
                <Button
                  disabled={
                    command.pending ||
                    selected.credentialState !== "active" ||
                    selected.state === "enabled"
                  }
                  onClick={() => operate(selected, "enable")}
                >
                  Enable future events / take over
                </Button>
                <Button
                  variant="outline"
                  disabled={command.pending || selected.state === "disabled"}
                  onClick={() => operate(selected, "disable")}
                >
                  Disable and cancel pending
                </Button>
                {role === "owner" ? (
                  <Button
                    variant="outline"
                    disabled={
                      command.pending || selected.credentialState !== "active"
                    }
                    onClick={() => operate(selected, "credentials/revoke")}
                  >
                    Revoke credentials
                  </Button>
                ) : null}
              </div>
            ) : null}
          </SectionCard>
          {canEdit ? (
            <SectionCard title="Configuration">
              <SiemConfigForm
                key={`${selected.id}:${formRevision}`}
                initial={selected}
                baseVersion={selected.version}
                catalogue={queries.catalogue.data}
                pending={command.pending}
                onSave={save}
              />
            </SectionCard>
          ) : null}
          {canEdit && role === "owner" ? (
            <SectionCard title="Credentials">
              <SiemCredentials
                key={`${selected.id}:${selected.transport}`}
                syslog={selected.transport === "syslog_tls"}
                pending={command.pending}
                onSave={credentials}
              />
            </SectionCard>
          ) : null}
          <SectionCard title="Delivery evidence">
            {queries.deliveries.isError ? (
              <>
                <p role="alert">
                  Delivery history is unavailable or access changed.
                </p>
                <Button
                  variant="outline"
                  onClick={() => void queries.deliveries.refetch()}
                >
                  Retry history
                </Button>
              </>
            ) : queries.deliveries.isLoading ? (
              <p role="status">Loading delivery history…</p>
            ) : (
              <SiemHistory
                key={selected.id}
                items={queries.deliveries.data?.items ?? []}
                destinationId={selected.id}
                version={selected.version}
                canEdit={canEdit}
                pending={command.pending}
                run={command.run}
              />
            )}
            <nav aria-label="Delivery pages" className={cn("mt-4 flex gap-3")}>
              <Button
                variant="outline"
                disabled={pages.length === 0}
                onClick={() => {
                  setCursor(pages.at(-1));
                  setPages(pages.slice(0, -1));
                }}
              >
                Previous deliveries
              </Button>
              <Button
                variant="outline"
                disabled={!queries.deliveries.data?.nextCursor}
                onClick={() => {
                  setPages([...pages, cursor]);
                  setCursor(queries.deliveries.data?.nextCursor ?? undefined);
                }}
              >
                Next deliveries
              </Button>
            </nav>
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
