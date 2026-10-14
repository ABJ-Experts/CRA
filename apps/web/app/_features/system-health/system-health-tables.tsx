import type { CustomerSystemHealthResponse } from "@repo/contracts";
import { cn } from "@repo/ui/cn";
import type { ReactNode } from "react";

const cell =
  "border-b border-border px-4 py-3 text-left align-top text-subhead-regular";
export function observationTime(value: string | null) {
  return value === null
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
}
function Time({ value }: { value: string | null }) {
  return value === null ? (
    <>Unknown</>
  ) : (
    <time dateTime={value}>{observationTime(value)}</time>
  );
}
function label(value: string) {
  return value.replaceAll("_", " ");
}
function Table({
  title,
  columns,
  children,
}: {
  title: string;
  columns: readonly string[];
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={`${title} table scroll area`}
      tabIndex={0}
      className={cn(
        "overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-accent",
      )}
    >
      <table className={cn("w-full border-collapse")}>
        <caption
          className={cn("px-4 py-3 text-left text-subhead-semibold bg-surface")}
        >
          {title}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                scope="col"
                key={column}
                className={cn(
                  cell,
                  "whitespace-nowrap bg-surface text-fg-muted",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function Cells({ values }: { values: readonly ReactNode[] }) {
  return values.map((value, index) => (
    <td key={index} className={cn(cell)}>
      {value}
    </td>
  ));
}
function Reasons({ values }: { values: readonly string[] }) {
  return <>{values.length ? values.map(label).join("; ") : "None"}</>;
}
function Metric({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div>
      <dt className={cn("text-subhead-regular text-fg-muted")}>{name}</dt>
      <dd className={cn("mt-1 text-subhead-semibold break-words")}>{value}</dd>
    </div>
  );
}
export function SystemHealthTables({
  data,
}: {
  data: CustomerSystemHealthResponse;
}) {
  const count = (
    value: number | null,
    relation: "exact" | "at_least" | null,
  ) =>
    value === null
      ? "Unknown / withheld"
      : `${relation === "at_least" ? "At least " : ""}${new Intl.NumberFormat().format(value)}`;
  const bytes = (value: number | null) =>
    value === null
      ? "Unknown"
      : `${new Intl.NumberFormat().format(value)} bytes`;
  return (
    <div className={cn("flex flex-col gap-6")}>
      <p className={cn("text-subhead-regular text-fg-muted")}>
        Times are shown in your local time zone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}).
      </p>
      <section
        aria-label="Snapshot summary"
        className={cn("rounded-lg border border-border bg-surface p-5")}
      >
        <dl
          className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4")}
        >
          <Metric name="Overall health" value={label(data.overallStatus)} />
          <Metric
            name="Snapshot observed"
            value={<Time value={data.observedAt} />}
          />
          <Metric
            name="Current version"
            value={data.currentVersion.version ?? "Unverified version"}
          />
          <Metric
            name="Licence state"
            value={data.licence.state ? label(data.licence.state) : "Unknown"}
          />
          <Metric
            name="Version source time"
            value={<Time value={data.currentVersion.sourceAt} />}
          />
          <Metric
            name="Version observed"
            value={<Time value={data.currentVersion.observedAt} />}
          />
          <Metric
            name="Build identity"
            value={data.currentVersion.commit ?? "Unverified"}
          />
          <Metric
            name="Build time"
            value={<Time value={data.currentVersion.builtAt} />}
          />
          <Metric
            name="Licence expiry"
            value={<Time value={data.licence.expiresAt} />}
          />
          <Metric
            name="Grace ends"
            value={<Time value={data.licence.graceEndsAt} />}
          />
          <Metric
            name="Licence source time"
            value={<Time value={data.licence.sourceAt} />}
          />
          <Metric
            name="Licence observed"
            value={<Time value={data.licence.observedAt} />}
          />
        </dl>
        <p className={cn("mt-5 text-subhead-regular text-fg-muted")}>
          This read-only diagnostic does not change licence enforcement.
          Existing evidence exports remain available when normally authorized,
          including during licence expiry.
        </p>
        <nav
          aria-label="Related organization settings"
          className={cn("mt-3 flex flex-wrap gap-4 text-subhead-semibold")}
        >
          {data.licence.managementUrl ? (
            <a
              className={cn(
                "text-accent underline underline-offset-4 focus-visible:outline-2",
              )}
              href={data.licence.managementUrl}
            >
              Licence
            </a>
          ) : null}
          {data.licence.usageUrl ? (
            <a
              className={cn(
                "text-accent underline underline-offset-4 focus-visible:outline-2",
              )}
              href={data.licence.usageUrl}
            >
              Usage
            </a>
          ) : null}
        </nav>
      </section>
      <Table
        title="Components"
        columns={[
          "Component",
          "Status",
          "Observation",
          "Source time",
          "Observed time",
          "Reasons",
        ]}
      >
        {data.components.map((item) => (
          <tr key={item.id}>
            <th scope="row" className={cn(cell, "text-subhead-semibold")}>
              {item.label}
            </th>
            <Cells
              values={[
                label(item.status),
                item.summary,
                <Time key="source" value={item.sourceAt} />,
                <Time key="observed" value={item.observedAt} />,
                <Reasons key="reasons" values={item.reasons} />,
              ]}
            />
          </tr>
        ))}
      </Table>
      <section aria-label="Background work observations">
        <p className={cn("mb-3 text-subhead-regular text-fg-muted")}>
          Queue counts describe observed work. An empty queue does not prove
          that a worker is alive. Human review and uncertain delivery are
          separate from runnable backlog.
        </p>
        <Table
          title="Background work"
          columns={[
            "Queue",
            "Status / availability",
            "Waiting",
            "Running",
            "Retries",
            "Human review",
            "Uncertain delivery",
            "Terminal failures",
            "Oldest waiting",
            "Source time",
            "Observed time",
            "Reasons",
          ]}
        >
          {data.queues.map((item) => (
            <tr key={item.id}>
              <th scope="row" className={cn(cell, "text-subhead-semibold")}>
                {item.label}
              </th>
              <Cells
                values={[
                  `${label(item.status)} / ${item.availability}`,
                  ...[
                    item.pending,
                    item.running,
                    item.retrying,
                    item.waitingForReview,
                    item.uncertainDelivery,
                    item.failedTerminal,
                  ].map((value) => count(value, item.countRelation)),
                  <Time key="oldest" value={item.oldestPendingAt} />,
                  <Time key="source" value={item.sourceAt} />,
                  <Time key="observed" value={item.observedAt} />,
                  <Reasons key="reasons" values={item.reasons} />,
                ]}
              />
            </tr>
          ))}
        </Table>
      </section>
      <section
        aria-labelledby="storage-health-heading"
        className={cn("rounded-lg border border-border p-5")}
      >
        <h2 id="storage-health-heading" className={cn("text-subhead-semibold")}>
          Storage accounting
        </h2>
        <dl className={cn("mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3")}>
          <Metric
            name="Customer bytes"
            value={bytes(data.storage.customerBytes)}
          />
          <Metric
            name="Customer reserved bytes"
            value={bytes(data.storage.customerReservedBytes)}
          />
          <Metric
            name="Protected, exempt bytes"
            value={bytes(data.storage.protectedBytes)}
          />
          <Metric
            name="Storage reachability"
            value={data.storage.reachability}
          />
          <Metric name="Byte integrity" value="Unknown" />
          <Metric name="Accounting status" value={data.storage.status} />
          <Metric
            name="Storage source time"
            value={<Time value={data.storage.sourceAt} />}
          />
          <Metric
            name="Storage observed"
            value={<Time value={data.storage.observedAt} />}
          />
          <Metric
            name="Storage reasons"
            value={<Reasons values={data.storage.reasons} />}
          />
        </dl>
        <p className={cn("mt-4 text-subhead-regular text-fg-muted")}>
          Accounting is metadata. It does not verify stored bytes or available
          disk space.
        </p>
      </section>
      <Table
        title="Feed freshness"
        columns={[
          "Feed",
          "Status",
          "Last successful collection",
          "Last source snapshot",
          "Stale after",
          "Source time",
          "Observed time",
          "Reasons",
        ]}
      >
        {data.feedFreshness.map((item) => (
          <tr key={item.id}>
            <th scope="row" className={cn(cell, "text-subhead-semibold")}>
              {item.label}
            </th>
            <Cells
              values={[
                item.status,
                <Time key="success" value={item.lastSuccessAt} />,
                <Time key="snapshot" value={item.lastSourceSnapshotAt} />,
                `${new Intl.NumberFormat().format(item.staleAfterSeconds)} seconds`,
                <Time key="source" value={item.sourceAt} />,
                <Time key="observed" value={item.observedAt} />,
                <Reasons key="reasons" values={item.reasons} />,
              ]}
            />
          </tr>
        ))}
      </Table>
      <section
        aria-labelledby="backup-health-heading"
        className={cn("rounded-lg border border-border p-5")}
      >
        <h2 id="backup-health-heading" className={cn("text-subhead-semibold")}>
          Backup and restore assurance
        </h2>
        <dl className={cn("mt-4 grid gap-5 sm:grid-cols-2")}>
          <Metric
            name="Last backup execution"
            value={<Time value={data.backup.lastExecutionAt} />}
          />
          <Metric
            name="Last verified restore"
            value={<Time value={data.backup.lastVerifiedRestoreAt} />}
          />
          <Metric
            name="Backup source time"
            value={<Time value={data.backup.sourceAt} />}
          />
          <Metric
            name="Backup observed"
            value={<Time value={data.backup.observedAt} />}
          />
        </dl>
        <p className={cn("mt-4 text-subhead-regular text-fg-muted")}>
          Backup execution and verified restore evidence are unknown until the
          backup assurance service is available. Health observations do not
          demonstrate recoverability.
        </p>
      </section>
    </div>
  );
}
