"use client";
import type {
  ConnectorCatalogueEntry,
  ConnectorType,
} from "@repo/contracts/connectors/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

export function ConnectorCatalogueSection({
  entries,
  canCreate,
  onConfigure,
}: Readonly<{
  entries: readonly ConnectorCatalogueEntry[];
  canCreate: boolean;
  onConfigure: (type: ConnectorType) => void;
}>) {
  return (
    <SectionCard title="Integration catalogue">
      <p className={cn("mb-4 max-w-prose text-subhead-regular text-fg")}>
        Availability reflects registered adapters. Roadmap phases do not mean a
        vendor connection is functioning.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-caption-1-regular text-fg">
          <caption className="sr-only">
            Integration availability and least-privilege guidance
          </caption>
          <thead>
            <tr className="border-b border-border text-caption-1-semibold">
              <th scope="col" className="px-3 py-3">
                Connector
              </th>
              <th scope="col" className="px-3 py-3">
                Availability
              </th>
              <th scope="col" className="px-3 py-3">
                BRD phase / priority
              </th>
              <th scope="col" className="px-3 py-3">
                Configuration
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-border align-top last:border-b-0"
              >
                <th scope="row" className="min-w-60 px-3 py-4 font-medium">
                  <details>
                    <summary className="cursor-pointer rounded-lg text-subhead-semibold outline-none focus-visible:ring-2 focus-visible:ring-active-500">
                      {entry.name}
                    </summary>
                    <p className="mt-3 max-w-prose font-normal">
                      {entry.description}
                    </p>
                    <p className="mt-2 max-w-prose font-normal">
                      {entry.guidance}
                    </p>
                    <p className="mt-2 font-normal">
                      Scope policy {entry.scopePolicyVersion}.{" "}
                      {entry.scopeIntrospection === "not_applicable"
                        ? "Vendor privilege introspection is not applicable to fixtures."
                        : entry.implementation === "agent"
                          ? "Internal source privileges are configured on the agent host; CRA cannot inspect them."
                          : "Granted privileges are unknown until a supported adapter can inspect them."}
                    </p>
                  </details>
                </th>
                <td className="px-3 py-4">
                  {entry.implementation === "reference"
                    ? "Reference/test adapter"
                    : entry.implementation === "ci"
                      ? "CI run verification"
                      : entry.implementation === "agent"
                        ? "Outbound agent"
                        : "Planned integration"}
                </td>
                <td className="whitespace-nowrap px-3 py-4">
                  {entry.phase} / {entry.priority}
                </td>
                <td className="px-3 py-4">
                  {entry.canConfigure && canCreate ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => onConfigure(entry.id as ConnectorType)}
                    >
                      {entry.implementation === "reference"
                        ? "Configure reference adapter"
                        : `Configure ${entry.name}`}
                    </Button>
                  ) : entry.canConfigure ? (
                    "Requires create permission"
                  ) : (
                    "Not available"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 ? (
        <p role="status" className="text-subhead-regular text-fg">
          No catalogue entries are available.
        </p>
      ) : null}
    </SectionCard>
  );
}
