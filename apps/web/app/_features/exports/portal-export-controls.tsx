"use client";

import { useMemo } from "react";
import { apiClient } from "../../_lib/http/api-client";
import { ExportControls } from "./export-controls";
import { ExportsGateway } from "./exports.api";

type PortalSource =
  | "supplier_evidence.portal_items"
  | "supplier_evidence.portal_submissions"
  | "technical_file.auditor_manifest_artifacts";
/** Portal identity is verified by the scoped server session, independently of membership. */
export function PortalExportControls({
  source,
  sessionToken,
  checklistItemId,
}: Readonly<{
  source: PortalSource;
  sessionToken?: string;
  checklistItemId?: string;
}>) {
  const auditor = source === "technical_file.auditor_manifest_artifacts";
  const gateway = useMemo(
    () =>
      new ExportsGateway(
        apiClient,
        auditor
          ? { basePath: "/api/v1/auditor/exports", credentials: "same-origin" }
          : {
              basePath: "/api/v1/supplier-evidence-portal/exports",
              headers: { "x-supplier-evidence-session": sessionToken ?? "" },
              credentials: "same-origin",
            },
      ),
    [auditor, sessionToken],
  );
  const context = checklistItemId ? { checklistItemId } : {};
  return (
    <ExportControls
      key={`${source}:${checklistItemId ?? ""}:${sessionToken ?? "auditor"}`}
      source={source}
      context={context}
      filters={{}}
      enabled={auditor || Boolean(sessionToken)}
      gateway={gateway}
      label={
        auditor
          ? "Export artifact list"
          : checklistItemId
            ? "Export submissions"
            : "Export checklist"
      }
    />
  );
}
