import type { AuditRangeResult } from "@repo/contracts/audit/types";
import { cn } from "@repo/ui/cn";
const outcomeLabels = {
  consistent: "Range internally consistent",
  integrity_break: "Integrity break detected",
  empty: "Empty range",
  legacy_unchained: "Legacy — unchained",
  checkpoint_unavailable: "Checkpoint unavailable",
  scope_unavailable: "Source access unavailable",
  incomplete: "Inspection incomplete",
} as const;
function boundary(value: { from: string; to: string } | null) {
  return value === null ? "Not checked" : `${value.from}–${value.to}`;
}
export function AuditRangeResultView({
  result,
}: Readonly<{ result: AuditRangeResult }>) {
  if (result.outcome === "scope_unavailable")
    return (
      <p role="status">
        Source access unavailable. No evidence or progress can be disclosed.
        Start a new check after resolving access.
      </p>
    );
  return (
    <div className="grid gap-3">
      <p
        role="status"
        className={cn(
          "text-subhead-semibold",
          result.outcome === "integrity_break" ? "text-danger" : "text-fg",
        )}
      >
        {outcomeLabels[result.outcome]}
      </p>
      <dl className="grid gap-2 text-caption-1-regular sm:grid-cols-2">
        <div>
          <dt>Frozen range</dt>
          <dd>{boundary(result.frozenRange)}</dd>
        </div>
        <div>
          <dt>Checked range</dt>
          <dd>{boundary(result.checkedRange)}</dd>
        </div>
        <div>
          <dt>Verified prefix</dt>
          <dd>{boundary(result.verifiedPrefix)}</dd>
        </div>
        <div>
          <dt>Events checked</dt>
          <dd>{result.checkedCount ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Dataset context</dt>
          <dd>{result.datasetContext}</dd>
        </div>
        <div>
          <dt>Prior checkpoint</dt>
          <dd>{result.priorCheckpointStatus}</dd>
        </div>
        <div>
          <dt>Algorithm</dt>
          <dd>SHA-256 / chain version {result.chainVersion}</dd>
        </div>
        <div>
          <dt>Checked at</dt>
          <dd>
            {result.checkedAt
              ? `${new Date(result.checkedAt).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
              : "Not completed"}
          </dd>
        </div>
      </dl>
      {result.datasetContext === "restored" ? (
        <p role="status">
          This dataset is marked restored. Compare with a separately retained
          checkpoint.
        </p>
      ) : null}
      {!result.inspectionComplete ? (
        <p>
          Inspection is incomplete; these boundaries do not describe a completed
          check.
        </p>
      ) : null}
      {result.firstAffectedSequence !== null ? (
        <p>First affected sequence: {result.firstAffectedSequence}</p>
      ) : null}
      {result.breaks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-caption-1-regular">
            <caption className="text-left">
              Bounded integrity breaks (at most 100)
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">From sequence</th>
                <th scope="col">To sequence</th>
              </tr>
            </thead>
            <tbody>
              {result.breaks.map((item, index) => (
                <tr key={`${item.category}-${item.fromSequence}-${index}`}>
                  <td>{item.category.replaceAll("_", " ")}</td>
                  <td>{item.fromSequence}</td>
                  <td>{item.toSequence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-caption-1-regular text-fg-muted">
        This check does not prove authenticity or verify a complete ledger. A
        saved checkpoint only supports comparison with that checkpoint.
      </p>
    </div>
  );
}
