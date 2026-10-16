import type { Metadata } from "next";

import { AuditRangePanel } from "../../_features/audit/audit-range-panel";

import { SiemAuditLink } from "../../_features/audit/siem/siem-audit-link";
import { AuditExplorer } from "../../_features/audit/audit-explorer";

export const metadata: Metadata = {
  title: "Audit trail | CRA Sentinel",
};

export default function AuditPage() {
  return (
    <>
      <AuditExplorer />
      <SiemAuditLink />
      <AuditRangePanel />
    </>
  );
}
