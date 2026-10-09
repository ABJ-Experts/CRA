import { z } from "zod";
import {
  siemEventSchema,
  siemCatalogueSchema,
} from "@repo/contracts/audit/schemas";
import type {
  SiemEvent,
  SiemFormat,
  SiemCatalogue,
} from "@repo/contracts/audit/types";
import { SIEM_EVENT_REGISTRY } from "./siem-event-registry";
const uuid = z.uuid();
const validUuid = (value: unknown): string | null => {
  const parsed = uuid.safeParse(value);
  return parsed.success ? parsed.data : null;
};
export interface SiemSourceEvent {
  id: string;
  organizationId: string | null;
  scope: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: unknown;
  actorType: string | null;
  actorId: unknown;
  correlationId: unknown;
  outcome: string | null;
  sequence: string;
}
/** Authorization precedes this projection; it is deliberately incapable of disclosing source content. */
export function projectSiemEvent(
  orgId: string,
  row: SiemSourceEvent,
): SiemEvent | null {
  if (row.organizationId !== orgId || row.scope !== "organization") return null;
  const registered = SIEM_EVENT_REGISTRY.find(
    (v) => v.action === row.action && v.resourceType === row.entityType,
  );
  if (!registered) return null;
  const result = siemEventSchema.safeParse({
    schemaVersion: 1,
    eventId: row.id,
    organizationId: orgId,
    occurredAt: normalizeInstant(row.createdAt),
    eventClass: registered.eventClass,
    action: registered.action,
    outcome: row.outcome ?? "unknown",
    actorType: row.actorType ?? "unknown",
    actorId: validUuid(row.actorId),
    resourceType: registered.resourceType,
    resourceId: validUuid(row.entityId),
    correlationId: validUuid(row.correlationId),
    chainSequence: row.sequence,
  });
  return result.success ? result.data : null;
}
export function escapeCefHeader(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}
export function escapeCefExtension(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/=/g, "\\=")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}
export function formatSiemEvent(value: SiemEvent, format: SiemFormat): string {
  const event = siemEventSchema.parse(value);
  const payload =
    format === "json"
      ? JSON.stringify(event)
      : [
          "CEF:0",
          "ABJ Experts",
          "CRA Sentinel",
          "1",
          event.action,
          event.action,
          event.outcome === "denied" || event.outcome === "failed" ? "6" : "3",
        ]
          .map(escapeCefHeader)
          .join("|") +
        "|" +
        Object.entries({
          externalId: event.eventId,
          rt: String(Date.parse(event.occurredAt)),
          cs1Label: "organizationId",
          cs1: event.organizationId,
          cs2Label: "chainSequence",
          cs2: event.chainSequence,
          cs3Label: "eventClass",
          cs3: event.eventClass,
          act: event.action,
          outcome: event.outcome,
          suid: event.actorId ?? "",
          duid: event.resourceId ?? "",
          cs4Label: "resourceType",
          cs4: event.resourceType,
          cs5Label: "correlationId",
          cs5: event.correlationId ?? "",
          cs6Label: "actorType",
          cs6: event.actorType,
        })
          .map(([key, v]) => `${key}=${escapeCefExtension(v)}`)
          .join(" ");
  if (Buffer.byteLength(payload, "utf8") > 8192)
    throw new Error("siem_payload_limit");
  return payload;
}
export function frameSyslog(message: string): string {
  if (Buffer.byteLength(message, "utf8") > 16384)
    throw new Error("siem_frame_limit");
  return `${Buffer.byteLength(message, "utf8")} ${message}`;
}
export function syslogMessage(event: SiemEvent, format: SiemFormat): string {
  return `<134>1 ${event.occurredAt} - CRA-Sentinel - audit - ${formatSiemEvent(event, format)}`;
}
export function siemCatalogue(): SiemCatalogue {
  const productClasses = new Set([
    "products",
    "sboms",
    "findings",
    "evidence",
    "technical_files",
    "suppliers",
    "reporting",
  ]);
  const labels = {
    access_control: "Access control",
    organization: "Organization",
    products: "Products",
    sboms: "SBOMs",
    findings: "Findings",
    evidence: "Evidence",
    technical_files: "Technical files",
    suppliers: "Suppliers",
    frameworks: "Frameworks",
    reporting: "Reporting",
    integrations: "Integrations",
    audit_access: "Audit access",
  };
  return siemCatalogueSchema.parse({
    version: 1,
    eventClasses: Object.entries(labels).map(([id, label]) => ({
      id,
      label,
      productScoped: productClasses.has(id),
    })),
    transports: ["https", "syslog_tls"],
    formats: ["json", "cef"],
  });
}

function normalizeInstant(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}
