"use client";
import { useEffect, useRef, useState } from "react";
import type {
  OperatorInstancesResponse,
  OperatorInstanceSummary,
  OperatorSessionResponse,
  OperatorTenantsResponse,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  operatorGateway,
  OperatorRequestError,
  type OperatorGateway,
} from "./operator-gateway";
import {
  OperatorDetailTables,
  OperatorInstancesTable,
} from "./operator-tables";

type Snapshot = Readonly<{
  key: string;
  session?: OperatorSessionResponse;
  list?: OperatorInstancesResponse;
  instance?: OperatorInstanceSummary;
  tenants?: OperatorTenantsResponse;
  error?: unknown;
}>;
type Target = Readonly<{ instanceId: string | null; cursor?: string }>;
function failure(error: unknown) {
  if (
    error instanceof OperatorRequestError &&
    [401, 403].includes(error.status)
  )
    return "Your certificate does not grant this metadata access. Contact your operator administrator.";
  if (error instanceof OperatorRequestError && error.status === 409)
    return "The scope or observation changed. Reload the registry to continue.";
  return "The private metadata service is unavailable. Try again.";
}
export function OperatorConsole({
  gateway = operatorGateway,
}: {
  gateway?: Pick<
    OperatorGateway,
    "session" | "instances" | "instance" | "tenants"
  >;
}) {
  const [target, setTarget] = useState<Target>({ instanceId: null });
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = JSON.stringify([target.instanceId, target.cursor, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    async function read() {
      const session = await gateway.session(controller.signal);
      if (
        target.instanceId &&
        !session.allowedInstanceIds.includes(target.instanceId)
      )
        throw new OperatorRequestError(403);
      const result: Snapshot = target.instanceId
        ? await Promise.all([
            gateway.instance(target.instanceId, controller.signal),
            gateway.tenants(
              target.instanceId,
              { cursor: target.cursor },
              controller.signal,
            ),
          ]).then(([detail, tenants]) => ({
            key,
            session,
            instance: detail.instance,
            tenants,
          }))
        : {
            key,
            session,
            list: await gateway.instances(
              { cursor: target.cursor },
              controller.signal,
            ),
          };
      if (
        result.list?.instances.some(
          (item) => !session.allowedInstanceIds.includes(item.instanceId),
        )
      )
        throw new OperatorRequestError(403);
      const latestSession = await gateway.session(controller.signal);
      if (
        latestSession.principalId !== session.principalId ||
        latestSession.grantRevision !== session.grantRevision
      )
        throw new OperatorRequestError(409);
      if (!controller.signal.aborted) setSnapshot(result);
    }
    void read().catch((error: unknown) => {
      if (!controller.signal.aborted) setSnapshot({ key, error });
    });
    const timer = window.setInterval(
      () => setAttempt((value) => value + 1),
      30_000,
    );
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [key, target.instanceId, target.cursor, gateway]);
  const current = snapshot?.key === key ? snapshot : null;
  function navigate(next: Target) {
    setTarget(next);
    heading.current?.focus();
  }
  const nextCursor = current?.list?.nextCursor ?? current?.tenants?.nextCursor;
  return (
    <main
      className={cn(
        "mx-auto flex min-w-0 max-w-[1440px] flex-col gap-6 px-5 py-8 sm:px-8",
      )}
    >
      <header
        className={cn("flex flex-wrap items-start justify-between gap-4")}
      >
        <div>
          <p className={cn("text-subhead-semibold text-fg-muted")}>
            Private operator registry · read only
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className={cn("mt-2 text-h3 focus-visible:outline-2")}
          >
            Deployment health
          </h1>
          <p
            className={cn(
              "mt-2 max-w-[70ch] text-subhead-regular text-fg-muted",
            )}
          >
            Authorized instance and organization metadata. Source timestamps
            remain unchanged when collection fails. Backup execution and
            verified restore assurance remain unknown.
          </p>
        </div>
        <div className={cn("flex flex-wrap gap-3")}>
          {target.instanceId ? (
            <Button
              variant="outline"
              tone="grey"
              onClick={() => navigate({ instanceId: null })}
            >
              Back to instances
            </Button>
          ) : null}
          <Button
            variant="outline"
            tone="grey"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh metadata
          </Button>
        </div>
      </header>
      {current?.error ? (
        <div
          role="alert"
          className={cn("rounded-lg border border-border bg-surface p-5")}
        >
          <p className={cn("mb-3 text-subhead-regular")}>
            {failure(current.error)}
          </p>
          <Button
            variant="outline"
            tone="grey"
            onClick={() => {
              setTarget({ instanceId: null });
              setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </div>
      ) : current?.session ? (
        <>
          <p className={cn("text-subhead-regular text-fg-muted")}>
            Metadata scope revision: {current.session.grantRevision}. Last-known
            observations are diagnostic; they do not authorize actions.
          </p>
          {current.list ? (
            <OperatorInstancesTable
              instances={current.list.instances}
              onSelect={(instanceId) => navigate({ instanceId })}
            />
          ) : current.instance && current.tenants ? (
            <OperatorDetailTables
              instance={current.instance}
              tenants={current.tenants.tenants}
            />
          ) : null}
          {nextCursor ? (
            <Button
              variant="outline"
              tone="grey"
              className={cn("self-start")}
              onClick={() =>
                navigate({ instanceId: target.instanceId, cursor: nextCursor })
              }
            >
              Next page
            </Button>
          ) : null}
          {target.cursor ? (
            <Button
              variant="outline"
              tone="grey"
              className={cn("self-start")}
              onClick={() => navigate({ instanceId: target.instanceId })}
            >
              First page
            </Button>
          ) : null}
        </>
      ) : (
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Loading authorized metadata…
        </p>
      )}
    </main>
  );
}
