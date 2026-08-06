"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { browserApi, jsonRequest } from "../../_lib/browser-api";
import { hasPermission } from "../../_lib/permissions";
import type { FindingRow, PrincipalData } from "../../_lib/api";

const TRANSITIONS: Record<string, string[]> = {
  open: ["in_triage"],
  in_triage: ["awaiting_approval"],
  awaiting_approval: ["closed", "in_triage"],
  closed: ["reopened"],
  suppressed: ["in_triage"],
  reopened: ["in_triage"],
};

const VEX_STATUSES = ["under_investigation", "affected", "not_affected", "fixed"];
const JUSTIFICATIONS = [
  "component_not_present",
  "vulnerable_code_not_present",
  "vulnerable_code_not_in_execute_path",
  "vulnerable_code_cannot_be_controlled_by_adversary",
  "inline_mitigations_already_exist",
];

export function FindingDetail({
  finding,
  principal,
}: {
  finding: FindingRow;
  principal: PrincipalData | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vexStatus, setVexStatus] = useState("under_investigation");
  const [justification, setJustification] = useState(JUSTIFICATIONS[0]);
  const canTriage = hasPermission(principal, "finding:triage");
  const canAssess = hasPermission(principal, "finding:assess");
  const findingTransitions = TRANSITIONS[finding.state] ?? [];

  async function transition(to: string) {
    setBusy(true);
    setError(null);
    const result = await browserApi<FindingRow>(
      `/findings/${finding.id}/transitions`,
      jsonRequest({ to }),
    );
    if (result.error) setError(result.error);
    setBusy(false);
    router.refresh();
  }

  async function recordVex() {
    setBusy(true);
    setError(null);
    const result = await browserApi<FindingRow>(
      `/findings/${finding.id}/vex`,
      jsonRequest({
        status: vexStatus,
        justification: vexStatus === "not_affected" ? justification : undefined,
      }),
    );
    if (result.error) setError(result.error);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-fg-muted">{finding.advisoryId}</p>
            <h2 className="mt-1 text-xl font-semibold">Vulnerability finding</h2>
          </div>
          {finding.kevListed ? (
            <Tag tone="red" variant="fill">
              KEV listed
            </Tag>
          ) : null}
        </div>
        <dl className="mt-5 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-fg-muted">State</dt>
            <dd className="mt-1 font-medium">{finding.state.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Match</dt>
            <dd className="mt-1 font-medium">
              {finding.matchMethod} · {Math.round(finding.matchConfidence * 100)}%
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">CVSS</dt>
            <dd className="mt-1 font-medium">{finding.cvssBase ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">VEX status</dt>
            <dd className="mt-1 font-medium">{finding.vexStatus.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">VEX justification</dt>
            <dd className="mt-1 font-medium">
              {finding.vexJustification?.replaceAll("_", " ") ?? "—"}
            </dd>
          </div>
        </dl>
        {canTriage && findingTransitions.length ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {findingTransitions.map((state) => (
              <Button
                key={state}
                variant="outline"
                disabled={busy}
                onClick={() => void transition(state)}
              >
                {state.replaceAll("_", " ")}
              </Button>
            ))}
          </div>
        ) : null}
      </section>
      {canAssess ? (
        <section className="rounded-xl border border-border p-5">
          <h2 className="font-semibold">VEX assessment</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              Status
              <select
                value={vexStatus}
                onChange={(event) => setVexStatus(event.target.value)}
                className="mt-1 block rounded border border-border bg-canvas px-3 py-2"
              >
                {VEX_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            {vexStatus === "not_affected" ? (
              <label className="text-sm">
                Justification
                <select
                  value={justification}
                  onChange={(event) => setJustification(event.target.value)}
                  className="mt-1 block rounded border border-border bg-canvas px-3 py-2"
                >
                  {JUSTIFICATIONS.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button disabled={busy} onClick={() => void recordVex()}>
              {busy ? "Saving…" : "Save assessment"}
            </Button>
          </div>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
