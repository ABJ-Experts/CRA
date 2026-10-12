"use client";
import { exportSources } from "@repo/contracts/exports";
import { useSession } from "../../_providers/session-provider";
import { ExportControls, type ExportControlsProps } from "./export-controls";

/** The shared registry is authoritative; source-specific policy still runs on the server. */
export function MemberExportControls(
  props: Omit<ExportControlsProps, "enabled"> & { enabled?: boolean },
) {
  const { session, permissions = {}, isLoading, role } = useSession();
  const specification = exportSources[props.source];
  const allowed = specification.requiredPermissions.every(
    (permission) => permissions[permission] === true,
  );
  const roleAllowed = !specification.requiredRole || role === "owner" || (specification.requiredRole === "admin" && role === "admin");
  const identity = `${session?.organization?.id ?? "none"}:${session?.user?.id ?? "none"}`;
  return (
    <ExportControls
      {...props}
      key={`${identity}:${props.source}:${JSON.stringify(props.context)}`}
      label={props.label ?? `Export ${props.source.split(".").at(-1)?.replaceAll("_", " ") ?? "list"}`}
      enabled={
        props.enabled !== false &&
        !isLoading &&
        Boolean(session?.organization?.id && session?.user?.id) &&
        allowed && roleAllowed && specification.subjectKind === "member"
      }
    />
  );
}
