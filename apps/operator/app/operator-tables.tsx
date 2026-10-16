import type {
  OperatorInstanceSummary,
  OperatorTenantSummary,
} from "@repo/contracts";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type { ReactNode } from "react";

const cell =
  "border-b border-border px-4 py-3 text-left align-top text-subhead-regular";
const label = (value: string | null) =>
  value === null ? "Unknown" : value.replaceAll("_", " ");
const count = (value: number | null) =>
  value === null ? "Unknown" : new Intl.NumberFormat().format(value);
function Time({ value }: { value: string | null }) {
  return value === null ? (
    <>Unknown</>
  ) : (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))}
    </time>
  );
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
          className={cn("bg-surface px-4 py-3 text-left text-subhead-semibold")}
        >
          {title}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  cell,
                  "whitespace-nowrap text-fg-muted bg-surface",
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
  return values.map((value, i) => (
    <td key={i} className={cn(cell)}>
      {value}
    </td>
  ));
}
function LicenceCounts({ item }: { item: OperatorInstanceSummary }) {
  return (
    <dl className={cn("grid gap-y-2")}>
      {Object.entries(item.licenceSummary).map(([key, value]) => (
        <div key={key}>
          <dt className={cn("text-fg-muted")}>
            {label(key.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())}
          </dt>
          <dd>{count(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
export function OperatorInstancesTable({
  instances,
  onSelect,
}: {
  instances: readonly OperatorInstanceSummary[];
  onSelect: (id: string) => void;
}) {
  return (
    <Table
      title="Authorized instances"
      columns={[
        "Instance",
        "Health",
        "Observed version",
        "Expected version",
        "Version drift",
        "Authorized tenant count",
        "Licence summary",
        "Last observed",
        "Details",
      ]}
    >
      {instances.length === 0 ? (
        <tr>
          <td colSpan={9} className={cn(cell)}>
            No instances in the current metadata scope.
          </td>
        </tr>
      ) : (
        instances.map((item) => (
          <tr key={item.instanceId}>
            <th scope="row" className={cn(cell, "text-subhead-semibold")}>
              {item.label}
            </th>
            <Cells
              values={[
                item.status,
                item.version ?? "Unverified",
                item.expectedVersion ?? "Unknown",
                item.versionDrift,
                count(item.tenantCount),
                <LicenceCounts key="licence" item={item} />,
                <Time key="observed" value={item.lastObservedAt} />,
                <Button
                  key="detail"
                  variant="outline"
                  tone="grey"
                  aria-label={`View ${item.label}`}
                  onClick={() => onSelect(item.instanceId)}
                >
                  View details
                </Button>,
              ]}
            />
          </tr>
        ))
      )}
    </Table>
  );
}
export function OperatorDetailTables({
  instance,
  tenants,
}: {
  instance: OperatorInstanceSummary;
  tenants: readonly OperatorTenantSummary[];
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-5")}>
      <section
        aria-label="Instance metadata"
        className={cn("rounded-lg border border-border bg-surface p-5")}
      >
        <h2 className={cn("text-h4")}>{instance.label}</h2>
        <dl className={cn("mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4")}>
          {[
            ["Health", instance.status],
            ["Observed version", instance.version ?? "Unverified"],
            ["Expected version", instance.expectedVersion ?? "Unknown"],
            ["Version drift", instance.versionDrift],
          ].map(([key, value]) => (
            <div key={key}>
              <dt className={cn("text-subhead-regular text-fg-muted")}>
                {key}
              </dt>
              <dd className={cn("text-subhead-semibold")}>{value}</dd>
            </div>
          ))}
          <div>
            <dt className={cn("text-subhead-regular text-fg-muted")}>
              Version source time
            </dt>
            <dd>
              <Time value={instance.versionSourceAt} />
            </dd>
          </div>
          <div>
            <dt className={cn("text-subhead-regular text-fg-muted")}>
              Last observed
            </dt>
            <dd>
              <Time value={instance.lastObservedAt} />
            </dd>
          </div>
        </dl>
      </section>
      <Table
        title="Source observations"
        columns={[
          "Source",
          "Status",
          "Source time",
          "Observed time",
          "Last attempt",
          "Last successful collection",
          "Received time",
          "Reasons",
        ]}
      >
        {instance.sources.length === 0 ? (
          <tr>
            <td colSpan={8} className={cn(cell)}>
              No successful source observations are available.
            </td>
          </tr>
        ) : (
          instance.sources.map((source) => (
            <tr key={source.source}>
              <th scope="row" className={cn(cell, "text-subhead-semibold")}>
                {label(source.source)}
              </th>
              <Cells
                values={[
                  source.status,
                  <Time key="source" value={source.sourceAt} />,
                  <Time key="observed" value={source.observedAt} />,
                  <Time key="attempt" value={source.attemptedAt} />,
                  <Time key="success" value={source.succeededAt} />,
                  <Time key="received" value={source.receivedAt} />,
                  source.reasons.length
                    ? source.reasons.map(label).join("; ")
                    : "None",
                ]}
              />
            </tr>
          ))
        )}
      </Table>
      <Table
        title="Authorized tenants"
        columns={[
          "Organization",
          "Health",
          "Licence",
          "Licence expiry",
          "Grace ends",
          "Licence source time",
          "Last observed",
          "Source observations",
        ]}
      >
        {tenants.length === 0 ? (
          <tr>
            <td colSpan={8} className={cn(cell)}>
              No tenants in the current metadata scope.
            </td>
          </tr>
        ) : (
          tenants.map((tenant) => (
            <tr key={tenant.tenantId}>
              <th scope="row" className={cn(cell, "text-subhead-semibold")}>
                {tenant.label}
              </th>
              <Cells
                values={[
                  tenant.status,
                  label(tenant.licenceState),
                  <Time key="expiry" value={tenant.licenceExpiresAt} />,
                  <Time key="grace" value={tenant.graceEndsAt} />,
                  <Time key="licence" value={tenant.licenceSourceAt} />,
                  <Time key="observed" value={tenant.lastObservedAt} />,
                  tenant.sources.length ? (
                    <ul>
                      {tenant.sources.map((source) => (
                        <li key={source.source}>
                          {label(source.source)}: {source.status}; source{" "}
                          <Time value={source.sourceAt} />; observed{" "}
                          <Time value={source.observedAt} />; last attempt{" "}
                          <Time value={source.attemptedAt} />; last success{" "}
                          <Time value={source.succeededAt} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "Unknown"
                  ),
                ]}
              />
            </tr>
          ))
        )}
      </Table>
      <p className={cn("text-subhead-regular text-fg-muted")}>
        Counts include only authorized tenants. Metadata does not grant customer
        content access, licence changes, or impersonation. Deployment changes
        use the existing authorized deployment workflow.
      </p>
    </div>
  );
}
